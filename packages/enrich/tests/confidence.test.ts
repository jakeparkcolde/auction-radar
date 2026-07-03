import { describe, expect, it } from 'vitest';
import { gradeConfidence } from '../src/grade/confidence.js';

/**
 * 신뢰도 등급 경계값·용도 고정. (REQ-008/009, AC-05/07)
 */
describe('gradeConfidence — 동일 단지 표본 경계 (AC-05)', () => {
  it('동일 단지 5건 → 높음(강조 허용)', () => {
    expect(gradeConfidence({ sampleCount: 5, fallbackUsed: false, usage: '아파트' })).toEqual({
      confidence: '높음',
      emphasize: true,
    });
  });

  it('동일 단지 4건 → 보통(강조 허용)', () => {
    expect(gradeConfidence({ sampleCount: 4, fallbackUsed: false, usage: '아파트' })).toEqual({
      confidence: '보통',
      emphasize: true,
    });
  });

  it('동일 단지 3건 → 보통', () => {
    expect(gradeConfidence({ sampleCount: 3, fallbackUsed: false, usage: '아파트' }).confidence).toBe(
      '보통',
    );
  });

  it('동일 단지 2건 → 낮음(강조 억제)', () => {
    expect(gradeConfidence({ sampleCount: 2, fallbackUsed: false, usage: '아파트' })).toEqual({
      confidence: '낮음',
      emphasize: false,
    });
  });
});

describe('gradeConfidence — 폴백 표본 경계 (AC-05)', () => {
  it('폴백 10건 → 보통', () => {
    expect(gradeConfidence({ sampleCount: 10, fallbackUsed: true, usage: '아파트' })).toEqual({
      confidence: '보통',
      emphasize: true,
    });
  });

  it('폴백 9건 → 낮음(강조 억제)', () => {
    expect(gradeConfidence({ sampleCount: 9, fallbackUsed: true, usage: '아파트' })).toEqual({
      confidence: '낮음',
      emphasize: false,
    });
  });
});

describe('gradeConfidence — 빌라·토지 참고치 고정 (AC-07)', () => {
  it('다세대주택(→빌라)은 표본 수 무관 참고치 고정, 강조 억제', () => {
    // 표본이 충분(20건)해도 참고치로 고정.
    expect(gradeConfidence({ sampleCount: 20, fallbackUsed: false, usage: '다세대주택' })).toEqual({
      confidence: '참고치',
      emphasize: false,
    });
  });

  it('토지 계열도 참고치 고정', () => {
    expect(gradeConfidence({ sampleCount: 8, fallbackUsed: false, usage: '대지' })).toEqual({
      confidence: '참고치',
      emphasize: false,
    });
  });

  it('아파트/오피스텔/상가 계열은 표본 규칙을 정상 적용한다', () => {
    expect(gradeConfidence({ sampleCount: 6, fallbackUsed: false, usage: '오피스텔' }).confidence).toBe(
      '높음',
    );
    expect(gradeConfidence({ sampleCount: 6, fallbackUsed: false, usage: null }).confidence).toBe('높음');
  });
});
