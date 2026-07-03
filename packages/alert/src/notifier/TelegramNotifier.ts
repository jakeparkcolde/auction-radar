import type { Clock } from '@auction-radar/core';
import { systemClock } from '@auction-radar/core';
import type { Notifier, RenderedMessage, SendResult } from './Notifier.js';

/**
 * TelegramNotifier — Bot API sendMessage 발송 구현. (REQ-010, 014, 결정 D3/D6)
 *
 * - 토큰/chat_id 는 생성자 config 로 주입한다. 환경변수나 하드코딩 토큰을 절대 읽지 않는다.
 * - fetch 는 주입 가능(default: 전역 fetch)하며, base URL 도 주입 가능해
 *   테스트에서 로컬 mock 텔레그램 서버로만 네트워크를 태울 수 있다(CI 실호출 0건).
 * - parse_mode=HTML 고정, disable_web_page_preview=true.
 * - 발송 간 1.1s 지연(같은 chat 초당 1건 rate limit 대응).
 * - 실패 시 지수 백오프로 최대 2회 재시도, 429 는 retry_after 를 존중한다.
 */

/** fetch 응답의 최소 형상(전역 Response 가 구조적으로 만족). */
export interface FetchResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

/** 주입 가능한 fetch 형상(전역 fetch 의 최소 부분집합). */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<FetchResponse>;

/** TelegramNotifier 생성자 설정. */
export interface TelegramConfig {
  /** Bot 토큰(주입 전용). */
  readonly token: string;
  /** 발송 대상 chat_id(주입 전용). */
  readonly chatId: string;
  /** 주입 fetch(기본: 전역 fetch). */
  readonly fetchFn?: FetchLike;
  /** 시간 소스(기본: systemClock). 테스트는 fake clock 주입. */
  readonly clock?: Clock;
  /** base URL(기본: https://api.telegram.org). 테스트는 mock 서버 url 주입. */
  readonly baseUrl?: string;
  /** 최대 재시도 횟수(기본 2 → 총 3회 시도). */
  readonly maxRetries?: number;
  /** 발송 간 지연 ms(기본 1100). */
  readonly interSendDelayMs?: number;
  /** 백오프 기준 ms(기본 500 → 500, 1000). */
  readonly backoffBaseMs?: number;
}

/** 기본 텔레그램 base URL. */
export const DEFAULT_TELEGRAM_BASE_URL = 'https://api.telegram.org' as const;
/** 기본 발송 간 지연(ms). */
export const DEFAULT_INTER_SEND_DELAY_MS = 1100 as const;

/** 전역 fetch 를 FetchLike 로 감싼 기본 구현. */
const defaultFetch: FetchLike = (url, init) =>
  globalThis.fetch(url, init as RequestInit) as unknown as Promise<FetchResponse>;

export class TelegramNotifier implements Notifier {
  private readonly token: string;
  private readonly chatId: string;
  private readonly fetchFn: FetchLike;
  private readonly clock: Clock;
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly interSendDelayMs: number;
  private readonly backoffBaseMs: number;
  /** 마지막 발송 시각(발송 간 지연 계산용). null 이면 아직 발송 없음. */
  private sentOnce = false;

  constructor(config: TelegramConfig) {
    this.token = config.token;
    this.chatId = config.chatId;
    this.fetchFn = config.fetchFn ?? defaultFetch;
    this.clock = config.clock ?? systemClock;
    this.baseUrl = (config.baseUrl ?? DEFAULT_TELEGRAM_BASE_URL).replace(/\/+$/, '');
    this.maxRetries = config.maxRetries ?? 2;
    this.interSendDelayMs = config.interSendDelayMs ?? DEFAULT_INTER_SEND_DELAY_MS;
    this.backoffBaseMs = config.backoffBaseMs ?? 500;
  }

  /** sendMessage 엔드포인트 URL. */
  private endpoint(): string {
    return `${this.baseUrl}/bot${this.token}/sendMessage`;
  }

  async send(msg: RenderedMessage): Promise<SendResult> {
    // 발송 간 1.1s 지연(최초 발송 제외).
    if (this.sentOnce) {
      await this.clock.sleep(this.interSendDelayMs);
    }
    this.sentOnce = true;

    const maxAttempts = this.maxRetries + 1;
    let backoff = this.backoffBaseMs;
    let attempts = 0;
    let last: SendResult = { ok: false, error: 'not-attempted' };

    for (let i = 0; i < maxAttempts; i += 1) {
      attempts += 1;
      last = await this.postOnce(msg.text);
      if (last.ok) return { ...last, attempts };
      if (!last.retryable || i === maxAttempts - 1) break;
      // 429 는 retry_after 를 존중, 그 외 재시도는 지수 백오프.
      const wait = last.retryAfterMs ?? backoff;
      await this.clock.sleep(wait);
      backoff *= 2;
    }
    return { ...last, attempts };
  }

  async sendDigest(msgs: RenderedMessage[]): Promise<SendResult[]> {
    const results: SendResult[] = [];
    for (const msg of msgs) {
      results.push(await this.send(msg));
    }
    return results;
  }

  /** 단일 HTTP 시도. 성공/재시도가능/영구실패를 SendResult 로 분류한다. */
  private async postOnce(text: string): Promise<SendResult> {
    const body = JSON.stringify({
      chat_id: this.chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });

    let resp: FetchResponse;
    try {
      resp = await this.fetchFn(this.endpoint(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
    } catch (err) {
      // 네트워크 예외는 재시도 가능으로 분류.
      return { ok: false, retryable: true, error: `network: ${String(err)}` };
    }

    if (resp.ok) return { ok: true };

    if (resp.status === 429) {
      const retryAfterSec = await this.readRetryAfter(resp);
      return {
        ok: false,
        retryable: true,
        error: 'telegram 429',
        ...(retryAfterSec !== null ? { retryAfterMs: retryAfterSec * 1000 } : {}),
      };
    }

    // 5xx 는 재시도 가능, 4xx(400 등 파싱 오류)는 영구 실패.
    return { ok: false, retryable: resp.status >= 500, error: `telegram HTTP ${resp.status}` };
  }

  /** 429 응답의 parameters.retry_after(초)를 읽는다. 실패 시 null. */
  private async readRetryAfter(resp: FetchResponse): Promise<number | null> {
    try {
      const data = (await resp.json()) as { parameters?: { retry_after?: number } };
      const sec = data.parameters?.retry_after;
      return typeof sec === 'number' ? sec : null;
    } catch {
      return null;
    }
  }
}
