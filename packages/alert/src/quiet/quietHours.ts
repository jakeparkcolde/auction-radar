import { isWithinQuietHours, nextWindowEndISO } from '../time/kst.js';

/**
 * Quiet Hours 판정. (SPEC-ALERT-001 REQ-015/016, AC-07/08)
 *
 * - 발송 시각이 quietHours(기본 23:00~07:00, KST) 내이면 보류(held) + deliver_after=창 종료 시각.
 * - 아침 첫 발송에서 보류분을 digest 로 합산(오케스트레이션이 buildDigest 로 처리).
 * - 이벤트 종류가 d1 이면 quiet hours 예외로 즉시 발송.
 */

/** 기본 quiet hours 창(KST). */
export const DEFAULT_QUIET_HOURS: readonly [string, string] = ['23:00', '07:00'];

/** 발송 결정. */
export type DeliveryDecision =
  | { readonly action: 'send' }
  | { readonly action: 'hold'; readonly deliverAfter: string };

/**
 * 이벤트의 즉시 발송/보류를 결정한다.
 *
 * @param eventType 이벤트 종류(d1 은 예외).
 * @param now 판정 기준 instant(Date|epoch ms).
 * @param quietHours 창 [시작, 종료] "HH:MM"(KST).
 */
export function decideDelivery(
  eventType: string,
  now: Date | number,
  quietHours: readonly [string, string] = DEFAULT_QUIET_HOURS,
): DeliveryDecision {
  // d1 은 quiet hours 예외 — 즉시 발송(REQ-016).
  if (eventType === 'd1') {
    return { action: 'send' };
  }
  if (isWithinQuietHours(now, quietHours)) {
    return { action: 'hold', deliverAfter: nextWindowEndISO(now, quietHours) };
  }
  return { action: 'send' };
}
