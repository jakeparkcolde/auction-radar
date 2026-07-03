import type { Store } from '@auction-radar/store';

/**
 * 매칭 엔진. (SPEC-ALERT-001 REQ-001~004, 기획서 §6.4)
 *
 * - evaluate: 순수 함수 (event, item, config) → boolean.
 * - matchEvents: 스토어 기반 — 이벤트×enabled 워치리스트 평가 후 matches 기록.
 *
 * 지역 매칭 3계층: ① 법원 코드 게이트 → ② region_norm prefix 매칭 → ③ lawd_cd(실거래 결합 전용, 예약).
 * 정규화되지 않은 원문 주소 문자열에 대한 직접 매칭은 절대 수행하지 않는다(REQ-002).
 */

/** 워치리스트 config JSON 스키마(§6.4). */
export interface WatchlistConfig {
  readonly name?: string;
  /** 법원사무소 코드(1차 게이트). */
  readonly courts?: readonly string[];
  /** 정규화 지역 prefix 목록. */
  readonly regions?: readonly string[];
  /** 원문/표준 용도 목록. */
  readonly usages?: readonly string[];
  /** 감정가 상한(원). */
  readonly appraisedMax?: number | null;
  /** 감정가 하한(원). */
  readonly appraisedMin?: number | null;
  /** 최저가/감정가 비율 상한. */
  readonly minPriceRatioMax?: number | null;
  /** 유찰 최소 횟수. */
  readonly failedCountMin?: number | null;
  /** 신건은 ratio·유찰 조건 무시. */
  readonly includeNew?: boolean;
  /** remarks/주소 포함 검색(선택). */
  readonly keywords?: readonly string[];
  /** 리스크 키워드 제외(선택). */
  readonly excludeKeywords?: readonly string[];
  /** 알림 대상 이벤트 종류. */
  readonly notify?: readonly string[];
}

/** 매칭 평가 대상 이벤트 최소 형상. */
export interface MatchEvent {
  readonly type: string;
}

/** 매칭 평가 대상 물건 최소 형상. */
export interface MatchItem {
  readonly courtCode: string;
  readonly regionNorm: string | null;
  readonly usage: string | null;
  readonly usageCategory: string | null;
  readonly appraisedPrice: number | null;
  readonly minSalePrice: number | null;
  readonly failedCount: number;
  readonly remarks: string | null;
  readonly addressRaw: string | null;
}

/** 문자열 배열 중 하나라도 haystack 에 포함되는지. */
function includesAny(haystack: string, needles: readonly string[]): boolean {
  return needles.some((n) => n.length > 0 && haystack.includes(n));
}

/**
 * 단일 (event, item, config) 매칭 평가(순수).
 *
 * @returns 매칭되면 true.
 */
