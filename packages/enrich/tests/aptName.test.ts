import { describe, expect, it } from 'vitest';
import { aptNameNorm } from '../src/normalize/aptName.js';

/**
 * 단지명 정규화 벡터. (REQ-004)
 *
 * core normalize.test.ts 의 벡터 스타일을 미러링한다.
 */
describe('aptNameNorm (REQ-004)', () => {
  const vectors: Array<[string, string]> = [
    ['청라한양수자인', '청라한양수자인'],
    ['청라한양수자인 ', '청라한양수자인'], // 후행 공백
    [' 청라 한양 수자인 ', '청라한양수자인'], // 내부/전후 공백
    ['청라자이아파트', '청라자이'], // "아파트" 접미 제거
    ['청라한양수자인(1단지)', '청라한양수자인'], // 괄호 제거
    ['청라한양수자인（２단지）', '청라한양수자인'], // 전각 괄호+숫자
    ['청라 3 단지', '청라3단지'], // 숫자 단지 공백 통일
    ['청라제3단지', '청라3단지'], // "제3단지" → "3단지"
    ['청라제 3 단지', '청라3단지'],
    ['e편한세상아파트', 'e편한세상'], // 접미 제거, 영문 보존
  ];

  it.each(vectors)('정규화(%s) === %s', (input, expected) => {
    expect(aptNameNorm(input)).toBe(expected);
  });

  it('빈/누락 입력은 빈 문자열을 반환한다', () => {
    expect(aptNameNorm('')).toBe('');
    expect(aptNameNorm(null)).toBe('');
    expect(aptNameNorm(undefined)).toBe('');
  });

  it('접미 "아파트" 는 끝에 있을 때만 제거한다', () => {
    // "아파트형공장" 같이 중간에 있으면 보존.
    expect(aptNameNorm('아파트형공장')).toBe('아파트형공장');
  });
});
