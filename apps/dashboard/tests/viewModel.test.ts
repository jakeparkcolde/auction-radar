import { describe, expect, it } from 'vitest';
import { DISCLAIMER, formatKRW } from '@auction-radar/alert';
import { courtAuctionUrl } from '@auction-radar/core';
import type { EnrichInfoLike } from '@auction-radar/enrich';
import { buildItemView, buildViewModel } from '../src/render/viewModel.js';
import type { ItemWithEnrich } from '../src/render/viewModel.js';
import type { ItemRow } from '../src/query/items.js';
import { signedPercentText } from '../src/render/format.js';
import { NOW } from './helpers.js';

/** 물건 행 픽스처. */
function itemRow(over: Partial<ItemRow> = {}): ItemRow {
  return {
    id: 1,
    court_code: 'B000210',
    case_number: '2025타경1000',
    case_name: '아파트 임의경매',
    usage: '아파트',
    usage_category: '아파트',
    address_raw: '행복아파트',
    region_norm: '인천 서구',
    lawd_cd: '11710',
    appraised_price: 320_000_000,
    min_sale_price: 256_000_000,
    failed_count: 1,
    next_sale_date: '2026-07-08',
    status: '진행중',
    latest_sale_date: '2026-07-08',
    latest_result: '예정',
    ...over,
  };
}

const enrichHigh: EnrichInfoLike = {
  discountPct: -32,
  sampleSize: 14,
  confidence: '높음',
  emphasize: true,
};
const enrichLow: EnrichInfoLike = {
  discountPct: -15,
  sampleSize: 2,
  confidence: '참고치 (표본 부족)',
  emphasize: false,
};

describe('buildItemView (REQ-004/005/006)', () => {
  it('AC-01: 가격(억/만)·D-day·법원 링크를 채운다', () => {
    const v = buildItemView(itemRow(), null, NOW);
    expect(v.appraisedPriceText).toBe('3.2억');
    expect(v.minSalePriceText).toBe('2.56억');
    expect(v.failedCount).toBe(1);
    expect(v.dday).toBe(5); // 2026-07-03 → 07-08
    expect(v.courtUrl).toBe(courtAuctionUrl('B000210', '2025타경1000'));
    expect(v.enrich).toBeNull();
  });

  it('AC-02: 높음 enrich 는 강조(emphasize=true), "−32%"', () => {
    const v = buildItemView(itemRow(), enrichHigh, NOW);
    expect(v.enrich?.emphasize).toBe(true);
    expect(v.enrich?.discountText).toBe('−32%');
    expect(v.enrich?.confidence).toBe('높음');
  });

  it('AC-02: 낮음 enrich 는 강조 없음(emphasize=false), 참고치 라벨', () => {
    const v = buildItemView(itemRow(), enrichLow, NOW);
    expect(v.enrich?.emphasize).toBe(false);
    expect(v.enrich?.discountText).toBe('−15%');
    expect(v.enrich?.confidence).toBe('참고치 (표본 부족)');
  });

  it('가격 없으면 null(AC-07 소프트 표시)', () => {
    const v = buildItemView(itemRow({ appraised_price: null, min_sale_price: null }), null, NOW);
    expect(v.appraisedPriceText).toBeNull();
    expect(v.minSalePriceText).toBeNull();
  });

  it('억/만 환산이 alert 렌더러 formatKRW 와 byte-identical', () => {
    for (const won of [320_000_000, 256_000_000, 84_500_000, 500_000_000, 9_000_000]) {
      const v = buildItemView(itemRow({ min_sale_price: won }), null, NOW);
      expect(v.minSalePriceText).toBe(formatKRW(won));
    }
  });
});

describe('buildViewModel (REQ-006/008/009, AC-09)', () => {
  const items: ItemWithEnrich[] = [
    { row: itemRow({ id: 100, next_sale_date: '2026-07-08' }), enrich: enrichHigh }, // D-5 → 임박
    { row: itemRow({ id: 101, next_sale_date: '2026-09-01' }), enrich: enrichLow }, // 비임박
  ];

  it('면책 고지·생성시각 항상 포함', () => {
    const vm = buildViewModel({
      schemaPresent: true,
      now: NOW,
      items,
      events: [],
      watchlists: [],
      status: { latest: null, lastSuccessAt: null },
    });
    expect(vm.disclaimer).toBe(DISCLAIMER);
    expect(vm.generatedAt).toBe(NOW.toISOString());
  });

  it('D-7 임박 섹션은 0~7일 물건만 (REQ-009)', () => {
    const vm = buildViewModel({
      schemaPresent: true,
      now: NOW,
      items,
      events: [],
      watchlists: [],
      status: { latest: null, lastSuccessAt: null },
    });
    expect(vm.imminent.map((i) => i.id)).toEqual([100]);
  });

  it('sync 차단 → warn=true, 마지막 성공 시각 보존 (AC-08)', () => {
    const vm = buildViewModel({
      schemaPresent: true,
      now: NOW,
      items: [],
      events: [],
      watchlists: [],
      status: {
        latest: { id: 2, started_at: null, finished_at: null, blocked: 1, error: '차단' },
        lastSuccessAt: '2026-07-01T03:00:00.000Z',
      },
    });
    expect(vm.status.warn).toBe(true);
    expect(vm.status.blocked).toBe(true);
    expect(vm.status.lastSuccessAt).toBe('2026-07-01T03:00:00.000Z');
  });

  it('물건·이벤트 없으면 empty=true (AC-09)', () => {
    const vm = buildViewModel({
      schemaPresent: true,
      now: NOW,
      items: [],
      events: [],
      watchlists: [],
      status: { latest: null, lastSuccessAt: null },
    });
    expect(vm.empty).toBe(true);
  });
});

describe('signedPercentText (알림 렌더러 표기 일치)', () => {
  it('음수는 U+2212 마이너스', () => {
    expect(signedPercentText(-32)).toBe('−32%');
    expect(signedPercentText(20)).toBe('+20%');
    expect(signedPercentText(0)).toBe('0%');
  });
});
