import {
  CourtAuctionHttpClient,
  getCaseByCaseNumber,
  getCourtCodes,
  getSaleNoticeDetail,
  searchSaleNotices,
  type CaseScheduleEntry,
} from 'court-auction-notice-search';
import { DEFAULT_BASE_URL } from '../endpoints.js';
import type {
  CourtCode,
  DetailRequest,
  ListRequest,
  RawEnvelope,
  SourceRecord,
  SourceResponse,
} from '../types.js';
import type { SourceClient } from './SourceClient.js';

/**
 * HttpSourceClient — court-auction-notice-search@0.3.0 실제(함수형) API 래핑 구현.
 * (기획서 §6.2, REQ-008)
 *
 * ⚠️ CI 에서는 절대 호출하지 않는다(실서버 접근 금지). 컴파일 대상일 뿐이며,
 * 실제 수집은 사용자 로컬에서 자신의 IP 로만 수행한다.
 *
 * 사용 엔드포인트 (기획서 §6.2 원래 4종, 브라우저 자동화 없음 — Workflow A/B):
 * - 매각공고 목록(searchSaleNotices) → 매각공고 상세(getSaleNoticeDetail) → 사건
 *   단건 조회(getCaseByCaseNumber). "물건 검색"(searchProperties, Workflow C)은
 *   패키지 README 가 자체 문서화한 "raw-HTTP WAF" 대상이라(HTTP 400 시 자동으로
 *   playwright-core/rebrowser-playwright 브라우저 자동화로 재시도하도록 설계됨)
 *   의도적으로 사용하지 않는다 — 기획서 §8 "차단 우회가 아닌 서버 부담 최소화"
 *   원칙과 충돌하기 때문(2026-07-04 라이브 검증 중 확인, 봇탐지 회피 도구까지
 *   optionalDependencies 로 준비돼 있음을 근거로 판단).
 *
 * ⚠️ 알려진 한계 (라이브 검증 필요):
 * 1. 매각공고 "목록" 응답에는 사건번호가 없다(공고 카드 수준) — orchestration 이
 *    이 경우 무조건 상세 펼치기를 수행하도록 처리한다(사건 식별을 상세에서 확보).
 * 2. 유찰 횟수(failedCount)는 목록·상세 어디에도 없다. 사건 단건 조회의 매각기일
 *    이력(schedule)에서 **최저매각가가 이전 회차보다 하락한 횟수**를 세어 유찰
 *    횟수로 근사한다(한국 법원경매 관행상 유찰마다 최저가가 일정 비율 하락 —
 *    기획서의 price_drop 이벤트 정의와 동일한 논리). resultCode 필드의 정확한
 *    코드표는 확보하지 못해 직접 사용하지 않는다.
 * 3. 사건 진행상태(progressStatusCode 등)는 원문 코드를 그대로 통과시킨다 —
 *    의미(진행중/취하/정지)를 알 수 없어 eventGenerator 의 "취하/정지" 키워드
 *    매칭(한글 문자열 포함 여부)에는 걸리지 않을 수 있다. 코드값이 실제로
 *    한글 텍스트인지, 숫자 코드인지는 라이브 호출로만 확인 가능 — 확인 전까지
 *    `cancelled` 이벤트는 라이브 데이터에서 발생하지 않을 수 있다(백로그).
 * 4. 상세 응답은 한 공고에 물건이 여러 건일 수 있으나, 현재
 *    DetailRequest → SourceRecord(단수) 계약상 첫 번째 물건만 취한다.
 * 5. 신규/변경 의심 건마다 상세(getSaleNoticeDetail) + 사건조회
 *    (getCaseByCaseNumber) 2번의 실제 HTTP 요청이 발생하지만, 우리 자신의
 *    BudgetGuard/Throttler 는 이를 1회 guardedCall(= fetchAnnouncementDetail)로만
 *    계산한다. 실제 네트워크 페이싱은 두 호출이 같은 CourtAuctionHttpClient
 *    인스턴스를 공유해 그 자체의 minDelayMs(기본 2000ms)가 내부적으로 강제되므로
 *    안전하지만, budget 카운트는 실제 호출 수보다 적게 잡힌다(문서화된 근사).
 */

