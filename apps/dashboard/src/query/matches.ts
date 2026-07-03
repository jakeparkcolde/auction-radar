import type { Store } from '@auction-radar/store';

/**
 * 워치리스트별 매칭 현황 조회. (SPEC-UI-001 REQ-004, REQ-007)
 *
 * watchlists + matches 집계. 필터 UI(워치리스트 선택)와 매칭 카운트에 사용. 읽기 전용.
 */

/** 워치리스트별 매칭 현황 행. */
export interface WatchlistMatchRow {
  readonly watchlist_id: number;
  readonly name: string;
  readonly enabled: number;
  /** 이 워치리스트에 매칭된 이벤트 수. */
  readonly match_count: number;
}

/**
 * 워치리스트 목록과 각 워치리스트의 매칭 이벤트 수를 조회한다.
 *
 * @param store 읽기 전용 스토어.
 */
export function queryWatchlistMatches(store: Store): WatchlistMatchRow[] {
  return store.query<WatchlistMatchRow>(
    `SELECT w.id AS watchlist_id, w.name, w.enabled,
            (SELECT COUNT(*) FROM matches m WHERE m.watchlist_id = w.id) AS match_count
     FROM watchlists w
     ORDER BY w.id ASC`,
  );
}
