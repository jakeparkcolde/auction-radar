import { describe, expect, it } from 'vitest';
import { mapUsage } from '../src/usage-map.js';

describe('mapUsage (REQ-019, §6.4)', () => {
  const mapped: Array<[string, string]> = [
    ['아파트', '아파트'],
    ['연립주택', '빌라'],
    ['다세대주택', '빌라'],
    ['오피스텔', '오피스텔'],
    ['근린생활시설', '상가'],
    ['토지', '토지'],
    ['임야', '토지'],
  ];

  it.each(mapped)('원문 "%s" → 표준 카테고리 "%s"', (raw, category) => {
    const res = mapUsage(raw);
    expect(res.category).toBe(category);
    expect(res.unmapped).toBe(false);
    expect(res.warning).toBeUndefined();
  });

  it('미매핑 용도는 "기타"로 폴백하고 경고를 남긴다', () => {
    const res = mapUsage('우주정거장');
    expect(res.category).toBe('기타');
    expect(res.unmapped).toBe(true);
    expect(res.warning).toContain('우주정거장');
  });

  it('null/빈 용도도 "기타"로 처리한다', () => {
    expect(mapUsage(null).category).toBe('기타');
    expect(mapUsage('').unmapped).toBe(true);
  });
});
