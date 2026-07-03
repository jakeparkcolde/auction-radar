import { describe, expect, it } from 'vitest';
import { generateEvents } from '../src/diff/index.js';
import type { ItemState } from '../src/types.js';

function state(overrides: Partial<ItemState> = {}): ItemState {
  return {
    itemId: 1,
    minSalePrice: 320000000,
    failedCount: 0,
    nextSaleDate: '2026-07-28',
    correctionCount: 0,
    cancellationCount: 0,
    status: '진행중',
    ...overrides,
  };
}

describe('generateEvents (REQ-014, §6.3)', () => {
  it('신건: prev=null → new 이벤트 1건, dedup {item}:new, payload 에 감정가·최저가·기일', () => {
    const next = state({ appraisedPrice: 400000000 });
    const events = generateEvents(null, next);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('new');
    expect(events[0]?.dedupKey).toBe('1:new');
    expect(events[0]?.payload).toMatchObject({
      appraisedPrice: 400000000,
      minSalePrice: 320000000,
      saleDate: '2026-07-28',
    });
  });

  it('유찰: failed_count 증가 + 최저가 하락 → price_drop, dedup {item}:drop:1 (AC-03)', () => {
    const prev = state({ failedCount: 0, minSalePrice: 320000000 });
    const next = state({ failedCount: 1, minSalePrice: 256000000 });
    const events = generateEvents(prev, next);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('price_drop');
    expect(events[0]?.dedupKey).toBe('1:drop:1');
    expect(events[0]?.payload).toMatchObject({
      before: { minSalePrice: 320000000, failedCount: 0 },
      after: { minSalePrice: 256000000, failedCount: 1 },
    });
  });

  it('최저가만 하락(유찰 미증가)해도 price_drop 이 발생한다', () => {
    const prev = state({ minSalePrice: 300000000 });
    const next = state({ minSalePrice: 250000000 });
    const events = generateEvents(prev, next);
    expect(events.map((e) => e.type)).toContain('price_drop');
  });

  it('기일 변경 → changed, dedup {item}:chg:{state_hash}', () => {
    const prev = state({ nextSaleDate: '2026-07-28', status: '유찰' });
    const next = state({ nextSaleDate: '2026-08-25', status: '변경' });
    const events = generateEvents(prev, next);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('changed');
    expect(events[0]?.dedupKey).toMatch(/^1:chg:[0-9a-f]{40}$/);
  });

  it('취하 전이 → cancelled 만 생성(changed 로 중복되지 않음), dedup {item}:cancel', () => {
    const prev = state({ status: '변경' });
    const next = state({ status: '취하' });
    const events = generateEvents(prev, next);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('cancelled');
    expect(events[0]?.dedupKey).toBe('1:cancel');
  });

  it('변화 없음 → 이벤트 0건', () => {
    const s = state();
    expect(generateEvents(s, { ...s })).toHaveLength(0);
  });

  it('correction/cancellation 증가 → changed', () => {
    const prev = state();
    const next = state({ correctionCount: 1 });
    expect(generateEvents(prev, next).map((e) => e.type)).toEqual(['changed']);
  });
});
