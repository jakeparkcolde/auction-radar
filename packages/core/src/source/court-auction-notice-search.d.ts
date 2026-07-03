/**
 * court-auction-notice-search@0.3.0 앰비언트 타입 시임.
 *
 * 업스트림 패키지는 CJS 이며 타입 선언을 제공하지 않는다.
 * HttpSourceClient 가 컴파일되도록 우리가 사용하는 최소 표면만 선언한다.
 * (실제 런타임 API 는 SourceClient seam 뒤에서 방어적으로 다룬다 — CI 미호출)
 */
declare module 'court-auction-notice-search' {
  /** 목록 조회 파라미터. */
  export interface NoticeSearchParams {
    court?: string;
    yearMonth?: string;
    [key: string]: unknown;
  }

  /** 조회 결과(느슨한 형상). */
  export interface NoticeSearchResult {
    ipcheck?: boolean;
    data?: unknown;
    [key: string]: unknown;
  }

  /** 클라이언트 옵션. */
  export interface ClientOptions {
    baseUrl?: string;
    transport?: unknown;
    [key: string]: unknown;
  }

  /** 매각공고 검색 클라이언트(가정 표면). */
  export class NoticeSearchClient {
    constructor(options?: ClientOptions);
    warmup(): Promise<NoticeSearchResult>;
    listCourts(): Promise<NoticeSearchResult>;
    search(params: NoticeSearchParams): Promise<NoticeSearchResult>;
    detail(params: NoticeSearchParams): Promise<NoticeSearchResult>;
  }

  const _default: { NoticeSearchClient: typeof NoticeSearchClient };
  export default _default;
}
