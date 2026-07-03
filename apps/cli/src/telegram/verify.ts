/**
 * 텔레그램 검증 클라이언트. (SPEC-CLI-001 결정 D4, CLI-REQ-002/011)
 *
 * Bot API 의 getMe(토큰 유효성) / getUpdates(chat_id 자동 감지)만 담당한다.
 * fetch·baseUrl 을 주입 가능하게 해 CI 에서 실제 텔레그램 API 를 호출하지 않고
 * 캔드(canned) 응답으로 검증 경로를 시험한다(실호출 0건).
 *
 * 발송(sendMessage)은 ALERT 의 TelegramNotifier 가 담당한다(관심사 분리).
 */

/** 주입 가능한 fetch 응답의 최소 형상(전역 Response 가 구조적으로 만족). */
export interface TgFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

/** 주입 가능한 fetch(GET 전용). */
export type TgFetchLike = (url: string) => Promise<TgFetchResponse>;

/** 기본 텔레그램 base URL. */
export const DEFAULT_TELEGRAM_BASE_URL = 'https://api.telegram.org' as const;

/** TgVerifyClient 설정. */
export interface TgVerifyConfig {
  readonly token: string;
  readonly fetchFn?: TgFetchLike;
  readonly baseUrl?: string;
}

/** getMe 결과. */
export interface GetMeResult {
  readonly ok: boolean;
  readonly username?: string;
  readonly error?: string;
}

/** getUpdates 결과. */
export interface GetUpdatesResult {
  readonly ok: boolean;
  /** 업데이트에서 추출한 (중복 제거) chat_id 목록(발견 순서). */
  readonly chatIds: string[];
  readonly error?: string;
}

const defaultFetch: TgFetchLike = (url) =>
  globalThis.fetch(url) as unknown as Promise<TgFetchResponse>;

export class TgVerifyClient {
  private readonly token: string;
  private readonly fetchFn: TgFetchLike;
  private readonly baseUrl: string;

  constructor(config: TgVerifyConfig) {
    this.token = config.token;
    this.fetchFn = config.fetchFn ?? defaultFetch;
    this.baseUrl = (config.baseUrl ?? DEFAULT_TELEGRAM_BASE_URL).replace(/\/+$/, '');
  }

  private url(method: string): string {
    return `${this.baseUrl}/bot${this.token}/${method}`;
  }

  /** 토큰 유효성 확인(getMe). */
  async getMe(): Promise<GetMeResult> {
    let resp: TgFetchResponse;
    try {
      resp = await this.fetchFn(this.url('getMe'));
    } catch (err) {
      return { ok: false, error: `network: ${String(err)}` };
    }
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };

    const data = (await resp.json()) as {
      ok?: boolean;
      result?: { username?: string };
    };
    if (data.ok !== true) return { ok: false, error: 'telegram ok=false' };
    return { ok: true, ...(data.result?.username ? { username: data.result.username } : {}) };
  }

  /** 최근 업데이트에서 chat_id 를 추출한다(getUpdates). */
  async getUpdates(): Promise<GetUpdatesResult> {
    let resp: TgFetchResponse;
    try {
      resp = await this.fetchFn(this.url('getUpdates'));
    } catch (err) {
      return { ok: false, chatIds: [], error: `network: ${String(err)}` };
    }
    if (!resp.ok) return { ok: false, chatIds: [], error: `HTTP ${resp.status}` };

    const data = (await resp.json()) as {
      ok?: boolean;
      result?: Array<{ message?: { chat?: { id?: number | string } } }>;
    };
    if (data.ok !== true) return { ok: false, chatIds: [], error: 'telegram ok=false' };

    const seen = new Set<string>();
    const chatIds: string[] = [];
    for (const update of data.result ?? []) {
      const id = update.message?.chat?.id;
      if (id === undefined) continue;
      const key = String(id);
      if (!seen.has(key)) {
        seen.add(key);
        chatIds.push(key);
      }
    }
    return { ok: true, chatIds };
  }
}
