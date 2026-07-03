import type { Store } from '@auction-radar/store';

/**
 * 물건 목록 조회. (SPEC-UI-001 REQ-004)
 *
 * items + cases + 최신 매각기일(schedules) 조인. 워치리스트 필터 시 matches→events 로 좁힌다.
 * 읽기 전용 — store.query 만 사용(prepared statement, 바인딩 파라미터).
 */

/** 물건 조회 옵션. */
export interface ItemQuery {
  /** 워치리스트 id 필터(미지정 시 전체). */
  readonly watchlistId?: number;
  /** 최대 행 수(기본 500). */
  readonly limit?: number;
}

/** 물건 조회 결과 행(원시 컬럼). */
export interface ItemRow {
  readonly id: number;
  readonly court_code: string;
  readonly case_number: string;
  readonly case_name: string | null;
  readonly usage: string | null;
  readonly usage_category: string | null;
  readonly address_raw: string | null;
  readonly region_norm: string | null;
  readonly lawd_cd: string | null;
  readonly appraised_price: number | null;
  readonly min_sale_price: number | null;
  readonly failed_count: number;
  readonly next_sale_date: string | null;
  readonly status: string | null;
  /** 최신 매각기일(YYYY-MM-DD) — schedules MAX(sale_date). */
  readonly latest_sale_date: string | null;
  /** 최신 매각기일 결과(예정/유찰/매각...). */
  readonly latest_result: string | null;
}

const BASE_SELECT = `
  SELECT
    i.id, c.court_code, c.case_number, c.case_name,
    i.usage, i.usage_category, i.address_raw, i.region_norm, i.lawd_cd,
    i.appraised_price, i.min_sale_price, i.failed_count, i.next_sale_date, i.status,
    (SELECT s.sale_date FROM schedules s
       WHERE s.item_id = i.id ORDER BY s.sale_date DESC LIMIT 1) AS latest_sale_date,
    (SELECT s.result FROM schedules s
       WHERE s.item_id = i.id ORDER BY s.sale_date DESC LIMIT 1) AS latest_result
  FROM items i
  JOIN cases c ON c.id = i.case_id
`;

/**
 * 물건 목록을 조회한다.
 *
 * @param store 읽기 전용 스토어.
 * @param opts  워치리스트·행수 필터.
 */
export function queryItems(store: Store, opts: ItemQuery = {}): ItemRow[] {
  const limit = opts.limit ?? 500;
  if (typeof opts.watchlistId === 'number') {
    // 워치리스트 매칭 물건: 해당 워치리스트에 매칭된 이벤트를 가진 물건만.
    return store.query<ItemRow>(
      `${BASE_SELECT}
       WHERE i.id IN (
         SELECT ev.item_id FROM events ev
         JOIN matches m ON m.event_id = ev.id
         WHERE m.watchlist_id = ?
       )
       ORDER BY i.next_sale_date IS NULL, i.next_sale_date ASC, i.id ASC
       LIMIT ?`,
      [opts.watchlistId, limit],
    );
  }
  return store.query<ItemRow>(
    `${BASE_SELECT}
     ORDER BY i.next_sale_date IS NULL, i.next_sale_date ASC, i.id ASC
     LIMIT ?`,
    [limit],
  );
}
