import { describe, expect, it } from 'vitest';
import { daysUntilKST, enrichEmphasized } from '../src/index.js';

/**
 * D-day 공유 유틸 특성 테스트. (SPEC-UI-001 결정 D2/D5)
 *
 * 대시보드와 알림이 동일 규칙을 재사용함을 보장한다.
 */
describe('daysUntilKST (결정 D2)', () => {
  // 기준: 2026-07-03 12:00 KST (03:00Z).
  const nowKst = new Date('2026-07-03T03:00:00Z');

  it('미래 날짜는 양수 일수(D-day)를 반환한다', () => {
    expect(daysUntilKST('2026-07-10', nowKst)).toBe(7);
    expect(daysUntilKST('2026-07-04', nowKst)).toBe(1);
  });

  it('당일은 0', () => {
    expect(daysUntilKST('2026-07-03', nowKst)).toBe(0);
  });

  it('과거 날짜는 음수', () => {
    expect(daysUntilKST('2026-07-01', nowKst)).toBe(-2);
  });

  it('KST 경계: UTC 로 전날이어도 KST 오늘 기준으로 계산한다', () => {
    // 2026-07-03 00:30 KST == 2026-07-02 15:30Z → KST 오늘은 07-03.
    const boundary = new Date('2026-07-02T15:30:00Z');
    expect(daysUntilKST('2026-07-10', boundary)).toBe(7);
  });
});

describe('enrichEmphasized 강조 규칙 (결정 D5)', () => {
  it('emphasize 미지정(하위 호환)이면 강조 허용(true)', () => {
    expect(enrichEmphasized({})).toBe(true);
  });

  it('emphasize=true 면 강조 허용', () => {
    expect(enrichEmphasized({ emphasize: true })).toBe(true);
  });

  it('emphasize=false(낮음/참고치)면 강조 억제(false)', () => {
    expect(enrichEmphasized({ emphasize: false })).toBe(false);
  });
});
