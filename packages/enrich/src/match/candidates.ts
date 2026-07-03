import type { RtTradeRecord } from '../types.js';
import { aptNameNorm } from '../normalize/aptName.js';

/**
 * 후보 산정. (REQ-004)
 *
 * 입력 trades 는 이미 대상 lawd_cd 로 필터된 12개월 실거래이다.
 * 산정 순서:
 *   ① 같은 lawd_cd + 단지명 포함 매칭 + 전용면적 ±10%  (fallbackUsed=false)
 *   ② ①이 0건이면 같은 lawd_cd + 면적 밴드 전체 폴백    (fallbackUsed=true, 신뢰도 강등)
 *
 * area 가 null 이면 면적 필터를 생략한다(단지명만/전체).
 */

/** 후보 산정 결과. */
export interface CandidateResult {
  /** 후보 실거래가(원 단위) 목록. */
  readonly prices: number[];
  /** 면적 밴드 폴백이 사용되었는지. */
  readonly fallbackUsed: boolean;
}

/** 면적 밴드(±10%) 판정. 대상 area 가 null 이면 항상 통과. */
const AREA_BAND = 0.1;

function withinAreaBand(tradeArea: number | null, targetArea: number | null): boolean {
  if (targetArea === null) return true;
  if (tradeArea === null) return false;
  const tolerance = targetArea * AREA_BAND;
  return Math.abs(tradeArea - targetArea) <= tolerance;
}

/** 단지명 포함 매칭(양방향 contains). 대상 이름이 비면 매칭 불가. */
function nameContains(tradeName: string | null, targetNorm: string): boolean {
  if (targetNorm.length === 0) return false;
  const t = aptNameNorm(tradeName);
  if (t.length === 0) return false;
  return t.includes(targetNorm) || targetNorm.includes(t);
}

/**
 * 대상 물건에 대한 실거래 후보를 산정한다.
 *
 * @param trades   대상 lawd_cd 로 필터된 실거래 레코드.
 * @param aptName  대상 단지명 원문(정규화 전).
 * @param area     대상 전용면적(㎡) 또는 null.
 */
export function selectCandidates(
  trades: readonly RtTradeRecord[],
  aptName: string | null,
  area: number | null,
): CandidateResult {
  const targetNorm = aptNameNorm(aptName);

  // ① 단지명 포함 + 면적 ±10%
  const sameComplex = trades.filter(
    (t) => nameContains(t.aptNameNorm, targetNorm) && withinAreaBand(t.area, area),
  );
  if (sameComplex.length > 0) {
    return { prices: sameComplex.map((t) => t.price), fallbackUsed: false };
  }

  // ② 면적 밴드 전체 폴백
  const band = trades.filter((t) => withinAreaBand(t.area, area));
  return { prices: band.map((t) => t.price), fallbackUsed: true };
}
