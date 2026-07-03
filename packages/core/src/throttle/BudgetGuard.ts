/**
 * 호출 budget 가드. (REQ-002)
 *
 * 세션당 호출 budget 을 강제한다.
 * - 기본 10회
 * - --max-calls 로 확대 가능하나 하드 상한 30회
 * budget 소진 시 수집을 중단하고 잔량 0 을 기록한다.
 */

/** 기본 세션 budget. */
export const DEFAULT_MAX_CALLS = 10 as const;

/** 하드 상한 (설정으로도 초과 불가). */
export const HARD_CAP_CALLS = 30 as const;

export class BudgetGuard {
  private readonly maxCalls: number;
  private usedCalls = 0;

  /**
   * @param requestedMaxCalls 요청 budget (미지정 시 기본 10, 30 초과 시 30 으로 클램프)
   */
  constructor(requestedMaxCalls: number = DEFAULT_MAX_CALLS) {
    const requested = Number.isFinite(requestedMaxCalls)
      ? Math.floor(requestedMaxCalls)
      : DEFAULT_MAX_CALLS;
    // 하한 0, 상한 30 으로 클램프.
    this.maxCalls = Math.min(HARD_CAP_CALLS, Math.max(0, requested));
  }

  /** 유효 budget 상한. */
  get limit(): number {
    return this.maxCalls;
  }

  /** 사용한 호출 수. */
  get used(): number {
    return this.usedCalls;
  }

  /** 남은 호출 수. */
  get remaining(): number {
    return this.maxCalls - this.usedCalls;
  }

  /** 다음 호출 여력이 있는지. */
  canCall(): boolean {
    return this.usedCalls < this.maxCalls;
  }

  /**
   * 호출 1회를 소비한다.
   *
   * @returns 소비 성공 여부. budget 소진 시 false (소비하지 않음).
   */
  tryConsume(): boolean {
    if (!this.canCall()) return false;
    this.usedCalls += 1;
    return true;
  }
}