/** 브라우저 폴백 transport seam (playwright-core 로 구현). */
export interface BrowserTransport {
  request(endpoint: string, body: unknown): Promise<unknown>;
}

/** HttpSourceClient 옵션. */
export interface HttpSourceClientOptions {
  readonly baseUrl?: string;
  /** 직접 HTTP 실패 시 사용할 브라우저 폴백 transport (미주입 시 폴백 없음). */
  readonly browserTransport?: BrowserTransport;
}

/**
 * playwright-core 를 지연 로드해 브라우저 transport 를 생성한다. (optionalDependency seam)
 *
 * 정적 해석을 피하기 위해 specifier 를 문자열로 캐스팅한다
 * (playwright-core 미설치 환경에서도 타입/빌드가 깨지지 않도록).
 *
 * ⚠️ 의도적으로 미구현이다 — "물건 검색"(searchProperties) 같은 raw-HTTP WAF
 * 보호 엔드포인트를 브라우저 자동화로 우회하는 용도로 쓰지 않기 위함
 * (기획서 §8 "차단 우회가 아닌 서버 부담 최소화" 원칙, 클래스 상단 주석 참고).
 * 이 seam 은 REQ-008 이 "Optional" 로 남겨둔 대로 유지하되, 실제 배선은
 * 별도 SPEC 에서 사용자의 명시적 동의(opt-in) 하에 재검토한다.
 */
export async function loadPlaywrightTransport(): Promise<BrowserTransport> {
  const specifier = 'playwright-core';
  const mod = (await import(specifier as string)) as unknown;
  if (mod === undefined || mod === null) {
    throw new Error('playwright-core 를 로드할 수 없습니다 (optionalDependency 미설치).');
  }
  throw new Error('BrowserTransport 는 아직 구현되지 않았습니다(의도적 미배선 — 상단 주석 참고).');
}

/** 패키지가 에러 객체에 붙이는 code 필드를 안전하게 추출한다. */
export function errorCode(err: unknown): string | undefined {
  if (err !== null && typeof err === 'object' && 'code' in err) {
    const c = (err as { code?: unknown }).code;
    return typeof c === 'string' ? c : undefined;
  }
  return undefined;
}

/** 패키지가 에러 객체에 붙이는 statusCode 필드를 안전하게 추출한다. */
export function errorStatusCode(err: unknown): number | undefined {
  if (err !== null && typeof err === 'object' && 'statusCode' in err) {
    const c = (err as { statusCode?: unknown }).statusCode;
    return typeof c === 'number' ? c : undefined;
  }
  return undefined;
}

/**
 * BLOCKED 가 아닌 에러를 code/statusCode 를 메시지에 포함시켜 다시 던진다.
 * sync_runs.error 와 콘솔 로그에 statusCode 가 그대로 드러나게 하기 위함
 * (라이브 진단 시 "그냥 실패했다" 보다 훨씬 유용한 신호).
 */
function rethrowWithDiagnostics(err: unknown): never {
  const code = errorCode(err);
  const status = errorStatusCode(err);
  if (err instanceof Error && (code !== undefined || status !== undefined)) {
    const suffix = [code, status !== undefined ? `HTTP ${status}` : undefined].filter(Boolean).join(', ');
    err.message = suffix ? `${err.message} [${suffix}]` : err.message;
  }
  throw err;
}

/** 상세 조회에 필요한 최소 토큰(암호화된 jdbnCd + saleDate). */
export interface DetailToken {
  readonly jdbnCd: string;
  readonly saleDate: string;
}

/** DetailToken 을 announcementId(문자열) 로 인코딩한다. */
export function encodeDetailToken(token: DetailToken): string {
  return JSON.stringify(token);
}

