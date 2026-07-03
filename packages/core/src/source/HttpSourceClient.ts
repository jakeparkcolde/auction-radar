import cans from 'court-auction-notice-search';
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
 * HttpSourceClient — court-auction-notice-search@0.3.0 래핑 구현. (기획서 §6.2, REQ-008)
 *
 * ⚠️ CI 에서는 절대 호출하지 않는다(실서버 접근 금지). 컴파일 대상일 뿐이며,
 * 실제 수집은 사용자 로컬에서 자신의 IP 로만 수행한다.
 *
 * transport 는 1차 직접 HTTP, 차단·5xx 시에만 playwright-core fallback(optionalDependency).
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

export class HttpSourceClient implements SourceClient {
  private readonly client: InstanceType<typeof cans.NoticeSearchClient>;

  constructor(options: HttpSourceClientOptions = {}) {
    // browserTransport 는 M1 로컬 폴백에서 소비되는 seam 이다(현재 미배선).
    void options.browserTransport;
    this.client = new cans.NoticeSearchClient({
      baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
    });
  }

  /** 업스트림 결과를 SourceResponse 봉투로 감싼다. */
  private wrap<T>(endpoint: string, request: unknown, result: { ipcheck?: boolean; data?: unknown }): SourceResponse<T> {
    const raw: RawEnvelope = { endpoint, request, response: result };
    const ipcheck = result.ipcheck;
    return {
      ok: ipcheck !== false,
      ...(ipcheck === undefined ? {} : { ipcheck }),
      data: (result.data ?? null) as T,
      raw,
    };
  }

  async warmup(): Promise<SourceResponse> {
    const res = await this.client.warmup();
    return this.wrap('warmup', {}, res);
  }

  async fetchCourtCodes(): Promise<SourceResponse<CourtCode[]>> {
    const res = await this.client.listCourts();
    return this.wrap<CourtCode[]>('courtCodeList', {}, res);
  }

  async fetchAnnouncementList(req: ListRequest): Promise<SourceResponse<SourceRecord[]>> {
    const res = await this.client.search({ court: req.court, yearMonth: req.yearMonth });
    return this.wrap<SourceRecord[]>('listAnnouncement', req, res);
  }

  async fetchAnnouncementDetail(req: DetailRequest): Promise<SourceResponse<SourceRecord>> {
    const res = await this.client.detail({ court: req.court, announcementId: req.announcementId });
    return this.wrap<SourceRecord>('detailAnnouncement', req, res);
  }
}
