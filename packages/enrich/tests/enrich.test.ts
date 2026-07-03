import { describe, expect, it, vi } from 'vitest';
import { computeResult, enrichUndelivered, loadEnrichTargets } from '../src/enrich.js';
import { resolveEnrichConfig } from '../src/config.js';
import type { MolitFetchLike } from '../src/molit/client.js';
import type { EnrichTarget, RtTradeRecord } from '../src/types.js';
import { makeStore, seedTrades, trade } from './helpers.js';

/**
 * 오케스트레이터 — AC-01/04/08/09 + 실패 격리. (REQ-002/003/005)
 */

const NOW = new Date('2026-07-03T00:00:00Z');

/** median 이 정확히 376,000,000 이 되는 14건(동일 단지). */
function complex14(): RtTradeRecord[] {
  const millions = [350, 355, 360, 365, 370, 375, 376, 376, 380, 385, 390, 395, 400, 405];
  return millions.map((m) =>
    trade({ aptNameNorm: '청라한양수자인', area: 84.99, price: m * 1_000_000, dealYm: '202606' }),
  );
}

function target(over: Partial<EnrichTarget>): EnrichTarget {
  return {
    eventId: 1,
    lawdCd: '28260',
    minSalePrice: 256_000_000,
    usage: '아파트',
    aptName: '청라한양수자인',
    area: 84.99,
    ...over,
  };
}

describe('computeResult — 순수 조립 (AC-01)', () => {
  it('AC-01: 동일 단지 14건 → discountRate≈0.319, confidence=높음, sampleCount=14, fallbackUsed=false', () => {
    const res = computeResult(target({}), complex14());
    expect(res).not.toBeNull();
    expect(res!.medianPrice).toBe(376_000_000);
    expect(res!.discountRate).toBeCloseTo(0.319, 3);
    expect(res!.confidence).toBe('높음');
    expect(res!.sampleCount).toBe(14);
    expect(res!.fallbackUsed).toBe(false);
    expect(res!.emphasize).toBe(true);
  });

  it('AC-04: 단지명 매칭 0건, 면적 밴드 12건 → fallbackUsed=true, 보통', () => {
    const trades = Array.from({ length: 12 }, (_, i) =>
      trade({ aptNameNorm: '전혀다른단지', area: 84.99, price: 300_000_000 + i * 1_000_000 }),
    );
    const res = computeResult(target({ aptName: '없는단지', area: 84.99 }), trades);
    expect(res).not.toBeNull();
    expect(res!.fallbackUsed).toBe(true);
    expect(res!.confidence).toBe('보통');
  });

  it('표본 0건이면 null(할인율 계산 불가)', () => {
    expect(computeResult(target({}), [])).toBeNull();
  });

  it('lawd_cd/최저가 부재 시 null', () => {
    expect(computeResult(target({ lawdCd: null }), complex14())).toBeNull();
    expect(computeResult(target({ minSalePrice: null }), complex14())).toBeNull();
  });
});

describe('enrichUndelivered — 캐시 기준 계산 (enabled=false)', () => {
  it('AC-01 end-to-end: 캐시에서 14건을 읽어 높음 결과를 만든다', async () => {
    const store = makeStore();
    seedTrades(store, complex14(), '2026-07-02T00:00:00Z');
    const config = resolveEnrichConfig({ enabled: false });

    const map = await enrichUndelivered(store, config, [target({ eventId: 42 })], { now: () => NOW });
    const res = map.get(42);
    expect(res).not.toBeNull();
    expect(res!.confidence).toBe('높음');
    expect(res!.sampleCount).toBe(14);
  });
});

describe('enrichUndelivered — 실패 격리 (AC-08/09)', () => {
  it('AC-08: fetchFn 이 쿼터 오류를 던져도 예외 없이, 캐시 있는 물건은 계산·없으면 null', async () => {
    const store = makeStore();
    // 28260 은 지난 달 fetch(월 게이트 통과 → refresh 시도) + 캐시 존재.
    seedTrades(store, complex14(), '2026-06-20T00:00:00Z');
    const config = resolveEnrichConfig({ enabled: true, molitKey: 'DECODED' });
    const fetchFn: MolitFetchLike = () => Promise.reject(new Error('quota exceeded'));

    const targets = [
      target({ eventId: 1, lawdCd: '28260' }), // 캐시 있음 → 계산
      target({ eventId: 2, lawdCd: '11110' }), // 캐시 없음 → null
    ];
    const map = await enrichUndelivered(store, config, targets, { now: () => NOW, fetchFn });

    expect(map.get(1)).not.toBeNull();
    expect(map.get(1)!.confidence).toBe('높음');
    expect(map.get(2)).toBeNull();
  });

  it('AC-09: lawd_cd NULL 물건은 예외 없이 null(실거래 비교 불가)', async () => {
    const store = makeStore();
    const config = resolveEnrichConfig({ enabled: false });
    const warn = vi.fn();
    const info = vi.fn();

    const map = await enrichUndelivered(store, config, [target({ eventId: 7, lawdCd: null })], {
      now: () => NOW,
      logger: { warn, info },
    });
    expect(map.get(7)).toBeNull();
    expect(info).toHaveBeenCalledWith(expect.stringContaining('실거래 비교 불가'));
  });

  it('빈 targets 는 빈 맵', async () => {
    const store = makeStore();
    const map = await enrichUndelivered(store, resolveEnrichConfig(), [], { now: () => NOW });
    expect(map.size).toBe(0);
  });
});

describe('loadEnrichTargets — items 조인 (sync 배선)', () => {
  it('이벤트 id 로 물건 정보를 로드한다(aptName=address_raw, area=null)', () => {
    const store = makeStore();
    store.upsert(
      'INSERT INTO cases (id, court_code, case_number, updated_at) VALUES (1, ?, ?, ?)',
      ['B000210', '2025타경1', '2026-07-01'],
    );
    store.upsert(
      `INSERT INTO items (id, case_id, item_no, usage, address_raw, lawd_cd, min_sale_price, first_seen_at, last_seen_at)
       VALUES (1, 1, 1, ?, ?, ?, ?, ?, ?)`,
      ['아파트', '인천 서구 청라동 청라한양수자인', '28260', 256_000_000, '2026-07-01', '2026-07-01'],
    );
    store.upsert(
      'INSERT INTO events (id, item_id, type, payload, dedup_key, created_at) VALUES (10, 1, ?, ?, ?, ?)',
      ['price_drop', '{}', 'k1', '2026-07-01'],
    );

    const targets = loadEnrichTargets(store, [10]);
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      eventId: 10,
      lawdCd: '28260',
      minSalePrice: 256_000_000,
      usage: '아파트',
      area: null,
    });
    expect(targets[0]!.aptName).toContain('청라한양수자인');
  });

  it('빈 이벤트 목록은 빈 배열', () => {
    expect(loadEnrichTargets(makeStore(), [])).toEqual([]);
  });
});
