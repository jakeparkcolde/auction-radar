import type { Store } from '@auction-radar/store';

/**
 * 이벤트 이력(타임라인) 조회. (SPEC-UI-001 REQ-004, REQ-007)
 *
 * events + items + cases 조인. 타입·기간·워치리스트 필터. 읽기 전용(store.query 만).
 */

/** 이벤트 타입(6종). */
export type DashboardEventType = 'new' | 'price_drop' | 'changed' | 'cancelled' | 'd7' | 'd1';

/** 이벤트 조회 옵션. */
export interface EventQuery {
  /** 워치리스트 id 필터. */
  readonly watchlistId?: number;
  /** 이벤트 타입 필터(1종). */
  readonly type?: DashboardEventType;
  /** 이 ISO 시각 이후(created_at >=) 만. 기간 필터. */
  readonly sinceIso?: string;
  /** 최대 행 수(기본 300). */
  readonly limit?: number;
}

/** 이벤트 조회 결과 행. */
export interface EventRow {
  readonly id: number;
  readonly item_id: number;
  readonly type: string;
  readonly payload: string;
  readonly created_at: string;
  readonly court_code: string;
  readonly case_number: string;
  readonly region_norm: string | null;
  readonly address_raw: string | null;
}

/**
 * 이벤트 이력을 최신순으로 조회한다.
 *
 * @param store 읽기 전용 스토어.
 * @param opts  타입·기간·워치리스트 필터.
 */
export function queryEvents(store: Store, opts: EventQuery = {}): EventRow[] {
  const limit = opts.limit ?? 300;
  const where: string[] = [];
  const params: unknown[] = [];

  if (typeof opts.watchlistId === 'number') {
    where.push('ev.id IN (SELECT m.event_id FROM matches m WHERE m.watchlist_id = ?)');
    params.push(opts.watchlistId);
  }
  if (opts.type) {
    where.push('ev.type = ?');
    params.push(opts.type);
  }
  if (opts.sinceIso) {
    where.push('ev.created_at >= ?');
    params.push(opts.sinceIso);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  params.push(limit);

  return store.query<EventRow>(
    `SELECT ev.id, ev.item_id, ev.type, ev.payload, ev.created_at,
            c.court_code, c.case_number, i.region_norm, i.address_raw
     FROM events ev
     JOIN items i ON i.id = ev.item_id
     JOIN cases c ON c.id = i.case_id
     ${whereSql}
     ORDER BY ev.created_at DESC, ev.id DESC
     LIMIT ?`,
    params,
  );
}
