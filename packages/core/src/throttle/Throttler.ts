/**
 * 스로틀러. (REQ-001)
 *
 * courtauction.go.kr 대상 모든 호출 사이에 최소 2,000ms 지연을 강제한다.
 * minDelayMs 가 2000 미만이면 무시하고 2000ms 를 적용한다(하한 하드코딩).
 *
 * 테스트를 위해 clock(now/sleep)을 주입할 수 있다.
 */

/** 협상 불가능한 호출 간 지연 하한 (ms). */
export const HARD_MIN_DELAY_MS = 2000 as const;

/** 시간 소스 추상화 (테스트에서 가짜 clock 주입). */
export interface Clock {
  /** 현재 시각 (ms). */
  now(): number;
  /** 지정 시간(ms) 동안 대기. */
  sleep(ms: number): Promise<void>;
}

/** 실제 시스템 clock. */
export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export class Throttler {
  private readonly effectiveDelayMs: number;
  private lastCallAt: number | null = null;

  /**
   * @param minDelayMs 설정된 최소 지연 (2000 미만은 무시)
   * @param clock 시간 소스 (기본: systemClock)
   */
  constructor(
    minDelayMs: number = HARD_MIN_DELAY_MS,
    private readonly clock: Clock = systemClock,
  ) {
    // 하한 하드코딩: 2000 미만은 무시하고 2000 적용.
    this.effectiveDelayMs = Math.max(HARD_MIN_DELAY_MS, minDelayMs);
  }

  /** 실제 적용되는 지연 값(ms). */
  get delayMs(): number {
    return this.effectiveDelayMs;
  }

  /**
   * 다음 호출 전에 필요한 만큼 대기한다.
   *
   * 첫 호출은 대기하지 않고, 이후 호출은 직전 호출로부터 effectiveDelayMs 를 보장한다.
   */
  async wait(): Promise<void> {
    const current = this.clock.now();
    if (this.lastCallAt !== null) {
      const elapsed = current - this.lastCallAt;
      const remaining = this.effectiveDelayMs - elapsed;
      if (remaining > 0) {
        await this.clock.sleep(remaining);
      }
    }
    this.lastCallAt = this.clock.now();
  }
}
