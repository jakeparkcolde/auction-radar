import { describe, expect, it } from 'vitest';
import { mean, median } from '../src/stats/median.js';

/**
 * 중위값 계산. (REQ-006, AC-10)
 *
 * 반드시 median 을 사용하고 mean 을 사용하지 않는다(outlier 방어).
 */
describe('median (REQ-006)', () => {
  it('AC-10: outlier 포함 홀수 표본은 중위값을 반환하고 평균과 다르다', () => {
    // [3.5억, 3.6억, 3.7억, 3.8억, 0.9억(특수거래 outlier)]
    const samples = [350_000_000, 360_000_000, 370_000_000, 380_000_000, 90_000_000];
    expect(median(samples)).toBe(360_000_000); // 3.6억
    // 평균(약 3.1억)이 아님을 명시적으로 검증(mean 사용 회귀 방지).
    expect(mean(samples)).toBe(310_000_000);
    expect(median(samples)).not.toBe(mean(samples));
  });

  it('짝수 표본은 중앙 2값의 평균 규칙을 따른다', () => {
    expect(median([100, 200, 300, 400])).toBe(250); // (200+300)/2
    expect(median([10, 20])).toBe(15);
  });

  it('홀수 표본은 정중앙 값을 반환한다', () => {
    expect(median([5, 1, 3])).toBe(3); // 정렬 [1,3,5]
  });

  it('입력 배열을 변형하지 않는다', () => {
    const input = [3, 1, 2];
    median(input);
    expect(input).toEqual([3, 1, 2]);
  });

  it('빈 표본은 null 을 반환한다', () => {
    expect(median([])).toBeNull();
    expect(mean([])).toBeNull();
  });
});
