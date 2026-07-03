import { afterEach, describe, expect, it } from 'vitest';
import { openReadOnly } from '../src/store/openReadOnly.js';
import { queryItems } from '../src/query/items.js';
import { queryEvents } from '../src/query/events.js';
import { queryWatchlistMatches } from '../src/query/matches.js';
import { querySyncStatus } from '../src/query/status.js';
import { enrichForItem } from '../src/query/enrichJoin.js';
import { makeTempDb, NOW, seedBlocked, seedFull, seedNoTrades } from './helpers.js';

describe('query 레이어 (REQ-004/007/008)', () => {
  const dbs: { cleanup(): void }[] = [];
  afterEach(() => {
    for (const d of dbs) d.cleanup();
    dbs.length = 0;
  });

  function open(seed: Parameters<typeof makeTempDb>[0]) {
    const db = makeTempDb(seed);
    dbs.push(db);
    return openReadOnly(db.path).store;
  }

  it('queryItems: 전체 물건 + 최신 매각기일 조인', () => {
    const store = open(seedFull);
    const items = queryItems(store);
    expect(items).toHaveLength(3);
    const a = items.find((i) => i.id === 100);
    expect(a?.case_number).toBe('2025타경1000');
    expect(a?.latest_sale_date).toBe('2026-07-08');
    store.close();
  });

  it('queryItems(watchlistId): 매칭 물건만 (AC-03 물건 좁힘)', () => {
    const store = open(seedFull);
    const filtered = queryItems(store, { watchlistId: 1 });
    const ids = filtered.map((i) => i.id).sort();
    expect(ids).toEqual([100, 101]); // C(102)는 미매칭 제외
    store.close();
  });

  it('queryEvents: 타입·워치리스트 필터 (AC-03 이벤트 좁힘)', () => {
    const store = open(seedFull);
    const all = queryEvents(store);
    expect(all.length).toBe(4);
    const filtered = queryEvents(store, { watchlistId: 1, type: 'price_drop' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.type).toBe('price_drop');
    expect(filtered[0]?.item_id).toBe(100);
    store.close();
  });

  it('queryEvents: 기간(sinceIso) 필터', () => {
    const store = open(seedFull);
    const future = new Date(NOW.getTime() + 86_400_000).toISOString();
    expect(queryEvents(store, { sinceIso: future })).toHaveLength(0);
    store.close();
  });

  it('queryWatchlistMatches: 워치리스트별 매칭 수', () => {
    const store = open(seedFull);
    const wl = queryWatchlistMatches(store);
    const w1 = wl.find((w) => w.watchlist_id === 1);
    expect(w1?.name).toBe('인천 서구 아파트');
    expect(w1?.match_count).toBe(3); // event 1000,1001,1002
    store.close();
  });

  it('querySyncStatus: 성공 시나리오는 latest 성공', () => {
    const store = open(seedFull);
    const status = querySyncStatus(store);
    expect(status.latest?.blocked).toBe(0);
    expect(status.lastSuccessAt).not.toBeNull();
    store.close();
  });

  it('querySyncStatus: 차단 시 latest.blocked=1 + 마지막 성공 보존 (AC-08)', () => {
    const store = open(seedBlocked);
    const status = querySyncStatus(store);
    expect(status.latest?.blocked).toBe(1);
    expect(status.latest?.error).toBe('레이트 리밋 차단');
    expect(status.lastSuccessAt).not.toBeNull();
    store.close();
  });

  it('enrichForItem: 높음(−32%, 표본 14, 강조)', () => {
    const store = open(seedFull);
    const a = queryItems(store).find((i) => i.id === 100)!;
    const enrich = enrichForItem(store, a, NOW);
    expect(enrich).not.toBeNull();
    expect(enrich?.discountPct).toBe(-32);
    expect(enrich?.sampleSize).toBe(14);
    expect(enrich?.confidence).toBe('높음');
    expect(enrich?.emphasize).toBe(true);
    store.close();
  });

  it('enrichForItem: 낮음(−15%, 표본 2, 강조 없음 → 참고치 라벨)', () => {
    const store = open(seedFull);
    const b = queryItems(store).find((i) => i.id === 101)!;
    const enrich = enrichForItem(store, b, NOW);
    expect(enrich?.discountPct).toBe(-15);
    expect(enrich?.sampleSize).toBe(2);
    expect(enrich?.confidence).toBe('참고치 (표본 부족)');
    expect(enrich?.emphasize).toBe(false);
    store.close();
  });

  it('enrichForItem: lawd_cd 없으면 null', () => {
    const store = open(seedFull);
    const c = queryItems(store).find((i) => i.id === 102)!;
    expect(enrichForItem(store, c, NOW)).toBeNull();
    store.close();
  });

  it('enrichForItem: rt_trades 비면 null (AC-07)', () => {
    const store = open(seedNoTrades);
    const item = queryItems(store)[0]!;
    expect(enrichForItem(store, item, NOW)).toBeNull();
    store.close();
  });
});
