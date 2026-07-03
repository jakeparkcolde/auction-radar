import { describe, expect, it, vi } from 'vitest';
import type { MolitClient } from '../src/molit/client.js';
import {
  last12Months,
  loadTradesForLawd,
  refreshRtTradesCache,
  shouldRefresh,
  writeTrades,
} from '../src/cache/rtTradesCache.js';
import { makeStore, seedTrades, trade } from './helpers.js';

/**
 * rt_trades 캐시 — 월 게이트·12개월 조합·delete-then-insert. (REQ-002, AC-02)
 */
describe('last12Months (REQ-002)', () => {
  it('당월 포함 최근 12개월 YYYYMM 을 반환한다', () => {
    const months = last12Months(new Date('2026-07-03T00:00:00Z'));
    expect(months).toHaveLength(12);
    expect(months[0]).toBe('202607');
    expect(months[1]).toBe('202606');
    expect(months[11]).toBe('202508'); // 12개월 전
  });
});

describe('shouldRefresh — 월 게이트 (REQ-002, AC-02)', () => {
  it('이번 달에 이미 fetch 된 조합은 재조회하지 않는다(false)', () => {
    const store = makeStore();
    // 이번 달(2026-07) fetched.
    seedTrades(store, [trade({ dealYm: '202606', price: 100 })], '2026-07-01T09:00:00Z');
    expect(shouldRefresh(store, '28260', '202606', new Date('2026-07-03T00:00:00Z'))).toBe(false);
  });

  it('지난 달에 fetch 된 조합은 재조회한다(true)', () => {
    const store = makeStore();
    seedTrades(store, [trade({ dealYm: '202606', price: 100 })], '2026-06-20T09:00:00Z');
    expect(shouldRefresh(store, '28260', '202606', new Date('2026-07-03T00:00:00Z'))).toBe(true);
  });

  it('캐시가 없으면 재조회한다(true)', () => {
    const store = makeStore();
    expect(shouldRefresh(store, '28260', '202606', new Date('2026-07-03T00:00:00Z'))).toBe(true);
  });
});

describe('writeTrades — delete-then-insert (REQ-002)', () => {
  it('동일 조합 재기록은 기존 행을 지우고 새로 넣는다(멱등)', () => {
    const store = makeStore();
    writeTrades(store, '28260', '202606', [trade({ price: 100 })], '2026-07-01T00:00:00Z');
    writeTrades(
      store,
      '28260',
      '202606',
      [trade({ price: 200 }), trade({ price: 300 })],
      '2026-07-02T00:00:00Z',
    );
    const rows = loadTradesForLawd(store, '28260', ['202606']);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.price).sort((a, b) => a - b)).toEqual([200, 300]);
  });
});

describe('refreshRtTradesCache (REQ-002, AC-02)', () => {
  it('AC-02: 이번 달 이미 fetch 된 조합은 fetchFn 을 호출하지 않는다', async () => {
    const store = makeStore();
    // (28260, 202607)·(28260, 202606)... 모든 최근 12개월을 이번 달 fetch 로 시드.
    const now = new Date('2026-07-03T00:00:00Z');
    for (const ym of last12Months(now)) {
      seedTrades(store, [trade({ dealYm: ym, price: 100 })], '2026-07-02T00:00:00Z');
    }
    const fetchMonth = vi.fn();
    const client = { fetchMonth } as unknown as MolitClient;

    const summary = await refreshRtTradesCache(store, client, ['28260'], { now: () => now });
    expect(fetchMonth).not.toHaveBeenCalled();
    expect(summary.skipped).toBe(12);
    expect(summary.fetched).toBe(0);
  });

  it('갱신 필요한 조합만 fetch 하고 오류는 격리한다(캐시 유지)', async () => {
    const store = makeStore();
    const now = new Date('2026-07-03T00:00:00Z');
    // 실패해도 예외 없이 계속 진행.
    const fetchMonth = vi.fn().mockRejectedValue(new Error('quota exceeded'));
    const client = { fetchMonth } as unknown as MolitClient;

    const summary = await refreshRtTradesCache(store, client, ['28260'], { now: () => now });
    expect(summary.errors).toBe(12);
    expect(summary.fetched).toBe(0);
    // 예외가 전파되지 않음(무중단).
  });
});
