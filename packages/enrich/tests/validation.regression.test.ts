import { describe, expect, it } from 'vitest';
import { computeResult } from '../src/enrich.js';
import { mean, median } from '../src/stats/median.js';
import type { EnrichTarget } from '../src/types.js';
import { trade } from './helpers.js';

/**
 * 수동 대조 20건 중 대표 케이스 회귀 테스트. (docs/enrich-validation.md #1~#3, M3 DoD)
 *
 * 실 MOLIT API 호출 0건 — 순수 계산(computeResult)만 검증한다.
 */

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

describe('validation #1 — 동일 단지 14건 → −32% 높음', () => {
  it('중위값 376,000,000 대비 −32%, sampleCount=14, 높음, fallbackUsed=false', () => {
    const millions = [350, 355, 360, 365, 370, 375, 376, 376, 380, 385, 390, 395, 400, 405];
    const trades = millions.map((m) =>
      trade({ aptNameNorm: '청라한양수자인', area: 84.99, price: m * 1_000_000 }),
    );
    const res = computeResult(target({}), trades)!;
    expect(res.medianPrice).toBe(376_000_000);
    expect(-Math.round(res.discountRate * 100)).toBe(-32);
    expect(res.sampleCount).toBe(14);
    expect(res.confidence).toBe('높음');
    expect(res.fallbackUsed).toBe(false);
  });
});

describe('validation #2 — 면적 밴드 폴백 12건 → −16% 보통', () => {
  it('중위값 305,500,000, fallbackUsed=true, 보통', () => {
    const millions = [290, 295, 298, 300, 300, 301, 310, 315, 320, 325, 330, 340];
    const trades = millions.map((m) =>
      trade({ aptNameNorm: '완전히다른단지', area: 84.99, price: m * 1_000_000 }),
    );
    const res = computeResult(target({ aptName: '없는단지명' }), trades)!;
    expect(res.medianPrice).toBe(305_500_000);
    expect(-Math.round(res.discountRate * 100)).toBe(-16);
    expect(res.sampleCount).toBe(12);
    expect(res.fallbackUsed).toBe(true);
    expect(res.confidence).toBe('보통');
  });
});

describe('validation #3 — outlier 포함 5건, median≠mean', () => {
  it('중위값 360,000,000(평균 약 308M 아님) 대비 −29% 높음', () => {
    // [3.5억, 3.6억, 3.7억, 3.8억, 0.9억(outlier)]
    const prices = [350, 360, 370, 380, 90].map((m) => m * 1_000_000);
    const trades = prices.map((p) => trade({ aptNameNorm: '청라한양수자인', area: 84.99, price: p }));
    const res = computeResult(target({}), trades)!;

    expect(res.medianPrice).toBe(360_000_000);
    expect(median(prices)).not.toBe(mean(prices)); // median 사용 회귀 방지
    expect(-Math.round(res.discountRate * 100)).toBe(-29);
    expect(res.confidence).toBe('높음');
  });
});
