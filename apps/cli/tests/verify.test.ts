import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TELEGRAM_BASE_URL,
  TgVerifyClient,
} from '../src/telegram/verify.js';
import type { TgFetchLike, TgFetchResponse } from '../src/telegram/verify.js';

/**
 * TgVerifyClient 검증. (결정 D4, CLI-REQ-002/011)
 *
 * fetchFn 을 주입해 캔드(canned) 응답으로 getMe/getUpdates 경로를 시험한다.
 * 실제 텔레그램 API 는 호출하지 않는다(네트워크 egress 0건).
 */

/** JSON 본문을 돌려주는 캔드 응답. */
function jsonResponse(status: number, body: unknown): TgFetchResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/** 호출 URL 을 캡처하며 지정 응답을 돌려주는 fetchFn. */
function cannedFetch(response: TgFetchResponse): { fetchFn: TgFetchLike; urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    fetchFn: async (url) => {
      urls.push(url);
      return response;
    },
  };
}

describe('TgVerifyClient.getMe', () => {
  it('ok=true 이면 유효 + username 반환', async () => {
    const { fetchFn, urls } = cannedFetch(
      jsonResponse(200, { ok: true, result: { username: 'ar_bot' } }),
    );
    const client = new TgVerifyClient({ token: 't', fetchFn, baseUrl: 'http://mock' });
    const res = await client.getMe();

    expect(res.ok).toBe(true);
    expect(res.username).toBe('ar_bot');
    expect(urls[0]).toBe('http://mock/bott/getMe');
  });

  it('username 이 없으면 유효하지만 username 필드는 생략', async () => {
    const { fetchFn } = cannedFetch(jsonResponse(200, { ok: true, result: {} }));
    const client = new TgVerifyClient({ token: 't', fetchFn, baseUrl: 'http://mock' });
    const res = await client.getMe();

    expect(res.ok).toBe(true);
    expect(res.username).toBeUndefined();
  });

  it('HTTP 오류(4xx)면 실패 + status 오류', async () => {
    const { fetchFn } = cannedFetch(jsonResponse(401, { ok: false }));
    const client = new TgVerifyClient({ token: 't', fetchFn, baseUrl: 'http://mock' });
    const res = await client.getMe();

    expect(res.ok).toBe(false);
    expect(res.error).toBe('HTTP 401');
  });

  it('telegram ok=false 면 실패', async () => {
    const { fetchFn } = cannedFetch(jsonResponse(200, { ok: false }));
    const client = new TgVerifyClient({ token: 't', fetchFn, baseUrl: 'http://mock' });
    const res = await client.getMe();

    expect(res.ok).toBe(false);
    expect(res.error).toBe('telegram ok=false');
  });

  it('네트워크 예외면 network 오류로 잡는다', async () => {
    const fetchFn: TgFetchLike = async () => {
      throw new Error('econnrefused');
    };
    const client = new TgVerifyClient({ token: 't', fetchFn, baseUrl: 'http://mock' });
    const res = await client.getMe();

    expect(res.ok).toBe(false);
    expect(res.error).toContain('network');
  });
});

describe('TgVerifyClient.getUpdates', () => {
  it('업데이트에서 chat_id 를 (중복 제거·순서 보존) 추출한다', async () => {
    const { fetchFn } = cannedFetch(
      jsonResponse(200, {
        ok: true,
        result: [
          { message: { chat: { id: 12345678 } } },
          { message: { chat: { id: 12345678 } } }, // 중복
          { message: { chat: { id: '99' } } },
          { message: {} }, // chat 없음 → 스킵
          {}, // message 없음 → 스킵
        ],
      }),
    );
    const client = new TgVerifyClient({ token: 't', fetchFn, baseUrl: 'http://mock' });
    const res = await client.getUpdates();

    expect(res.ok).toBe(true);
    expect(res.chatIds).toEqual(['12345678', '99']);
  });

  it('result 가 없으면 빈 목록', async () => {
    const { fetchFn } = cannedFetch(jsonResponse(200, { ok: true }));
    const client = new TgVerifyClient({ token: 't', fetchFn, baseUrl: 'http://mock' });
    const res = await client.getUpdates();

    expect(res.ok).toBe(true);
    expect(res.chatIds).toEqual([]);
  });

  it('HTTP 오류면 실패', async () => {
    const { fetchFn } = cannedFetch(jsonResponse(500, {}));
    const client = new TgVerifyClient({ token: 't', fetchFn, baseUrl: 'http://mock' });
    const res = await client.getUpdates();

    expect(res.ok).toBe(false);
    expect(res.error).toBe('HTTP 500');
  });

  it('telegram ok=false 면 실패', async () => {
    const { fetchFn } = cannedFetch(jsonResponse(200, { ok: false }));
    const client = new TgVerifyClient({ token: 't', fetchFn, baseUrl: 'http://mock' });
    const res = await client.getUpdates();

    expect(res.ok).toBe(false);
    expect(res.error).toBe('telegram ok=false');
  });

  it('네트워크 예외면 network 오류로 잡는다', async () => {
    const fetchFn: TgFetchLike = async () => {
      throw new Error('timeout');
    };
    const client = new TgVerifyClient({ token: 't', fetchFn, baseUrl: 'http://mock' });
    const res = await client.getUpdates();

    expect(res.ok).toBe(false);
    expect(res.chatIds).toEqual([]);
    expect(res.error).toContain('network');
  });
});

describe('TgVerifyClient URL 구성', () => {
  it('baseUrl 미지정 시 기본 텔레그램 URL 을 사용한다', async () => {
    const { fetchFn, urls } = cannedFetch(jsonResponse(200, { ok: true, result: {} }));
    const client = new TgVerifyClient({ token: 'abc', fetchFn });
    await client.getMe();

    expect(urls[0]).toBe(`${DEFAULT_TELEGRAM_BASE_URL}/botabc/getMe`);
  });

  it('baseUrl 뒤 슬래시를 제거한다', async () => {
    const { fetchFn, urls } = cannedFetch(jsonResponse(200, { ok: true, result: {} }));
    const client = new TgVerifyClient({ token: 'abc', fetchFn, baseUrl: 'http://mock///' });
    await client.getMe();

    expect(urls[0]).toBe('http://mock/botabc/getMe');
  });
});
