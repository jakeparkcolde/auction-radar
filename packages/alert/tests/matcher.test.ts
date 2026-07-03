import { describe, expect, it } from 'vitest';
import { evaluate, matchEvents } from '../src/index.js';
import type { MatchItem, WatchlistConfig } from '../src/index.js';
import { addWatchlist, baseRecord, freshStore, ingest } from './helpers.js';

const baseItem: MatchItem = {
  courtCode: 'B000280',
  regionNorm: '인천 서구',
  usage: '아파트',
  usageCategory: '아파트',
  appraisedPrice: 400000000,
  minSalePrice: 256000000,
  failedCount: 1,
  remarks: null,
  addressRaw: '인천광역시 서구 청라동',
};

const baseConfig: WatchlistConfig = {
  courts: ['B000280'],
  regions: ['인천 서구'],
  usages: ['아파트'],
  appraisedMax: 500000000,
  minPriceRatioMax: 0.8,
  failedCountMin: 1,
};

describe('evaluate — 순수 매칭 (REQ-001~004)', () => {
  it('모든 조건 충족 시 매칭', () => {
    expect(evaluate({ type: 'price_drop' }, baseItem, baseConfig)).toBe(true);
  });

  it('법원 코드 게이트 불일치 시 제외', () => {
    expect(evaluate({ type: 'price_drop' }, { ...baseItem, courtCode: 'B000210' }, baseConfig)).toBe(
      false,
    );
  });

  it('REQ-002: region_norm prefix 매칭(원문 주소 직접 매칭 금지)', () => {
    // region_norm 이 null 이면 원문 주소가 있어도 매칭하지 않는다.
    expect(evaluate({ type: 'price_drop' }, { ...baseItem, regionNorm: null }, baseConfig)).toBe(false);
    // prefix 매칭: "인천 서구 청라동" 은 "인천 서구" prefix 로 매칭.
    expect(
      evaluate({ type: 'price_drop' }, { ...baseItem, regionNorm: '인천 서구 청라동' }, baseConfig),
    ).toBe(true);
    // 다른 구는 제외.
    expect(evaluate({ type: 'price_drop' }, { ...baseItem, regionNorm: '인천 남동구' }, baseConfig)).toBe(
      false,
    );
  });

  it('용도 불일치 시 제외', () => {
    expect(
      evaluate({ type: 'price_drop' }, { ...baseItem, usage: '토지', usageCategory: '토지' }, baseConfig),
    ).toBe(false);
  });

  it('REQ-004: excludeKeywords 가 remarks/주소에 있으면 제외', () => {
    const cfg = { ...baseConfig, excludeKeywords: ['지분', '유치권'] };
    expect(evaluate({ type: 'price_drop' }, { ...baseItem, remarks: '지분 매각' }, cfg)).toBe(false);
    expect(evaluate({ type: 'price_drop' }, { ...baseItem, remarks: '특이사항 없음' }, cfg)).toBe(true);
  });

  it('keywords 지정 시 하나라도 포함되어야 매칭', () => {
    const cfg = { ...baseConfig, keywords: ['대지권'] };
    expect(evaluate({ type: 'price_drop' }, { ...baseItem, remarks: '대지권 미등기' }, cfg)).toBe(true);
    expect(evaluate({ type: 'price_drop' }, { ...baseItem, remarks: '없음' }, cfg)).toBe(false);
  });

  it('감정가 상한 초과 시 제외', () => {
    expect(
      evaluate({ type: 'price_drop' }, { ...baseItem, appraisedPrice: 600000000 }, baseConfig),
    ).toBe(false);
  });

  it('minPriceRatioMax 초과(고가) 시 제외', () => {
    // ratio = 380M/400M = 0.95 > 0.8
    expect(
      evaluate({ type: 'price_drop' }, { ...baseItem, minSalePrice: 380000000 }, baseConfig),
    ).toBe(false);
  });

  it('failedCountMin 미달 시 제외', () => {
    expect(evaluate({ type: 'price_drop' }, { ...baseItem, failedCount: 0 }, baseConfig)).toBe(false);
  });

  it('AC-03: includeNew + new 이벤트는 ratio·유찰 조건을 우회한다', () => {
    const cfg: WatchlistConfig = { ...baseConfig, includeNew: true };
    // 유찰 0회, ratio 100%(신건) — 원래라면 제외지만 includeNew 로 매칭.
    const newItem: MatchItem = {
      ...baseItem,
      failedCount: 0,
      minSalePrice: 400000000, // ratio 1.0
    };
    expect(evaluate({ type: 'new' }, newItem, cfg)).toBe(true);
    // includeNew 라도 new 가 아닌 이벤트는 우회하지 않는다.
    expect(evaluate({ type: 'price_drop' }, newItem, cfg)).toBe(false);
  });

  it('notify 목록에 없는 종류는 제외', () => {
    const cfg: WatchlistConfig = { ...baseConfig, notify: ['new'] };
    expect(evaluate({ type: 'price_drop' }, baseItem, cfg)).toBe(false);
    expect(evaluate({ type: 'new' }, { ...baseItem, failedCount: 1 }, cfg)).toBe(true);
  });
});

describe('matchEvents — 스토어 기반 (REQ-001)', () => {
  it('enabled 워치리스트에 매칭되는 이벤트를 matches 에 기록한다(멱등)', () => {
    const store = freshStore();
    const itemId = ingest(store, baseRecord(1));
    // 유찰 전이 → item 갱신 + price_drop
    ingest(store, { ...baseRecord(1), failedCount: 1, minSalePrice: 256000000 });
    addWatchlist(store, { name: '인천서구', ...baseConfig, notify: ['price_drop'] });

    const res = matchEvents(store);
    expect(res.inserted).toBe(1);

    const matches = store.query<{ event_id: number }>('SELECT event_id FROM matches');
    expect(matches).toHaveLength(1);

    // 멱등: 재실행 시 신규 0.
    expect(matchEvents(store).inserted).toBe(0);

    // 매칭된 이벤트가 실제 price_drop 인지 확인
    const type = store.get<{ type: string }>('SELECT type FROM events WHERE id = ?', [
      matches[0]?.event_id,
    ]);
    expect(type?.type).toBe('price_drop');
    expect(itemId).toBeGreaterThan(0);
    store.close();
  });

  it('enabled 워치리스트가 없으면 매칭 0', () => {
    const store = freshStore();
    ingest(store, baseRecord(1));
    expect(matchEvents(store).inserted).toBe(0);
    store.close();
  });
});
