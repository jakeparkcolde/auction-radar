import { describe, expect, it } from 'vitest';
import { normalizeCaseNumber, regionNorm } from '../src/normalize/index.js';

describe('normalizeCaseNumber (REQ-012)', () => {
  const vectors: Array<[string, string]> = [
    ['2025타경12345', '2025타경12345'],
    ['2025 타경 12345', '2025타경12345'],
    [' 2025타경12345 ', '2025타경12345'],
    ['２０２５타경１２３４５', '2025타경12345'], // 전각 숫자
    ['2025타경\t12345', '2025타경12345'], // 탭
    ['2025타경　12345', '2025타경12345'], // 전각 공백
    ['2024타경987', '2024타경987'],
  ];

  it.each(vectors)('정규화(%s) === %s', (input, expected) => {
    expect(normalizeCaseNumber(input)).toBe(expected);
  });

  it('빈 입력은 빈 문자열을 반환한다', () => {
    expect(normalizeCaseNumber('')).toBe('');
  });
});

describe('regionNorm (REQ-012, §6.4)', () => {
  const vectors: Array<[string, string | null]> = [
    ['인천광역시 서구 청라동 123', '인천 서구'],
    ['서울특별시 강남구 역삼동', '서울 강남구'],
    ['경기도 수원시 팔달구 인계동', '경기 수원시'], // 첫 시군구 = 수원시
    ['부산광역시 해운대구', '부산 해운대구'],
    ['세종특별자치시 한솔동', '세종'], // 단일 계층
    ['강원특별자치도 춘천시 석사동', '강원 춘천시'],
    ['전북특별자치도 전주시 완산구', '전북 전주시'],
    ['인천 서구 가정동', '인천 서구'], // 이미 축약형
    ['제주특별자치도 제주시 노형동', '제주 제주시'],
  ];

  it.each(vectors)('정규화(%s) === %s', (input, expected) => {
    expect(regionNorm(input)).toBe(expected);
  });

  it('해석 불가/빈 주소는 null 을 반환한다', () => {
    expect(regionNorm(null)).toBeNull();
    expect(regionNorm('')).toBeNull();
    expect(regionNorm('알수없는지역 어딘가')).toBeNull();
  });

  it('시군구가 없으면 시도만 반환한다', () => {
    expect(regionNorm('인천광역시')).toBe('인천');
  });
});