export function evaluate(event: MatchEvent, item: MatchItem, config: WatchlistConfig): boolean {
  // notify 필터: 지정 시 대상 종류만.
  if (config.notify && config.notify.length > 0 && !config.notify.includes(event.type)) {
    return false;
  }

  // ① 법원 코드 게이트.
  if (config.courts && config.courts.length > 0 && !config.courts.includes(item.courtCode)) {
    return false;
  }

  // ② region_norm prefix 매칭(원문 주소 직접 매칭 금지).
  if (config.regions && config.regions.length > 0) {
    const norm = item.regionNorm;
    if (norm === null) return false;
    const hit = config.regions.some((r) => norm.startsWith(r));
    if (!hit) return false;
  }

  // 용도 매칭(원문 usage 또는 표준 카테고리).
  if (config.usages && config.usages.length > 0) {
    const usageHit =
      (item.usage !== null && config.usages.includes(item.usage)) ||
      (item.usageCategory !== null && config.usages.includes(item.usageCategory));
    if (!usageHit) return false;
  }

  // excludeKeywords: remarks/주소에 포함되면 제외.
  const haystack = `${item.remarks ?? ''} ${item.addressRaw ?? ''}`;
  if (config.excludeKeywords && config.excludeKeywords.length > 0) {
    if (includesAny(haystack, config.excludeKeywords)) return false;
  }

  // keywords: 지정 시 하나라도 포함되어야 함.
  if (config.keywords && config.keywords.length > 0) {
    if (!includesAny(haystack, config.keywords)) return false;
  }

  // 감정가 상/하한(항상 적용).
  if (typeof config.appraisedMax === 'number' && config.appraisedMax !== null) {
    if (item.appraisedPrice === null || item.appraisedPrice > config.appraisedMax) return false;
  }
  if (typeof config.appraisedMin === 'number' && config.appraisedMin !== null) {
    if (item.appraisedPrice === null || item.appraisedPrice < config.appraisedMin) return false;
  }

  // includeNew 우회: new 이벤트 + includeNew 이면 ratio·유찰 조건 생략.
  const bypass = event.type === 'new' && config.includeNew === true;
  if (!bypass) {
    if (typeof config.minPriceRatioMax === 'number' && config.minPriceRatioMax !== null) {
      if (item.appraisedPrice === null || item.appraisedPrice === 0 || item.minSalePrice === null) {
        return false;
      }
      const ratio = item.minSalePrice / item.appraisedPrice;
      if (ratio > config.minPriceRatioMax) return false;
    }
    if (typeof config.failedCountMin === 'number' && config.failedCountMin !== null) {
      if (item.failedCount < config.failedCountMin) return false;
    }
  }

  return true;
}

/** matchEvents 결과. */
export interface MatchResult {
  /** 새로 기록된 (event_id, watchlist_id) 매칭 수. */
  readonly inserted: number;
}

/** DB row → MatchItem 매핑. */
interface EventItemRow {
  readonly event_id: number;
  readonly type: string;
  readonly court_code: string;
  readonly region_norm: string | null;
  readonly usage: string | null;
  readonly usage_category: string | null;
  readonly appraised_price: number | null;
  readonly min_sale_price: number | null;
  readonly failed_count: number;
  readonly remarks: string | null;
  readonly address_raw: string | null;
}

const EVENT_ITEM_SQL = `
  SELECT e.id AS event_id, e.type,
         c.court_code, i.region_norm, i.usage, i.usage_category,
         i.appraised_price, i.min_sale_price, i.failed_count, i.remarks, i.address_raw
  FROM events e
  JOIN items i ON i.id = e.item_id
  JOIN cases c ON c.id = i.case_id
  ORDER BY e.id
`;

/**
 * 모든 이벤트를 enabled 워치리스트와 평가해 matches 에 기록한다(멱등: INSERT OR IGNORE).
 */
export function matchEvents(store: Store): MatchResult {
  const watchlists = store.query<{ id: number; config: string }>(
    'SELECT id, config FROM watchlists WHERE enabled = 1',
  );
  if (watchlists.length === 0) return { inserted: 0 };

  const parsed = watchlists.map((w) => ({ id: w.id, config: JSON.parse(w.config) as WatchlistConfig }));
  const rows = store.query<EventItemRow>(EVENT_ITEM_SQL);

  let inserted = 0;
  for (const row of rows) {
    const item: MatchItem = {
      courtCode: row.court_code,
      regionNorm: row.region_norm,
      usage: row.usage,
      usageCategory: row.usage_category,
      appraisedPrice: row.appraised_price,
      minSalePrice: row.min_sale_price,
      failedCount: row.failed_count,
      remarks: row.remarks,
      addressRaw: row.address_raw,
    };
    for (const wl of parsed) {
      if (evaluate({ type: row.type }, item, wl.config)) {
        const res = store.upsert(
          'INSERT OR IGNORE INTO matches (event_id, watchlist_id) VALUES (?, ?)',
          [row.event_id, wl.id],
        );
        inserted += res.changes;
      }
    }
  }
  return { inserted };
}
