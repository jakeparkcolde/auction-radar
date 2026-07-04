import {
  CourtAuctionHttpClient,
  getCourtCodes,
  getSaleNoticeDetail,
  getUsageCodes,
  searchProperties,
  type UsageCodeEntry,
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
 * ⚠️ 알려진 한계 (라이브 검증 필요 — 후속 SPEC 대상, 2026-07-04 실연동 수정 시 발견):
 *
 * 목록 조회는 "매각공고 목록"(searchSaleNotices, 공고 카드 수준 — 사건번호·유찰횟수 없음)
 * 대신 "물건 검색"(searchProperties, PGJ151F01)을 사용한다. 이 엔드포인트는 사건번호·
 * 유찰횟수·감정가·최저가·주소·용도·지역을 **한 번의 호출로 모두** 제공해, 목록→상세
 * 2단계를 거치지 않고도 워치리스트 매칭에 필요한 데이터가 완비된다.
 *
 * 1. 페이지네이션: budget/throttle 불변식(REQ-001, 002 — guardedCall 당 실제 HTTP 호출
 *    1건)을 지키기 위해 페이지당 최대 100건만 조회하고 추가 페이지는 순회하지 않는다.
 *    한 법원·기간에 100건을 초과하는 활성 매물이 있으면 이번 호출에서 일부가
 *    누락될 수 있다(다음 sync 에서 갱신 시 보완됨). 다건 법원 대응은 후속 과제.
 * 2. 기간 필터: `saleDate.from/to`(입찰기간)를 "당월/익월" 범위로 근사 매핑한다.
 *    원래 "매각공고 목록"의 공고월과 정확히 같은 의미인지는 라이브 호출로만
 *    확인 가능하다.
 * 3. 용도 코드 역조회: 물건 검색은 용도를 코드(대/중/소분류)로만 반환한다.
 *    패키지의 코드표(getUsageCodes)가 자체 문서화한 대로 커버리지가 성글어
 *    (§ usage-codes.json 주석), 매핑 실패 시 코드 원문이 그대로 usage 필드에
 *    들어가고 mapUsage() 가 "기타"로 폴백한다(REQ-019 설계와 일치, 크래시 아님).
 * 4. correctionCount/cancellationCount(정정·취하 횟수)는 물건 검색에 없다 —
 *    항상 0으로 수집되어(defaults), 오직 이 두 값의 증가로만 발생하는 `changed`
 *    이벤트는 라이브 데이터에서 당분간 발생하지 않는다. status 변경·유찰·
 *    최저가 하락은 정상 동작한다.
 * 5. 상세 조회(getSaleNoticeDetail)는 유지하되, 물건 검색으로 얻은 레코드는
 *    이미 데이터가 완비돼 announcementId 를 설정하지 않는다 — orchestration 이
 *    상세 펼치기를 자동으로 건너뛴다(불필요한 호출 절약).
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
 */
export async function loadPlaywrightTransport(): Promise<BrowserTransport> {
  // court-auction-notice-search / 사용자 환경에 playwright-core 가 있을 때만 동작한다.
  const specifier = 'playwright-core';
  const mod = (await import(specifier as string)) as unknown;
  if (mod === undefined || mod === null) {
    throw new Error('playwright-core 를 로드할 수 없습니다 (optionalDependency 미설치).');
  }
  // 실제 브라우저 구동 배선은 M1 로컬 구현 범위. seam 만 제공한다.
  throw new Error('BrowserTransport 는 아직 구현되지 않았습니다 (M1 로컬 전용).');
}

/** 패키지가 에러 객체에 붙이는 code 필드를 안전하게 추출한다. */
export function errorCode(err: unknown): string | undefined {
  if (err !== null && typeof err === 'object' && 'code' in err) {
    const c = (err as { code?: unknown }).code;
    return typeof c === 'string' ? c : undefined;
  }
  return undefined;
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

/** YYYYMM 을 해당 월의 첫날/마지막날(YYYY-MM-DD)로 변환한다. */
export function monthRange(yearMonth: string): { from: string; to: string } {
  const y = Number(yearMonth.slice(0, 4));
  const m = Number(yearMonth.slice(4, 6));
  const from = `${yearMonth.slice(0, 4)}-${yearMonth.slice(4, 6)}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const to = `${yearMonth.slice(0, 4)}-${yearMonth.slice(4, 6)}-${String(lastDay).padStart(2, '0')}`;
  return { from, to };
}

/**
 * 용도 코드(소/중/대분류 순)를 한글 이름으로 역조회한다. 매칭 실패 시 원본 코드를
 * 그대로 반환한다(mapUsage 가 "기타"로 폴백 — REQ-019 설계와 일치, 크래시 아님).
 * getUsageCodes()는 정적 코드표 조회로 네트워크 호출이 없다.
 */
export function describeUsageCode(codes: {
  large: string | null;
  medium: string | null;
  small: string | null;
}): string | null {
  const candidates = [codes.small, codes.medium, codes.large].filter((c): c is string => c !== null && c !== '');
  if (candidates.length === 0) return null;
  const table: UsageCodeEntry[] = getUsageCodes().items;
  for (const code of candidates) {
    const found = table.find((entry) => entry.code === code);
    if (found !== undefined) return found.name;
  }
  return candidates[0] ?? null;
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
      throw err;
    }
  }

  async fetchCourtCodes(): Promise<SourceResponse<CourtCode[]>> {
    try {
      const result = await getCourtCodes({ client: this.client });
      const codes = result.items.map((item) => item.code).filter((c): c is string => c !== null);
      return this.wrapOk('courtCodeList', {}, codes, result);
    } catch (err) {
      if (errorCode(err) === 'BLOCKED') return this.wrapBlocked('courtCodeList', {}, err);
      throw err;
    }
  }

  async fetchAnnouncementList(req: ListRequest): Promise<SourceResponse<SourceRecord[]>> {
    try {
      const { from, to } = monthRange(req.yearMonth);
      // 물건 검색(searchProperties)은 사건번호·유찰횟수를 목록 단계에서 바로 제공한다
      // (searchSaleNotices 는 공고 카드 수준이라 이 두 값이 없다 — 클래스 상단 주석 참고).
      // 페이지당 100건, 페이지네이션 없음(budget 불변식 유지 — 위 주석 1번).
      const result = await searchProperties({
        courtCode: req.court,
        saleDate: { from, to },
        page: 1,
        pageSize: 100,
        client: this.client,
      });
      const records: SourceRecord[] = result.items.map((item) => ({
        court: item.courtCode ?? req.court,
        caseNumber: item.caseNumber ?? undefined,
        itemNo: typeof item.itemNumber === 'string' && /^\d+$/.test(item.itemNumber) ? Number(item.itemNumber) : 1,
        usage: describeUsageCode(item.usageCodes),
        addressRaw: item.address,
        appraisedPrice: item.appraisedPrice,
        minSalePrice: item.minimumSalePrice,
        // 유찰 횟수 — searchProperties 만이 제공하는 핵심 필드(REQ-019 연계 워치리스트 조건).
        failedCount: item.failedBidCount,
        status: item.statusCode ?? item.progressStatusCode,
        nextSaleDate: item.saleDate,
        salePlace: item.salePlace,
        remarks: item.remarks,
        // correctionCount/cancellationCount 는 이 엔드포인트에 없음 — 미설정(0 기본값).
      }));
      return this.wrapOk('listAnnouncement', req, records, result);
    } catch (err) {
      if (errorCode(err) === 'BLOCKED') return this.wrapBlocked('listAnnouncement', req, err);
      throw err;
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
      const record: SourceRecord = first
        ? {
            court: req.court,
            caseNumber: first.caseNumber ?? undefined,
            itemNo: typeof first.itemSeq === 'string' && /^\d+$/.test(first.itemSeq) ? Number(first.itemSeq) : 1,
            usage: first.usage,
            addressRaw: first.address,
            appraisedPrice: first.appraisedPrice,
            minSalePrice: first.minimumSalePrice,
            remarks: first.remarks,
            salePlace: result.notice.salePlace,
            nextSaleDate: result.notice.saleDate,
          }
        : {};
      return this.wrapOk('detailAnnouncement', req, record, result);
    } catch (err) {
      if (errorCode(err) === 'BLOCKED') return this.wrapBlocked('detailAnnouncement', req, err);
      throw err;
    }
  }
}
