/**
 * 할인율 계산. (REQ-006)
 *
 * 할인율 = 1 − (최저매각가 / 실거래 중위값).
 * 예) 최저 256,000,000 / 중위 376,000,000 → 1 − 0.6809 ≈ 0.319 (−32%).
 */

/**
 * 최저매각가와 실거래 중위값으로 할인율(비율)을 계산한다.
 *
 * @param minSalePrice 최저매각가(원).
 * @param medianPrice  실거래 중위값(원). 0 이하이면 계산 불가.
 * @returns 할인율 비율(예: 0.319). 중위값이 0 이하이면 null.
 */
export function discountRate(minSalePrice: number, medianPrice: number): number | null {
  if (medianPrice <= 0) return null;
  return 1 - minSalePrice / medianPrice;
}
