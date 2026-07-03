import { describe, expect, it } from 'vitest';
import { courtAuctionUrl, DEFAULT_BASE_URL } from '../src/index.js';

/**
 * 법원 원문 링크 생성 특성 테스트. (SPEC-UI-001 결정 D4)
 */
describe('courtAuctionUrl (결정 D4)', () => {
  it('DEFAULT_BASE_URL 을 재사용한 포털 URL 을 만든다', () => {
    const url = courtAuctionUrl('B000210', '2025타경12345');
    expect(url.startsWith(`${DEFAULT_BASE_URL}/`)).toBe(true);
    expect(url.startsWith('https://www.courtauction.go.kr/')).toBe(true);
  });

  it('법원코드와 사건번호를 쿼리 파라미터로 부착한다(URL 인코딩)', () => {
    const url = courtAuctionUrl('B000210', '2025타경12345');
    const parsed = new URL(url);
    expect(parsed.searchParams.get('cortOfcCd')).toBe('B000210');
    expect(parsed.searchParams.get('caseNo')).toBe('2025타경12345');
  });

  it('결정적(deterministic) — 동일 입력은 동일 출력', () => {
    expect(courtAuctionUrl('A', 'B')).toBe(courtAuctionUrl('A', 'B'));
  });
});
