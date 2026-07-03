import type {
  CourtCode,
  DetailRequest,
  ListRequest,
  SourceRecord,
  SourceResponse,
} from '../types.js';
import type { SourceClient } from './SourceClient.js';

/**
 * FixtureSourceClient — CI 기본 소스 클라이언트. (기획서 §9, REQ-018)
 *
 * 네트워크 호출 없이 익명화된 fixture 데이터를 재생한다.
 * 차단(ipcheck=false) 시나리오도 blockOnCall 로 스크립트할 수 있다.
 */

/** 목록 fixture 키: `${court}:${yearMonth}`. */
function listKey(court: CourtCode, yearMonth: string): string {
  return `${court}:${yearMonth}`;
}

/** FixtureSourceClient 스크립트. */
export interface FixtureScript {
  /** warmup 응답 (기본: ok). */
  readonly warmup?: SourceResponse;
  /** 법원 코드표. */
  readonly courtCodes?: CourtCode[];
  /** (court:yearMonth) → 목록 레코드. */
  readonly lists?: Record<string, SourceRecord[]>;
  /** announcementId → 상세 레코드. */
  readonly details?: Record<string, SourceRecord>;
  /** N번째 호출에서 ipcheck=false(차단)를 반환 (1-기반). */
  readonly blockOnCall?: number;
}

export class FixtureSourceClient implements SourceClient {
  private callCount = 0;
  /** 호출된 엔드포인트 순서 로그 (테스트에서 호출 순서 검증용). */
  readonly callLog: string[] = [];

  constructor(private readonly script: FixtureScript = {}) {}

  /** 지금까지 호출된 횟수. */
  get calls(): number {
    return this.callCount;
  }

  /** 호출 카운트를 증가시키고, 차단 지점이면 차단 응답을 반환한다. */
  private tick(endpoint: string, request: unknown): SourceResponse | null {
    this.callCount += 1;
    this.callLog.push(endpoint);
    if (this.script.blockOnCall !== undefined && this.callCount === this.script.blockOnCall) {
      return {
        ok: false,
        ipcheck: false,
        data: null,
        raw: { endpoint, request, response: { ipcheck: false } },
      };
    }
    return null;
  }

  async warmup(): Promise<SourceResponse> {
    const blocked = this.tick('warmup', {});
    if (blocked) return blocked;
    return (
      this.script.warmup ?? {
        ok: true,
        ipcheck: true,
        data: { session: 'fixture' },
        raw: { endpoint: 'warmup', request: {}, response: { session: 'fixture' } },
      }
    );
  }

  async fetchCourtCodes(): Promise<SourceResponse<CourtCode[]>> {
    const blocked = this.tick('courtCodeList', {});
    if (blocked) return blocked as SourceResponse<CourtCode[]>;
    const codes = this.script.courtCodes ?? [];
    return {
      ok: true,
      ipcheck: true,
      data: codes,
      raw: { endpoint: 'courtCodeList', request: {}, response: codes },
    };
  }

  async fetchAnnouncementList(req: ListRequest): Promise<SourceResponse<SourceRecord[]>> {
    const blocked = this.tick('listAnnouncement', req);
    if (blocked) return blocked as SourceResponse<SourceRecord[]>;
    const records = this.script.lists?.[listKey(req.court, req.yearMonth)] ?? [];
    return {
      ok: true,
      ipcheck: true,
      data: records,
      raw: { endpoint: 'listAnnouncement', request: req, response: records },
    };
  }

  async fetchAnnouncementDetail(req: DetailRequest): Promise<SourceResponse<SourceRecord>> {
    const blocked = this.tick('detailAnnouncement', req);
    if (blocked) return blocked as SourceResponse<SourceRecord>;
    const record = this.script.details?.[req.announcementId] ?? {};
    return {
      ok: true,
      ipcheck: true,
      data: record,
      raw: { endpoint: 'detailAnnouncement', request: req, response: record },
    };
  }
}
