import { describe, expect, it } from 'vitest';
import { discountRate } from '../src/discount/discount.js';

/**
 * 할인율 계산. (REQ-006, AC-10)
 */
describe('discountRate (REQ-006)', () => {
  it('AC-10: 최저 256M / 중위 376M → 할인율 ≈ 0.319', () => {
    const rate = discountRate(256_000_000, 376_000_000);
    expect(rate).not.toBeNull();
    expect(rate as number).toBeCloseTo(0.319, 3);
    // −Math.round(rate*100) = −32
    expect(-Math.round((rate as number) * 100)).toBe(-32);
  });

  it('최저가 = 중위값이면 할인율 0', () => {
    expect(discountRate(300_000_000, 300_000_000)).toBe(0);
  });

  it('최저가 > 중위값이면 음수 할인율(프리미엄)', () => {
    expect(discountRate(400_000_000, 300_000_000)).toBeCloseTo(-0.333, 3);
  });

  it('중위값 0 이하이면 null', () => {
    expect(discountRate(100, 0)).toBeNull();
    expect(discountRate(100, -1)).toBeNull();
  });
});