/** announcementId 에서 DetailToken 을 복원한다. 복원 불가 시 null. */
export function decodeDetailToken(announcementId: string): DetailToken | null {
  try {
    const parsed: unknown = JSON.parse(announcementId);
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      typeof (parsed as DetailToken).jdbnCd === 'string' &&
      typeof (parsed as DetailToken).saleDate === 'string'
    ) {
      return parsed as DetailToken;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 매각기일 이력에서 유찰 횟수를 근사 계산한다.
 *
 * 한국 법원경매는 유찰될 때마다 최저매각가가 일정 비율(보통 20~30%) 하락하는
 * 관행이 있다 — 기획서의 `price_drop` 이벤트("min_sale_price 감소")와 동일한
 * 논리를 재사용한다. resultCode 의 정확한 의미(코드표 미확보)에 의존하지 않는
 * 자기완결적 계산이라, 라이브 검증 없이도 안전하게 쓸 수 있다.
 *
 * itemNo 가 주어지면 해당 물건 회차만 필터링하고, 이력에 물건 구분이 없으면
 * (단일 물건 사건이 흔함) 전체를 하나의 이력으로 취급한다.
 */
export function computeFailedCountFromSchedule(
  entries: readonly CaseScheduleEntry[],
  itemSeq: string | null,
): number {
  const relevant = entries.filter((e) => e.itemSeq === null || itemSeq === null || e.itemSeq === itemSeq);
  const sorted = relevant
    .filter(
      (e): e is CaseScheduleEntry & { saleDate: string; minimumSalePrice: number } =>
        e.saleDate !== null && e.minimumSalePrice !== null,
    )
    .slice()
    .sort((a, b) => (a.saleDate < b.saleDate ? -1 : a.saleDate > b.saleDate ? 1 : 0));
  let count = 0;
  let previousPrice: number | undefined;
  for (const entry of sorted) {
    if (previousPrice !== undefined && entry.minimumSalePrice < previousPrice) count += 1;
    previousPrice = entry.minimumSalePrice;
  }
  return count;
}

export class HttpSourceClient implements SourceClient {
  private readonly client: CourtAuctionHttpClient;

  constructor(options: HttpSourceClientOptions = {}) {
    // browserTransport 는 M1 로컬 폴백에서 소비되는 seam 이다(현재 미배선).
    void options.browserTransport;
    this.client = new CourtAuctionHttpClient({
      baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
      // 호출 페이싱·budget 은 core/throttle(Throttler·BudgetGuard)이 이미
      // guardedCall() 앞단에서 강제한다(REQ-001, 002). 패키지 자체 세션
      // budget 이 먼저 소진돼 이중 오류 경로가 생기지 않도록 넉넉히 둔다.
      maxCallsPerSession: 1000,
    });
  }

  /** 정상 응답을 SourceResponse 봉투로 감싼다. */
  private wrapOk<T>(endpoint: string, request: unknown, data: T, response: unknown): SourceResponse<T> {
    const raw: RawEnvelope = { endpoint, request, response };
    return { ok: true, ipcheck: true, data, raw };
  }

  /** 차단(BLOCKED) 오류를 SourceResponse 봉투로 감싼다(REQ-003 — 예외가 아닌 값으로 표현). */
  private wrapBlocked<T>(endpoint: string, request: unknown, err: unknown): SourceResponse<T> {
    const raw: RawEnvelope = {
      endpoint,
      request,
      response: err instanceof Error ? { message: err.message } : err,
    };
    return { ok: false, ipcheck: false, data: null as T, raw };
  }

  async warmup(): Promise<SourceResponse> {
    try {
      await this.client.warmup('notices');
      return this.wrapOk('warmup', {}, { session: 'live' }, { session: 'live' });
    } catch (err) {
      if (errorCode(err) === 'BLOCKED') return this.wrapBlocked('warmup', {}, err);
      rethrowWithDiagnostics(err);
    }
  }

  async fetchCourtCodes(): Promise<SourceResponse<CourtCode[]>> {
    try {
      const result = await getCourtCodes({ client: this.client });
      const codes = result.items.map((item) => item.code).filter((c): c is string => c !== null);
      return this.wrapOk('courtCodeList', {}, codes, result);
    } catch (err) {
      if (errorCode(err) === 'BLOCKED') return this.wrapBlocked('courtCodeList', {}, err);
      rethrowWithDiagnostics(err);
    }
  }

  async fetchAnnouncementList(req: ListRequest): Promise<SourceResponse<SourceRecord[]>> {
    try {
      // searchSaleNotices 는 req.yearMonth(YYYYMM)를 그대로 받는다(월 단위 조회).
      const result = await searchSaleNotices({ date: req.yearMonth, courtCode: req.court, client: this.client });
      const records: SourceRecord[] = result.items.map((item) => {
        const jdbnCd = item.judgeDeptCode;
        const saleDateCompact = item.saleDate !== null ? item.saleDate.replace(/-/g, '') : null;
        // 목록 단계엔 사건번호가 없다 — jdbnCd+saleDate 토큰으로 상세를 무조건
        // 펼쳐 식별을 확보한다(orchestration 의 "식별 정보 없음" 경로, REQ-006).
        const announcementId =
          jdbnCd !== null && saleDateCompact !== null
            ? encodeDetailToken({ jdbnCd, saleDate: saleDateCompact })
            : undefined;

        return {
          court: item.courtCode ?? req.court,
          correctionCount: item.correctionCount,
          cancellationCount: item.cancellationCount,
          nextSaleDate: item.saleDate,
          salePlace: item.salePlace,
          ...(announcementId !== undefined ? { announcementId } : {}),
        };
      });
      return this.wrapOk('listAnnouncement', req, records, result);
    } catch (err) {
      if (errorCode(err) === 'BLOCKED') return this.wrapBlocked('listAnnouncement', req, err);
      rethrowWithDiagnostics(err);
    }
  }

  async fetchAnnouncementDetail(req: DetailRequest): Promise<SourceResponse<SourceRecord>> {
    const token = decodeDetailToken(req.announcementId);
    if (token === null) {
      // 토큰 복원 불가 — 상세 조회에 필요한 최소 정보(jdbnCd/saleDate)가 없다.
      // 빈 레코드를 반환해 parseRecord 가 REQ-016 에 따라 안전하게 skip 하게 한다.
      return this.wrapOk('detailAnnouncement', req, {} as SourceRecord, {});
    }
    try {
      const result = await getSaleNoticeDetail(
        { cortOfcCd: req.court, saleDate: token.saleDate, judgeDeptCode: token.jdbnCd },
        { client: this.client },
      );
      const first = result.items[0];
      if (first === undefined || first.caseNumber === null) {
        return this.wrapOk('detailAnnouncement', req, {} as SourceRecord, result);
      }

      // 사건 단건 조회 — 유찰 횟수(스케줄 최저가 하락 횟수) + 진행상태(원문 코드).
      // 실패해도 상세 데이터 자체는 유효하므로 sync 전체를 막지 않는다(failedCount=0 폴백).
      let failedCount = 0;
      let status: string | null = null;
      try {
        const caseRes = await getCaseByCaseNumber({
          courtCode: req.court,
          caseNumber: first.caseNumber,
          client: this.client,
        });
        if (caseRes.found) {
          failedCount = computeFailedCountFromSchedule(caseRes.schedule, first.itemSeq);
          status = caseRes.caseInfo?.progressStatusCode ?? null;
        }
      } catch (caseErr) {
        if (errorCode(caseErr) === 'BLOCKED') throw caseErr; // 차단은 상위로 전파해 즉시 중단(REQ-003)
        // 그 외(사건조회 실패)는 무시 — 상세 데이터만으로도 물건 등록은 유효.
      }

      const record: SourceRecord = {
        court: req.court,
        caseNumber: first.caseNumber,
        itemNo: typeof first.itemSeq === 'string' && /^\d+$/.test(first.itemSeq) ? Number(first.itemSeq) : 1,
        usage: first.usage,
        addressRaw: first.address,
        appraisedPrice: first.appraisedPrice,
        minSalePrice: first.minimumSalePrice,
        remarks: first.remarks,
        salePlace: result.notice.salePlace,
        nextSaleDate: result.notice.saleDate,
        failedCount,
        status,
      };
      return this.wrapOk('detailAnnouncement', req, record, result);
    } catch (err) {
      if (errorCode(err) === 'BLOCKED') return this.wrapBlocked('detailAnnouncement', req, err);
      rethrowWithDiagnostics(err);
    }
  }
}
