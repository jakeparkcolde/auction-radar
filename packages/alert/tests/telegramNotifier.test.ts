import type { Clock } from '@auction-radar/core';
import { describe, expect, it } from 'vitest';
import { TelegramNotifier } from '../src/index.js';
import type { FetchLike, FetchResponse } from '../src/index.js';

/** 지연을 기록하는 fake clock(실제 대기 없음). */
function fakeClock(): { clock: Clock; sleeps: number[] } {
  const sleeps: number[] = [];
  return {
    clock: {
      now: () => 0,
      sleep: async (ms: number) => {
        sleeps.push(ms);
      },
    },
    sleeps,
  };
}

interface ScriptResp {
  readonly status: number;
  readonly body?: unknown;
}

/** 스크립트된 응답을 순서대로 반환하는 fake fetch. */
function scriptedFetch(responses: ScriptResp[]): {
  fetchFn: FetchLike;
  calls: Array<{ url: string; body: string }>;
} {
  const calls: Array<{ url: string; body: string }> = [];
  let i = 0;
  const fetchFn: FetchLike = async (url, init) => {
    calls.push({ url, body: init.body });
    const r = responses[Math.min(i, responses.length - 1)] as ScriptResp;
    i += 1;
    const resp: FetchResponse = {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body ?? {},
      text: async () => JSON.stringify(r.body ?? {}),
    };
    return resp;
  };
  return { fetchFn, calls };
}

const baseConfig = { token: 'TESTTOKEN', chatId: '99999', backoffBaseMs: 500 };

describe('TelegramNotifier 발송 (REQ-010/014, D3/D6)', () => {
  it('성공 시 parse_mode=HTML · disable_web_page_preview · chat_id 를 담아 1회 발송', async () => {
    const { fetchFn, calls } = scriptedFetch([{ status: 200, body: { ok: true } }]);
    const { clock } = fakeClock();
    const notifier = new TelegramNotifier({ ...baseConfig, fetchFn, clock });

    const res = await notifier.send({ text: '<b>테스트</b>' });
    expect(res.ok).toBe(true);
    expect(res.attempts).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.telegram.org/botTESTTOKEN/sendMessage');
    const body = JSON.parse(calls[0]?.body ?? '{}');
    expect(body).toMatchObject({
      chat_id: '99999',
      text: '<b>테스트</b>',
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
  });

  it('발송 간 1.1s 지연을 적용한다(최초 제외)', async () => {
    const { fetchFn } = scriptedFetch([{ status: 200 }]);
    const { clock, sleeps } = fakeClock();
    const notifier = new TelegramNotifier({ ...baseConfig, fetchFn, clock });

    await notifier.send({ text: 'a' });
    await notifier.send({ text: 'b' });
    // 두 번째 발송 직전에 1100ms 지연.
    expect(sleeps).toContain(1100);
    expect(sleeps.filter((s) => s === 1100)).toHaveLength(1);
  });

  it('REQ-014: 429 는 retry_after(초)를 존중해 재시도 후 성공', async () => {
    const { fetchFn } = scriptedFetch([
      { status: 429, body: { ok: false, parameters: { retry_after: 3 } } },
      { status: 200, body: { ok: true } },
    ]);
    const { clock, sleeps } = fakeClock();
    const notifier = new TelegramNotifier({ ...baseConfig, fetchFn, clock });

    const res = await notifier.send({ text: 'x' });
    expect(res.ok).toBe(true);
    expect(res.attempts).toBe(2);
    // retry_after=3s → 3000ms 대기.
    expect(sleeps).toContain(3000);
  });

  it('REQ-014: 5xx 는 지수 백오프로 최대 2회 재시도 후 최종 실패', async () => {
    const { fetchFn, calls } = scriptedFetch([{ status: 500 }]);
    const { clock, sleeps } = fakeClock();
    const notifier = new TelegramNotifier({ ...baseConfig, fetchFn, clock });

    const res = await notifier.send({ text: 'x' });
    expect(res.ok).toBe(false);
    expect(res.attempts).toBe(3); // 1 + 2 재시도
    expect(calls).toHaveLength(3);
    // 지수 백오프: 500, 1000
    expect(sleeps).toEqual([500, 1000]);
  });

  it('4xx(파싱 오류 등)는 재시도하지 않고 즉시 실패', async () => {
    const { fetchFn, calls } = scriptedFetch([{ status: 400, body: { description: 'bad html' } }]);
    const { clock } = fakeClock();
    const notifier = new TelegramNotifier({ ...baseConfig, fetchFn, clock });

    const res = await notifier.send({ text: 'x' });
    expect(res.ok).toBe(false);
    expect(res.attempts).toBe(1);
    expect(calls).toHaveLength(1);
  });

  it('sendDigest 는 여러 메시지를 순차 발송하고 결과 배열을 반환', async () => {
    const { fetchFn, calls } = scriptedFetch([{ status: 200 }]);
    const { clock } = fakeClock();
    const notifier = new TelegramNotifier({ ...baseConfig, fetchFn, clock });

    const results = await notifier.sendDigest([{ text: 'a' }, { text: 'b' }, { text: 'c' }]);
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(calls).toHaveLength(3);
  });
});
