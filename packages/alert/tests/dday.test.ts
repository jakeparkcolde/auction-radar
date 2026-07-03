import { describe, expect, it } from 'vitest';
import { generateDdayEvents } from '../src/index.js';
import { baseRecord, freshStore, ingest } from './helpers.js';

// 2026-07-03T00:00:00Z == 2026-07-03T09:00 KST → todayKST = 2026-07-03
const NOW_INSTANT = new Date('2026-07-03T00:00:00Z');
const NOW_ISO = '2026-07-03T00:00:00Z';

describe('generateDdayEvents (REQ-007/008/009, AC-02)', () => {
  it('오늘+7 / 오늘+1 매각기일 물건에 d7 / d1 이벤트를 dedup_key 와 함께 생성한다', () => {
    const store = freshStore();
    // 물건 A: 매각기일 2026-07-10 (오늘+7)
    const itemA = ingest(store, { ...baseRecord(1), nextSaleDate: '2026-07-10' });
    // 물건 B: 매각기일 2026-07-04 (오늘+1)
    const itemB = ingest(store, { ...baseRecord(2), nextSaleDate: '2026-07-04' });

    const res = generateDdayEvents(store, NOW_INSTANT, NOW_ISO);
    expect(res.d7).toBe(1);
    expect(res.d1).toBe(1);

    const d7 = store.get<{ dedup_key: string }>('SELECT dedup_key FROM events WHERE type = ?', ['d7']);
    const d1 = store.get<{ dedup_key: string }>('SELECT dedup_key FROM events WHERE type = ?', ['d1']);
    expect(d7?.dedup_key).toBe(`${itemA}:d7:2026-07-10`);
    expect(d1?.dedup_key).toBe(`${itemB}:d1:2026-07-04`);
  });

  it('멱등: 재실행 시 신규 이벤트 0건 (dedup_key UNIQUE)', () => {
    const store = freshStore();
    ingest(store, { ...baseRecord(1), nextSaleDate: '2026-07-10' });
    expect(generateDdayEvents(store, NOW_INSTANT, NOW_ISO).d7).toBe(1);
    const again = generateDdayEvents(store, NOW_INSTANT, NOW_ISO);
    expect(again.d7).toBe(0);
    store.close();
  });

  it('AC-02/REQ-009: 수집기 차단 상태(blocked=1)여도 DB 기일만으로 생성된다', () => {
    const store = freshStore();
    ingest(store, { ...baseRecord(1), nextSaleDate: '2026-07-04' });
    // 수집 실패(차단) 기록.
    store.upsert('INSERT INTO sync_runs (blocked) VALUES (1)');

    const res = generateDdayEvents(store, NOW_INSTANT, NOW_ISO);
    expect(res.d1).toBe(1);
    // 생성기는 sync_runs 를 전혀 참조하지 않는다(차단과 무관하게 동작).
    const blocked = store.get<{ blocked: number }>('SELECT blocked FROM sync_runs LIMIT 1');
    expect(blocked?.blocked).toBe(1);
    store.close();
  });

  it('해당 기일이 없으면 이벤트를 만들지 않는다', () => {
    const store = freshStore();
    ingest(store, { ...baseRecord(1), nextSaleDate: '2026-12-31' });
    const res = generateDdayEvents(store, NOW_INSTANT, NOW_ISO);
    expect(res.d7).toBe(0);
    expect(res.d1).toBe(0);
    store.close();
  });
});
