/**
 * court-auction-notice-search@0.3.0 앰비언트 타입 시임.
 *
 * 업스트림 패키지는 CJS 이며 타입 선언을 제공하지 않는다.
 * 이 파일은 실제 런타임에 확인된 함수형 API(클래스 아님)만 선언한다.
 * (2026-07-04 실제 패키지 소스 확인 후 수정 — 이전 버전은 존재하지 않는
 * `NoticeSearchClient` 클래스를 가정한 오류가 있었다.)
 */
declare module 'court-auction-notice-search' {
  /** 기본 base URL (courtauction.go.kr). */
  export const DEFAULT_BASE_URL: string;

  /** HTTP 클라이언트 생성 옵션. */
  export interface CourtAuctionHttpClientOptions {
    baseUrl?: string;
    userAgent?: string;
    timeoutMs?: number;
    /** 호출 간 최소 지연(ms). 기본 2000. */
    minDelayMs?: number;
    jitterMs?: number;
    /** 세션당 최대 호출 수. 기본 10. */
    maxCallsPerSession?: number;
    fetchImpl?: typeof fetch;
  }

  /**
   * 실제 HTTP 클라이언트. warmup·budget·rate-limit·쿠키 관리를 내부적으로 수행하며,
   * 차단 감지(ipcheck===false) 시 BLOCKED 코드의 에러를 throw 한다.
   */
  export class CourtAuctionHttpClient {
    constructor(options?: CourtAuctionHttpClientOptions);
    warmup(endpointKey?: string): Promise<void>;
    postJson(endpointKey: string, body: unknown): Promise<unknown>;
  }

  /** 매각공고 목록 조회 결과 항목 (공고 카드 — 사건번호 없음). */
  export interface NoticeListItem {
    noticeId: string | null;
    courtCode: string | null;
    courtName: string | null;
    judgeDeptCode: string | null;
    saleDate: string | null;
    bidStartDate: string | null;
    bidEndDate: string | null;
    salePlace: string | null;
    correctionCount: number;
    cancellationCount: number;
    raw?: Record<string, unknown>;
  }

  export interface NoticeListResult {
    count: number;
    items: NoticeListItem[];
  }

  export interface NoticeSearchParams {
    /** YYYY-MM, YYYYMM, YYYY-MM-DD, YYYYMMDD 중 하나. */
    date: string;
    courtCode?: string;
    client?: CourtAuctionHttpClient;
  }

  /** 매각공고 목록 조회 (selectRletDspslPbanc). */
  export function searchSaleNotices(params: NoticeSearchParams): Promise<NoticeListResult>;

  /** 매각공고 상세(물건 펼치기) 결과 항목. */
  export interface NoticeDetailItem {
    caseNumber: string | null;
    itemSeq: string | null;
    usage: string | null;
    address: string | null;
    appraisedPrice: number | null;
    minimumSalePrice: number | null;
    remarks: string | null;
    raw?: Record<string, unknown>;
  }

  export interface NoticeDetailResult {
    notice: {
      courtCode: string | null;
      saleDate: string | null;
      salePlace: string | null;
    };
    count: number;
    items: NoticeDetailItem[];
  }

  export interface NoticeDetailInput {
    cortOfcCd?: string;
    courtCode?: string;
    saleDate?: string;
    judgeDeptCode?: string;
  }

  /** 매각공고 상세 조회 (selectRletDspslPbancDtl). jdbnCd(암호화 토큰) 필수. */
  export function getSaleNoticeDetail(
    input: NoticeDetailInput,
    options?: { client?: CourtAuctionHttpClient; includeRaw?: boolean },
  ): Promise<NoticeDetailResult>;

  export interface CourtCodeItem {
    code: string | null;
    name: string | null;
    branchName: string | null;
  }

  export interface CourtCodesResult {
    count: number;
    items: CourtCodeItem[];
  }

  /** 법원사무소 코드표 조회 (selectCortOfcCdLst). */
  export function getCourtCodes(options?: { client?: CourtAuctionHttpClient }): Promise<CourtCodesResult>;

  /** 물건 검색(PGJ151F01) 결과 행 — 사건번호·유찰횟수·가격·주소를 한 번에 포함한다. */
  export interface PropertySearchRow {
    caseNumber: string | null;
    itemNumber: string | null;
    address: string | null;
    appraisedPrice: number | null;
    minimumSalePrice: number | null;
    failedBidCount: number;
    statusCode: string | null;
    progressStatusCode: string | null;
    courtCode: string | null;
    judgeDeptCode: string | null;
    saleDate: string | null;
    salePlace: string | null;
    usageCodes: { large: string | null; medium: string | null; small: string | null };
    regionCodes: { sido: string | null; sigungu: string | null; dong: string | null };
    remarks: string | null;
    raw?: Record<string, unknown>;
  }

  export interface PropertySearchResult {
    page: { pageNo: number; pageSize: number; totalCount: number };
    count: number;
    items: PropertySearchRow[];
  }

  export interface PropertySearchParams {
    courtCode?: string;
    page?: number;
    pageSize?: number;
    saleDate?: { from?: string; to?: string };
    region?: { sido?: string; sigungu?: string; dong?: string };
    usage?: { large?: string; medium?: string; small?: string };
    client?: CourtAuctionHttpClient;
    /**
     * 기본값 true — WAF 로 추정되는 HTTP 400 시 패키지가 자체적으로
     * playwright-core 브라우저를 띄워 재시도한다. auction-radar 는 브라우저
     * 폴백을 아직 배선하지 않았으므로(REQ-008, HttpSourceClient 상단 주석)
     * 반드시 false 로 호출해 원본 업스트림 오류가 가려지지 않게 한다.
     */
    fallback?: boolean;
  }

  /** 물건 검색 (searchControllerMain.on / PGJ151F01). */
  export function searchProperties(params: PropertySearchParams): Promise<PropertySearchResult>;

  /** 용도 코드표 항목(대/중/소분류). 커버리지가 성글다(패키지 자체 문서화된 한계). */
  export interface UsageCodeEntry {
    level: 'large' | 'medium' | 'small';
    code: string;
    name: string;
    parentCode?: string;
  }

  /** 등록된 용도 코드 전체 목록(코드→이름 역조회용). 네트워크 호출 없음(정적 코드표). */
  export function getUsageCodes(): { count: number; items: UsageCodeEntry[] };
}
