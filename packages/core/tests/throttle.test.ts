import { describe, expect, it } from 'vitest';
import { BudgetGuard, DEFAULT_MAX_CALLS, HARD_CAP_CALLS } from '../src/throttle/BudgetGuard.js';
import { Throttler, HARD_MIN_DELAY_MS, type Clock } from '../src/throttle/Throttler.js';

/** 가짜 clock: sleep 호출 시 논리 시간을 진행시키고 지연을 기록한다. */
function fakeClock(): { clock: Clock; sleeps: number[] } {
  let t = 0;
  const sleeps: number[] = [];
  const clock: Clock = {
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
  };
  return { clock, sleeps };
}

describe('Throttler (REQ-001, AC-09)', () => {
  it('minDelayMs 500 을 무시하고 2000ms 하한을 적용한다', () => {
    const t = new Throttler(500);
    expect(t.delayMs).toBe(HARD_MIN_DELAY_MS);
  });

  it('minDelayMs 3000 처럼 하한 이상이면 그 값을 유지한다', () => {
    expect(new Throttler(3000).delayMs).toBe(3000);
  });

  it('첫 호출은 대기하지 않고, 이후 호출은 2000ms 이상 대기한다 (fake clock)', async () => {
    const { clock, sleeps } = fakeClock();
    const t = new Throttler(500, clock);
    for (let i = 0; i < 5; i += 1) {
      await t.wait();
    }
    // 첫 호출 제외 4회 대기, 모두 2000ms.
    expect(sleeps).toEqual([2000, 2000, 2000, 2000]);
    expect(Math.min(...sleeps)).toBeGreaterThanOrEqual(2000);
  });
});

describe('BudgetGuard (REQ-002, AC-09)', () => {
  it('기본 budget 은 10회', () => {
    expect(new BudgetGuard().limit).toBe(DEFAULT_MAX_CALLS);
  });

  it('요청 50회는 하드 상한 30으로 클램프된다', () => {
    expect(new BudgetGuard(50).limit).toBe(HARD_CAP_CALLS);
  });

  it('요청 5회는 그대로 5', () => {
    expect(new BudgetGuard(5).limit).toBe(5);
  });

  it('tryConsume 은 상한까지만 true, 이후 false 이며 잔량 0', () => {
    const b = new BudgetGuard(3);
    expect(b.tryConsume()).toBe(true);
    expect(b.tryConsume()).toBe(true);
    expect(b.tryConsume()).toBe(true);
    expect(b.tryConsume()).toBe(false);
    expect(b.used).toBe(3);
    expect(b.remaining).toBe(0);
  });
});
