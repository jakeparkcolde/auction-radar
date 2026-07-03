import { describe, expect, it } from 'vitest';
import { matchEvents, recordFailed, recordHeld, recordSent, selectUndelivered } from '../src/index.js';
import { addWatchlist, baseRecord, eventIdOf, freshStore, ingest, NOW } from './helpers.js';

const CONFIG = {
  name: '인천서구',
  courts: ['B000280'],
  regions: ['인천 서구'],
  usages: ['아파트'],
  appraisedMax: 500000000,
  minPriceRatioMax: 0.8,
  failedCountMin: 1,
  notify: ['price_drop'],
};

/** 2건의 price_drop 이벤트를 만들고 매칭한다. itemId 배열 반환. */
function seedTwoMatched(store: ReturnType<typeof freshStore>): number[] {
  const ids: number[] = [];
  for (let n = 1; n <= 2; n += 1) {
    const itemId = ingest(store, baseRecord(n));
    ingest(store, { ...baseRecord(n), failedCount: 1, minSalePrice: 256000000 });
    ids.push(itemId);
  }
  addWatchlist(store, CONFIG);
  matchEvents(store);
  return ids;
}

describe('selectUndelivered / record* (REQ-005/006, AC-04)', () => {
  it('AC-04: failed 2건이 재선별되어 sent 로 갱신되고, sent 는 재선별되지 않는다', () => {
    const store = freshStore();
    const items = seedTwoMatched(store);
    const evIds = items.map((id) => eventIdOf(store, id, 'price_drop'));

    // 지난 sync 에서 2건 실패로 기록.
    for (const id of evIds) recordFailed(store, id, 'telegram 500');

    const undelivered = selectUndelivered(store, NOW);
    expect(undelivered).toHaveLength(2);
    expect(undelivered.map((u) => u.eventId).sort()).toEqual([...evIds].sort());

    // 재발송 성공 기록.
    for (const u of undelivered) recordSent(store, u.eventId, NOW);

    // 이제 미발송 0 (sent 는 재선별 금지, REQ-006).
    expect(selectUndelivered(store, NOW)).toHaveLength(0);

    const sent = store.get<{ n: number }>(
      "SELECT count(*) AS n FROM notifications WHERE status = 'sent'",
    );
    expect(sent?.n).toBe(2);
    store.close();
  });

  it('처음 매칭된 이벤트(알림 이력 없음)는 즉시 미발송으로 선별된다', () => {
    const store = freshStore();
    seedTwoMatched(store);
    expect(selectUndelivered(store, NOW)).toHaveLength(2);
    store.close();
  });

  it('held + deliver_after 가 미래면 선별 안 됨, deliver_after 이후엔 선별됨', () => {
    const store = freshStore();
    const items = seedTwoMatched(store);
    const evId = eventIdOf(store, items[0] as number, 'price_drop');
    const otherId = eventIdOf(store, items[1] as number, 'price_drop');
    // 다른 1건은 이미 발송 처리(간섭 배제).
    recordSent(store, otherId, NOW);

    const deliverAfter = '2026-07-03T22:00:00.000Z';
    recordHeld(store, evId, deliverAfter);

    // now < deliver_after → 선별 안 됨.
    const before = selectUndelivered(store, '2026-07-03T21:00:00.000Z');
    expect(before.find((u) => u.eventId === evId)).toBeUndefined();

    // now >= deliver_after → 선별됨.
    const after = selectUndelivered(store, '2026-07-03T23:00:00.000Z');
    expect(after.map((u) => u.eventId)).toContain(evId);
    store.close();
  });

  it('선별된 이벤트는 렌더링용 payload 전/후 가격을 담는다', () => {
    const store = freshStore();
    seedTwoMatched(store);
    const undelivered = selectUndelivered(store, NOW);
    const first = undelivered[0];
    expect(first?.render.beforePrice).toBe(320000000);
    expect(first?.render.afterPrice).toBe(256000000);
    expect(first?.render.eventType).toBe('price_drop');
    store.close();
  });
});
