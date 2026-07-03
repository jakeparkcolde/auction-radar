import { describe, expect, it } from 'vitest';
import { DISCLAIMER, formatKRW, renderMessage } from '../src/index.js';
import type { RenderInput } from '../src/index.js';

describe('formatKRW (기획서 §6.5 가격 표기)', () => {
  it('1억 이상은 억 단위, 소수 둘째 자리 반올림', () => {
    expect(formatKRW(320000000)).toBe('3.2억');
    expect(formatKRW(256000000)).toBe('2.56억');
    expect(formatKRW(500000000)).toBe('5억');
  });

  it('1억 미만은 만 단위 + 천단위 콤마', () => {
    expect(formatKRW(84500000)).toBe('8,450만');
    expect(formatKRW(9000000)).toBe('900만');
  });
});

const priceDrop: RenderInput = {
  eventType: 'price_drop',
  courtName: '인천지방법원',
  caseNumber: '2025타경12345',
  region: '인천 서구',
  usage: '아파트',
  beforePrice: 320000000,
  afterPrice: 256000000,
  failedCount: 1,
  saleDate: '2026-07-28',
};

describe('renderMessage (REQ-010/011/017)', () => {
  it('AC-01: price_drop 은 "3.2억 → 2.56억 (−20%)" 형식과 면책 고지를 포함한다', () => {
    const msg = renderMessage(priceDrop);
    expect(msg).toContain('3.2억 → <b>2.56억</b> (−20%)');
    expect(msg).toContain('유찰 1회');
    expect(msg).toContain(DISCLAIMER);
    expect(msg).toContain('[유찰]');
  });

  it('AC-12: enrich 부재 시 할인율 라인 없이 나머지 포맷 그대로 렌더링', () => {
    const msg = renderMessage(priceDrop);
    expect(msg).not.toContain('📊');
    expect(msg).toContain('3.2억 → <b>2.56억</b> (−20%)');
    expect(msg).toContain(DISCLAIMER);
  });

  it('enrich 존재 시 할인율 라인 포함', () => {
    const msg = renderMessage({
      ...priceDrop,
      enrich: { discountPct: -32, sampleSize: 14, confidence: '높음' },
    });
    expect(msg).toContain('📊 인근 실거래 중위값 대비 <b>−32%</b> (표본 14건 · 신뢰도 높음)');
  });

  it('AC-10: 스크랩 유래 문자열은 이스케이프되어 삽입된다', () => {
    const msg = renderMessage({
      ...priceDrop,
      addressDetail: '<b>주의</b> & "특약"',
    });
    expect(msg).toContain('&lt;b&gt;주의&lt;/b&gt; &amp; "특약"');
    expect(msg).not.toContain('<b>주의</b>');
  });

  it('new 이벤트는 전/후 없이 현재 최저가만 표기', () => {
    const msg = renderMessage({
      eventType: 'new',
      courtName: '인천지방법원',
      caseNumber: '2025타경1',
      region: '인천 서구',
      afterPrice: 320000000,
      failedCount: 0,
    });
    expect(msg).toContain('[신건]');
    expect(msg).toContain('최저가 <b>3.2억</b>');
    expect(msg).not.toContain('→');
  });

  it('D-7 이벤트 라벨과 매각기일 D-day 표기', () => {
    const msg = renderMessage({
      eventType: 'd7',
      courtName: '인천지방법원',
      caseNumber: '2025타경1',
      saleDate: '2026-07-10',
      dday: 7,
    });
    expect(msg).toContain('[D-7]');
    expect(msg).toContain('매각기일 2026-07-10 (D-7)');
  });

  it('원문 링크가 있으면 앵커로 렌더링', () => {
    const msg = renderMessage({ ...priceDrop, sourceUrl: 'https://example.test/x' });
    expect(msg).toContain('<a href="https://example.test/x">법원 원문 보기</a>');
  });
});
