import { describe, expect, it } from 'vitest';
import { addDaysKST, isWithinQuietHours, kstParts, nextWindowEndISO, todayKST } from '../src/index.js';

/** KST 벽시계 → UTC instant (KST=UTC+9, DST 없음). */
function kstInstant(y: number, mo: number, d: number, h: number, mi: number): Date {
  return new Date(Date.UTC(y, mo - 1, d, h, mi, 0) - 9 * 60 * 60 * 1000);
}

const QUIET: [string, string] = ['23:00', '07:00'];

describe('kstParts / todayKST (REQ-008, AC-09 타임존 비의존)', () => {
  it('UTC instant 를 KST 벽시계로 정확히 변환한다 (UTC+9)', () => {
    // 2026-07-02T22:00:00Z == 2026-07-03T07:00 KST
    const inst = new Date('2026-07-02T22:00:00Z');
    const p = kstParts(inst);
    expect(p.year).toBe(2026);
    expect(p.month).toBe(7);
    expect(p.day).toBe(3);
    expect(p.hour).toBe(7);
    expect(p.minute).toBe(0);
    expect(todayKST(inst)).toBe('2026-07-03');
  });

  it('자정 직전/직후 날짜 경계가 KST 기준으로 넘어간다', () => {
    // 2026-07-03T14:59:59Z == 2026-07-03T23:59:59 KST
    expect(todayKST(new Date('2026-07-03T14:59:59Z'))).toBe('2026-07-03');
    // 2026-07-03T15:00:00Z == 2026-07-04T00:00 KST
    expect(todayKST(new Date('2026-07-03T15:00:00Z'))).toBe('2026-07-04');
  });
});

describe('addDaysKST (D-day 계산)', () => {
  it('달력 산술로 일수를 더한다(월 경계 포함)', () => {
    expect(addDaysKST('2026-07-03', 7)).toBe('2026-07-10');
    expect(addDaysKST('2026-07-03', 1)).toBe('2026-07-04');
    expect(addDaysKST('2026-07-28', 7)).toBe('2026-08-04');
  });
});

describe('isWithinQuietHours 경계 (AC-08)', () => {
  it('22:59 미포함 / 23:00 포함 / 06:59 포함 / 07:00 미포함 (KST)', () => {
    expect(isWithinQuietHours(kstInstant(2026, 7, 3, 22, 59), QUIET)).toBe(false);
    expect(isWithinQuietHours(kstInstant(2026, 7, 3, 23, 0), QUIET)).toBe(true);
    expect(isWithinQuietHours(kstInstant(2026, 7, 3, 6, 59), QUIET)).toBe(true);
    expect(isWithinQuietHours(kstInstant(2026, 7, 3, 7, 0), QUIET)).toBe(false);
  });

  it('자정을 넘는 창(23:00~07:00)을 올바르게 판정한다', () => {
    expect(isWithinQuietHours(kstInstant(2026, 7, 3, 23, 30), QUIET)).toBe(true);
    expect(isWithinQuietHours(kstInstant(2026, 7, 3, 3, 0), QUIET)).toBe(true);
    expect(isWithinQuietHours(kstInstant(2026, 7, 3, 12, 0), QUIET)).toBe(false);
  });
});

describe('nextWindowEndISO (deliver_after)', () => {
  it('23:30 KST 보류 → 익일 07:00 KST(= UTC 22:00) 를 반환', () => {
    const held = kstInstant(2026, 7, 3, 23, 30);
    expect(nextWindowEndISO(held, QUIET)).toBe('2026-07-03T22:00:00.000Z');
  });

  it('06:59 KST 보류 → 당일 07:00 KST(= 전일 UTC 22:00) 를 반환', () => {
    const held = kstInstant(2026, 7, 3, 6, 59);
    expect(nextWindowEndISO(held, QUIET)).toBe('2026-07-02T22:00:00.000Z');
  });
});
