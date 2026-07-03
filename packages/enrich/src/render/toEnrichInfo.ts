import type { Confidence, EnrichResult } from '../types.js';

/**
 * 알림 렌더러 소비용 어댑터. (REQ-011, 결정 D5)
 *
 * enrich 의 정규 EnrichResult 를 SPEC-ALERT-001 EnrichInfo 형상으로 매핑한다.
 * - discountPct = −round(discountRate × 100)  (할인이면 음수)
 * - sampleSize  = sampleCount
 * - confidence  = 표시 라벨(낮음 → "참고치 (표본 부족)")
 * - emphasize   = 강조 허용 여부(낮음/참고치는 false)
 *
 * 구조적 타이핑으로 alert 의 EnrichInfo({ discountPct, sampleSize, confidence, emphasize? })
 * 에 그대로 대입 가능하다(패키지 의존성 불필요).
 */

/** alert EnrichInfo 와 구조적으로 호환되는 어댑터 출력. */
export interface EnrichInfoLike {
  readonly discountPct: number;
  readonly sampleSize: number;
  readonly confidence: string;
  readonly emphasize: boolean;
}

/** 신뢰도 등급 → 알림 표시 라벨. */
const CONFIDENCE_LABEL: Record<Confidence, string> = {
  높음: '높음',
  보통: '보통',
  낮음: '참고치 (표본 부족)',
  참고치: '참고치',
};

/** enrich 등급의 알림 표시 라벨을 반환한다. */
export function confidenceLabel(confidence: Confidence): string {
  return CONFIDENCE_LABEL[confidence];
}

/**
 * EnrichResult 를 알림 렌더러 입력(EnrichInfo)으로 변환한다.
 *
 * @param result enrich 결과.
 */
export function toEnrichInfo(result: EnrichResult): EnrichInfoLike {
  // `-Math.round(0)` 은 -0 을 만드므로 `|| 0` 로 +0 정규화한다.
  const discountPct = -Math.round(result.discountRate * 100) || 0;
  return {
    discountPct,
    sampleSize: result.sampleCount,
    confidence: confidenceLabel(result.confidence),
    emphasize: result.emphasize,
  };
}
