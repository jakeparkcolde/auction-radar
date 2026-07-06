// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import {
  applyItemFilter,
  defaultFilters,
  defaultItemFilter,
  regionOptions,
  renderView,
  toQuery,
  usageOptions,
} from '../src/client/main.js';
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
    appraisedPrice: 320_000_000,
    minSalePrice: 256_000_000,
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
    // dday>7 로 두어 임박 섹션에 핀 고정(중복 렌더)되지 않게 한다.
    const a = itemView({
      id: 100,
      dday: 30,
      enrich: { discountPct: -32, discountText: '−32%', sampleSize: 14, confidence: '높음', emphasize: true },
    });
    const b = itemView({
      id: 101,
      dday: 30,
      enrich: { discountPct: -15, discountText: '−15%', sampleSize: 2, confidence: '참고치 (표본 부족)', emphasize: false },
    });
    renderView(root, baseVm({ items: [a, b] }), defaultFilters(), () => {});

    const discounts = root.querySelectorAll('.items .enrich .discount');
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

  it('클라이언트 필터 변경 시 재조회 없이 재렌더한다(onItemFilter 호출)', () => {
    const root = document.createElement('div');
    const onItemFilter = vi.fn();
    const items = [
      itemView({ id: 1, region: '인천 서구' }),
      itemView({ id: 2, region: '인천 부평구' }),
    ];
    renderView(root, baseVm({ items }), defaultFilters(), () => {}, defaultItemFilter(), onItemFilter);
    // 지역 select 는 클라이언트 필터 바(.filters-client)의 첫 select.
    const regionSelect = root.querySelector('.filters-client select') as HTMLSelectElement;
    expect(regionSelect).not.toBeNull();
    regionSelect.value = '인천 서구';
    regionSelect.dispatchEvent(new Event('change'));
    expect(onItemFilter).toHaveBeenCalledWith(expect.objectContaining({ region: '인천 서구' }));
  });

  it('필터링 결과가 "물건 (n / 전체 m)" 형태로 개수를 보여준다', () => {
    const root = document.createElement('div');
    const items = [
      itemView({ id: 1, region: '인천 서구' }),
      itemView({ id: 2, region: '인천 부평구' }),
    ];
    renderView(
      root,
      baseVm({ items }),
      defaultFilters(),
      () => {},
      { ...defaultItemFilter(), region: '인천 서구' },
      () => {},
    );
    expect(root.querySelector('.items h2')?.textContent).toBe('물건 (1 / 전체 2)');
  });
});

describe('applyItemFilter (지역/용도/가격/검색/정렬)', () => {
  const A = itemView({ id: 1, region: '인천 서구', usageCategory: '아파트', minSalePrice: 300_000_000, failedCount: 0, dday: 10 });
  const B = itemView({ id: 2, region: '인천 부평구', usageCategory: '빌라', minSalePrice: 100_000_000, failedCount: 2, dday: 3, addressDetail: '중봉대로 490' });
  const C = itemView({ id: 3, region: '인천 서구', usageCategory: '아파트', minSalePrice: 500_000_000, failedCount: 1, dday: null });
  const all = [A, B, C];

  it('지역 필터', () => {
    const r = applyItemFilter(all, { ...defaultItemFilter(), region: '인천 서구' });
    expect(r.map((x) => x.id).sort()).toEqual([1, 3]);
  });

  it('용도 필터', () => {
    const r = applyItemFilter(all, { ...defaultItemFilter(), usage: '빌라' });
    expect(r.map((x) => x.id)).toEqual([2]);
  });

  it('가격 상한 필터(최저가 기준)', () => {
    const r = applyItemFilter(all, { ...defaultItemFilter(), priceMax: 300_000_000 });
    expect(r.map((x) => x.id).sort()).toEqual([1, 2]);
  });

  it('주소·사건번호 검색(부분 일치)', () => {
    const r = applyItemFilter(all, { ...defaultItemFilter(), search: '중봉대로' });
    expect(r.map((x) => x.id)).toEqual([2]);
  });

  it('정렬: 기일 임박순(dday 오름차순, null 은 뒤로)', () => {
    const r = applyItemFilter(all, { ...defaultItemFilter(), sort: 'sale' });
    expect(r.map((x) => x.id)).toEqual([2, 1, 3]);
  });

  it('정렬: 최저가 낮은순', () => {
    const r = applyItemFilter(all, { ...defaultItemFilter(), sort: 'price_asc' });
    expect(r.map((x) => x.id)).toEqual([2, 1, 3]);
  });

  it('정렬: 유찰 많은순', () => {
    const r = applyItemFilter(all, { ...defaultItemFilter(), sort: 'failed' });
    expect(r.map((x) => x.id)).toEqual([2, 3, 1]);
  });

  it('regionOptions/usageOptions 는 고유값을 정렬해 반환한다', () => {
    expect(regionOptions(all)).toEqual(['인천 부평구', '인천 서구']);
    expect(usageOptions(all)).toEqual(['빌라', '아파트']);
  });

  it('사건번호 복사 버튼 클릭 시 클립보드에 사건번호를 복사한다 (원문 딥링크 부재 보완)', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    const root = document.createElement('div');
    const item = itemView({ caseNumber: '2025타경511289' });
    renderView(root, baseVm({ items: [item] }), defaultFilters(), () => {});

    const btn = root.querySelector('.copy-btn') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    btn.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(writeText).toHaveBeenCalledWith('2025타경511289');
    expect(btn.textContent).toBe('복사됨');
  });
});
