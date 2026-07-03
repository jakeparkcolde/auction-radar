import { describe, expect, it } from 'vitest';
import { decideDelivery } from '../src/index.js';

/** KST 벽시계 → UTC instant. */
function kstInstant(y: number, mo: number, d: number, h: number, mi: number): Date {
  return new Date(Date.UTC(y, mo - 1, d, h, mi, 0) - 9 * 60 * 60 * 1000);
}

const QUIET: [string, string] = ['23:00', '07:00'];

describe('decideDelivery — quiet hours (REQ-015/016, AC-07/08)', () => {
  it('AC-08: 22:59 즉시 발송 / 23:00 보류 / 23:30 d1 예외 즉시 발송', () => {
    expect(decideDelivery('price_drop', kstInstant(2026, 7, 3, 22, 59), QUIET)).toEqual({
      action: 'send',
    });
    expect(decideDelivery('price_drop', kstInstant(2026, 7, 3, 23, 0), QUIET).action).toBe('hold');
    // d1 은 quiet hours 예외.
    expect(decideDelivery('d1', kstInstant(2026, 7, 3, 23, 30), QUIET)).toEqual({ action: 'send' });
  });

  it('07:00 경계는 즉시 발송, 06:59 는 보류', () => {
    expect(decideDelivery('price_drop', kstInstant(2026, 7, 3, 7, 0), QUIET).action).toBe('send');
    expect(decideDelivery('price_drop', kstInstant(2026, 7, 3, 6, 59), QUIET).action).toBe('hold');
  });

  it('AC-07: 23:30 보류 시 deliver_after 는 익일 07:00 KST', () => {
    const decision = decideDelivery('price_drop', kstInstant(2026, 7, 3, 23, 30), QUIET);
    expect(decision.action).toBe('hold');
    if (decision.action === 'hold') {
      expect(decision.deliverAfter).toBe('2026-07-03T22:00:00.000Z');
    }
  });
});
