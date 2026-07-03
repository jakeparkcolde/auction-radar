import { describe, expect, it } from 'vitest';
import { manwonToWon, parseMolitResponse } from '../src/molit/parser.js';
import { loadFixture } from './helpers.js';

/**
 * MOLIT XML 파서 — 만원→원 환산, 블랭크 드롭, deal_date, 단일/복수 정규화. (REQ-010, D1/D2)
 */
describe('manwonToWon (REQ-010)', () => {
  it('만원 콤마 문자열을 원 단위 정수로 환산한다', () => {
    expect(manwonToWon('115,000')).toBe(1_150_000_000);
    expect(manwonToWon('37,600')).toBe(376_000_000);
    expect(manwonToWon('9,850')).toBe(98_500_000);
  });

  it('공백/빈 dealAmount 는 null', () => {
    expect(manwonToWon('')).toBeNull();
    expect(manwonToWon('   ')).toBeNull();
    expect(manwonToWon('0')).toBeNull();
  });
});

describe('parseMolitResponse (REQ-010)', () => {
  it('복수 item 을 파싱하고 만원→원 환산, 블랭크 금액 레코드는 드롭한다', () => {
    const { records, totalCount } = parseMolitResponse(
      loadFixture('apt-trade-basic.xml'),
      '28260',
      '202606',
    );
    // 3개 중 dealAmount 블랭크 1건 드롭 → 2건.
    expect(records).toHaveLength(2);
    expect(totalCount).toBe(2);

    const first = records[0]!;
    expect(first.price).toBe(1_150_000_000); // 115,000 만원 → 원
    expect(first.aptNameNorm).toBe('청라한양수자인');
    expect(first.area).toBe(84.99);
    expect(first.floor).toBe(15);
    expect(first.dealDate).toBe('2026-06-05'); // zero-pad
    expect(first.lawdCd).toBe('28260');
    expect(first.dealYm).toBe('202606');
  });

  it('단일 item(배열 아님)도 배열로 정규화한다', () => {
    const { records } = parseMolitResponse(loadFixture('apt-trade-single.xml'), '28260', '202606');
    expect(records).toHaveLength(1);
    expect(records[0]!.price).toBe(376_000_000);
    expect(records[0]!.dealDate).toBe('2026-06-12');
  });

  it('빈 items 는 빈 배열 + totalCount 0', () => {
    const { records, totalCount } = parseMolitResponse(
      loadFixture('apt-trade-empty.xml'),
      '28260',
      '202606',
    );
    expect(records).toHaveLength(0);
    expect(totalCount).toBe(0);
  });
});
