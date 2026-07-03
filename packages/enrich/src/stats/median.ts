/**
 * 중위값 계산. (REQ-006)
 *
 * 표본 통계는 반드시 중위값(median)을 사용한다 — 평균(mean)은 저층·특수거래
 * outlier 에 취약하므로 금지. 짝수 표본은 중앙 2값의 평균 규칙을 명시한다.
 */

/**
 * 숫자 표본의 중위값을 반환한다.
 *
 * - 홀수 표본: 정렬 후 정중앙 값.
 * - 짝수 표본: 정렬 후 중앙 2값의 산술 평균.
 * - 빈 표본: null.
 *
 * 입력 배열은 변형하지 않는다(복사 후 정렬).
 *
 * @param values 표본 값(원 단위 등 임의 스케일).
 */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid] as number;
  }
  const lo = sorted[mid - 1] as number;
  const hi = sorted[mid] as number;
  return (lo + hi) / 2;
}

/**
 * 산술 평균(회귀 방지 테스트용 참조 구현 — 프로덕션 통계에는 사용 금지).
 *
 * @internal median 사용을 강제하는 명시적 테스트에서 median !== mean 을 단정하기 위한 헬퍼.
 */
export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
