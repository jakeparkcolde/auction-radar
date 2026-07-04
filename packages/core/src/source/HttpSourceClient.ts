import { CourtAuctionHttpClient, getCourtCodes, getSaleNoticeDetail, searchSaleNotices } from 'court-auction-notice-search';
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
 * 1. 매각공고 "목록"(searchSaleNotices) 응답에는 사건번호(csNo)가 정식 필드로
 *    포함되지 않는다(공고 카드 수준 — 사건/물건은 상세에서만 펼쳐진다, §6.2 설계와 일치).
 *    raw 페이로드에 csNo/saNo 가 실제로 있는지는 라이브 호출로만 확인 가능하므로
 *    방어적으로 조회하되, 없으면 해당 레코드는 caseNumber 없이 반환되어
 *    parseRecord 가 REQ-016 에 따라 안전하게 skip 한다(sync 자체는 중단 안 함).
 * 2. 유찰 횟수(failedCount)는 목록·상세 엔드포인트 어디에도 없다(둘 다 확인함).
 *    실제로는 "사건 단건 조회"(getCaseByCaseNumber)의 schedule 이력에서 유찰
 *    결과를 세거나, "물건 검색"(searchProperties)의 flbdCount 를 써야 한다.
 *    두 경로 모두 아직 배선되지 않아 failedCount 는 항상 0으로 수집되며,
 *    워치리스트의 failedCountMin 조건에 영향을 준다.
 * 3. 상세 응답은 한 공고에 물건이 여러 건일 수 있으나, 현재
 *    DetailRequest → SourceRecord(단수) 계약상 첫 번째 물건만 취한다.
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
      const result = await searchSaleNotices({ date: req.yearMonth, courtCode: req.court, client: this.client });
      const records: SourceRecord[] = result.items.map((item) => {
        const raw = (item.raw ?? {}) as Record<string, unknown>;
        // 사건번호는 목록 응답에 정식 포함되지 않는다 — raw 를 방어적으로 조회한다.
        const caseNumberGuess =
          (typeof raw.csNo === 'string' && raw.csNo) || (typeof raw.saNo === 'string' && raw.saNo) || undefined;

        const jdbnCd = item.judgeDeptCode ?? (typeof raw.jdbnCd === 'string' ? raw.jdbnCd : null);
        const saleDateCompact = item.saleDate !== null ? item.saleDate.replace(/-/g, '') : null;
        const announcementId =
          jdbnCd !== null && saleDateCompact !== null
            ? encodeDetailToken({ jdbnCd, saleDate: saleDateCompact })
            : undefined;

        return {
          court: item.courtCode ?? req.court,
          ...(caseNumberGuess !== undefined ? { caseNumber: caseNumberGuess } : {}),
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
