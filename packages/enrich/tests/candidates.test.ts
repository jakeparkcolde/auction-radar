import { describe, expect, it } from 'vitest';
import { selectCandidates } from '../src/match/candidates.js';
import { trade } from './helpers.js';

/**
 * 후보 산정 — 단지명 포함 + 면적 ±10% → 폴백. (REQ-004, AC-04)
 */
describe('selectCandidates (REQ-004)', () => {
  it('단지명 포함 + 면적 ±10% 내 후보를 우선 선정한다(fallbackUsed=false)', () => {
    const trades = [
      trade({ aptNameNorm: '청라한양수자인', area: 84.99, price: 370_000_000 }),
      trade({ aptNameNorm: '청라한양수자인', area: 80.0, price: 360_000_000 }),
      trade({ aptNameNorm: '다른단지', area: 84.99, price: 999_000_000 }),
    ];
    const res = selectCandidates(trades, '청라한양수자인', 84.99);
    expect(res.fallbackUsed).toBe(false);
    expect(res.prices).toHaveLength(2);
    expect(res.prices).toContain(370_000_000);
    expect(res.prices).toContain(360_000_000);
  });

  it('면적 ±10% 경계값을 포함한다(inclusive)', () => {
    // target 100㎡, ±10% → [90, 110] 경계 포함.
    const trades = [
      trade({ aptNameNorm: '경계단지', area: 90, price: 1 }),
      trade({ aptNameNorm: '경계단지', area: 110, price: 2 }),
      trade({ aptNameNorm: '경계단지', area: 89.9, price: 3 }), // 밴드 밖
      trade({ aptNameNorm: '경계단지', area: 110.1, price: 4 }), // 밴드 밖
    ];
    const res = selectCandidates(trades, '경계단지', 100);
    expect(res.fallbackUsed).toBe(false);
    expect(res.prices.sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it('AC-04: 단지명 매칭 0건이면 면적 밴드 전체로 폴백(fallbackUsed=true)', () => {
    const trades = Array.from({ length: 12 }, (_, i) =>
      trade({ aptNameNorm: '전혀다른단지', area: 84.99, price: 300_000_000 + i }),
    );
    const res = selectCandidates(trades, '없는단지명', 84.99);
    expect(res.fallbackUsed).toBe(true);
    expect(res.prices).toHaveLength(12);
  });

  it('target area 가 null 이면 면적 필터를 생략한다', () => {
    const trades = [
      trade({ aptNameNorm: '청라한양수자인', area: 40, price: 100 }),
      trade({ aptNameNorm: '청라한양수자인', area: 200, price: 200 }),
    ];
    const res = selectCandidates(trades, '청라한양수자인', null);
    expect(res.fallbackUsed).toBe(false);
    expect(res.prices).toHaveLength(2);
  });

  it('후보가 전혀 없으면 빈 폴백 결과', () => {
    const res = selectCandidates([], '아무단지', 84.99);
    expect(res.fallbackUsed).toBe(true);
    expect(res.prices).toHaveLength(0);
  });
});
