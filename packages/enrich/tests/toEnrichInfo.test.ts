import { describe, expect, it } from 'vitest';
import { confidenceLabel, toEnrichInfo } from '../src/render/toEnrichInfo.js';
import type { EnrichResult } from '../src/types.js';

/**
 * 렌더 어댑터 — EnrichResult → EnrichInfo. (REQ-011, AC-03/06)
 */
function result(over: Partial<EnrichResult>): EnrichResult {
  return {
    discountRate: 0.319,
    medianPrice: 376_000_000,
    sampleCount: 14,
    confidence: '높음',
    fallbackUsed: false,
    emphasize: true,
    ...over,
  };
}

describe('toEnrichInfo (REQ-011)', () => {
  it('AC-03: 높음 결과 → discountPct=-32, sampleSize=14, confidence="높음", emphasize=true', () => {
    expect(toEnrichInfo(result({}))).toEqual({
      discountPct: -32,
      sampleSize: 14,
      confidence: '높음',
      emphasize: true,
    });
  });

  it('AC-06: 낮음 → 표시 라벨 "참고치 (표본 부족)", emphasize=false', () => {
    const info = toEnrichInfo(result({ confidence: '낮음', emphasize: false, sampleCount: 2 }));
    expect(info.confidence).toBe('참고치 (표본 부족)');
    expect(info.emphasize).toBe(false);
  });

  it('AC-07: 참고치(빌라·토지) → 라벨 "참고치", emphasize=false', () => {
    const info = toEnrichInfo(result({ confidence: '참고치', emphasize: false }));
    expect(info.confidence).toBe('참고치');
    expect(info.emphasize).toBe(false);
  });

  it('confidenceLabel 매핑', () => {
    expect(confidenceLabel('높음')).toBe('높음');
    expect(confidenceLabel('보통')).toBe('보통');
    expect(confidenceLabel('낮음')).toBe('참고치 (표본 부족)');
    expect(confidenceLabel('참고치')).toBe('참고치');
  });

  it('discountPct 는 반올림된 정수(음수=할인)', () => {
    expect(toEnrichInfo(result({ discountRate: 0.2 })).discountPct).toBe(-20);
    expect(toEnrichInfo(result({ discountRate: 0 })).discountPct).toBe(0);
  });
});
