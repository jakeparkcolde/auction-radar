import { mapUsage } from '@auction-radar/core';
import type { Confidence } from '../types.js';

/**
 * 신뢰도 등급 판정. (REQ-008, REQ-009)
 *
 * 규칙(기획서 §6.6 표):
 *   높음   = 동일 단지 표본 ≥ 5건(12개월)
 *   보통   = 동일 단지 3~4건 OR 법정동 면적 밴드 폴백 ≥ 10건
 *   낮음   = 그 외("참고치 (표본 부족)" 표기, 강조 금지)
 *   참고치 = 용도가 빌라·토지 계열이면 표본 수 무관 고정(강조 금지) — v1.x
 *
 * emphasize 는 높음/보통에서만 true(할인율 강조 허용), 낮음/참고치는 false.
 */

/** 빌라·토지 참고치 고정 대상 카테고리. */
const REFERENCE_ONLY = new Set(['빌라', '토지']);

/** 등급 판정 입력. */
export interface GradeInput {
  /** 사용된 표본 수. */
  readonly sampleCount: number;
  /** 면적 밴드 폴백 사용 여부. */
  readonly fallbackUsed: boolean;
  /** 원문 용도(mapUsage 입력). null 이면 아파트 계열로 취급. */
  readonly usage: string | null;
}

/** 등급 판정 결과. */
export interface GradeResult {
  readonly confidence: Confidence;
  readonly emphasize: boolean;
}

/**
 * 표본·폴백·용도로 신뢰도 등급과 강조 여부를 판정한다.
 */
export function gradeConfidence(input: GradeInput): GradeResult {
  // 빌라·토지 → 참고치 고정, 강조 억제. (REQ-009)
  const category = mapUsage(input.usage).category;
  if (REFERENCE_ONLY.has(category)) {
    return { confidence: '참고치', emphasize: false };
  }

  const { sampleCount, fallbackUsed } = input;

  if (fallbackUsed) {
    if (sampleCount >= 10) return { confidence: '보통', emphasize: true };
    return { confidence: '낮음', emphasize: false };
  }

  // 동일 단지 표본.
  if (sampleCount >= 5) return { confidence: '높음', emphasize: true };
  if (sampleCount >= 3) return { confidence: '보통', emphasize: true };
  return { confidence: '낮음', emphasize: false };
}
