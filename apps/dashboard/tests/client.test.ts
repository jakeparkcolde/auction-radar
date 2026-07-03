// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { defaultFilters, renderView, toQuery } from '../src/client/main.js';
import type { ItemView, ViewModel } from '../src/render/viewModel.js';

/** 물건 뷰 픽스처. */
function itemView(over: Partial<ItemView> = {}): ItemView {
  return {
    id: 100,
    courtCode: 'B000210',
    caseNumber: '2025타경1000',
    caseName: '아파트 임의경매',
    usage: '아파트',
    usageCategory: '아파트',
    region: '인천 서구',
    addressDetail: '행복아파트',
    appraisedPriceText: '3.2억',
    minSalePriceText: '2.56억',
    failedCount: 1,
    saleDate: '2026-07-08',
    dday: 5,
    courtUrl: 'https://www.courtauction.go.kr/pgj/index.on?cortOfcCd=B000210&caseNo=2025%ED%83%801000',
    enrich: null,
    ...over,
  };
}

function baseVm(over: Partial<ViewModel> = {}): ViewModel {
  return {
    schemaPresent: true,
    empty: false,
    disclaimer: '공고 시점 기준 · 입찰 전 원문/등기부 재확인',
    generatedAt: '2026-07-03T03:00:00.000Z',
    status: { blocked: false, hasError: false, errorText: null, lastSuccessAt: null, latestFinishedAt: null, warn: false },
    watchlists: [{ id: 1, name: '인천 서구 아파트', matchCount: 3, enabled: true }],
    items: [],
    events: [],
    imminent: [],
    ...over,
  };
}

describe('renderView (REQ-004/005/006/008, AC-01/02/08/09)', () => {
  it('AC-01: 면책 고지가 모든 화면(헤더+푸터)에 표시되고 법원 링크가 존재한다', () => {
    const root = document.createElement('div');
    const item = itemView();
    renderView(root, baseVm({ items: [item] }), defaultFilters(), () => {});

    const disclaimers = root.querySelectorAll('.disclaimer');
    expect(disclaimers.length).toBeGreaterThanOrEqual(2); // 헤더 + 푸터
    expect(root.textContent).toContain('입찰 전 원문/등기부 재확인');

    const link = root.querySelector('a.court-link') as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.getAttribute('href')).toBe(item.courtUrl);
  });

  it('AC-02: 높음 enrich 는 굵게(.emph), 낮음 enrich 는 강조 없음', () => {
    const root = document.createElement('div');
    const a = itemView({
      id: 100,
      enrich: { discountPct: -32, discountText: '−32%', sampleSize: 14, confidence: '높음', emphasize: true },
    });
    const b = itemView({
      id: 101,
      enrich: { discountPct: -15, discountText: '−15%', sampleSize: 2, confidence: '참고치 (표본 부족)', emphasize: false },
    });
    renderView(root, baseVm({ items: [a, b] }), defaultFilters(), () => {});

    const discounts = root.querySelectorAll('.enrich .discount');
    expect(discounts.length).toBe(2);
    const [dA, dB] = Array.from(discounts) as HTMLElement[];
    expect(dA.classList.contains('emph')).toBe(true);
    expect(dA.textContent).toBe('−32%');
    expect(dB.classList.contains('emph')).toBe(false);
    expect(root.textContent).toContain('참고치 (표본 부족)');
  });

  it('AC-08: 차단 배너와 마지막 성공 시각을 표시한다', () => {
    const root = document.createElement('div');
    renderView(
      root,
      baseVm({
        status: {
          blocked: true,
          hasError: false,
          errorText: '차단',
          lastSuccessAt: '2026-07-01T03:00:00.000Z',
          latestFinishedAt: '2026-07-03T03:00:00.000Z',
          warn: true,
        },
      }),
      defaultFilters(),
      () => {},
    );
    const banner = root.querySelector('.banner-warn');
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain('마지막 성공 sync');
    expect(banner?.textContent).toContain('2026-07-01T03:00:00.000Z');
  });

  it('AC-09: 빈 상태 안내를 표시한다(면책 고지도 유지)', () => {
    const root = document.createElement('div');
    renderView(root, baseVm({ empty: true }), defaultFilters(), () => {});
    expect(root.querySelector('.empty-state')?.textContent).toContain(
      'auction-radar sync를 먼저 실행하세요',
    );
    expect(root.textContent).toContain('입찰 전 원문/등기부 재확인');
  });

  it('D-7 임박 섹션을 상단에 표시한다 (REQ-009)', () => {
    const root = document.createElement('div');
    const imm = itemView({ id: 100, dday: 5 });
    renderView(root, baseVm({ items: [imm], imminent: [imm] }), defaultFilters(), () => {});
    expect(root.querySelector('.imminent')).not.toBeNull();
    expect(root.querySelector('.imminent h2')?.textContent).toContain('임박');
  });

  it('필터 변경 시 onFilter 콜백을 호출한다 (REQ-007)', () => {
    const root = document.createElement('div');
    const onFilter = vi.fn();
    renderView(root, baseVm(), defaultFilters(), onFilter);
    const select = root.querySelector('select') as HTMLSelectElement;
    select.value = '1';
    select.dispatchEvent(new Event('change'));
    expect(onFilter).toHaveBeenCalledTimes(1);
  });

  it('toQuery 는 빈 필터를 생략한다', () => {
    expect(toQuery({ watchlist: '', type: '', period: '' })).toBe('');
    expect(toQuery({ watchlist: '1', type: 'price_drop', period: '90' })).toBe(
      '?watchlist=1&type=price_drop&period=90',
    );
  });
});
