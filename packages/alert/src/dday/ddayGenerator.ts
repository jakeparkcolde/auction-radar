import type { Store } from '@auction-radar/store';
import { addDaysKST, todayKST } from '../time/kst.js';

/**
 * D-day Generator. (SPEC-ALERT-001 REQ-007/008/009, AC-02)
 *
 * - 매일 07:50(KST) 실행 가정. schedules 를 스캔해 매각기일이 오늘+7 / 오늘+1 인
 *   물건에 대해 d7 / d1 이벤트를 생성한다.
 * - dedup_key: `{item_id}:d7:{sale_date}` / `{item_id}:d1:{sale_date}` (DB UNIQUE 로 멱등).
 * - DB 의 기존 기일 데이터만 사용한다. 수집기 성공 여부(sync_runs.blocked)에 절대 의존하지 않는다.
 */

/** D-day 생성 결과. */
export interface DdayResult {
  /** 생성된 d7 이벤트 수. */
  readonly d7: number;
  /** 생성된 d1 이벤트 수. */
  readonly d1: number;
}

interface ScheduleRow {
  readonly item_id: number;
  readonly sale_date: string;
  readonly min_price: number | null;
}

/** 특정 매각기일에 해당하는 schedules 를 조회한다. */
function schedulesOn(store: Store, saleDate: string): ScheduleRow[] {
  return store.query<ScheduleRow>(
    'SELECT item_id, sale_date, min_price FROM schedules WHERE sale_date = ? ORDER BY item_id',
    [saleDate],
  );
}

/** d7/d1 이벤트를 삽입한다(멱등). 새로 삽입된 수를 반환. */
function insertDday(
  store: Store,
  rows: readonly ScheduleRow[],
  type: 'd7' | 'd1',
  nowISO: string,
): number {
  let inserted = 0;
  for (const row of rows) {
    const payload = JSON.stringify({ saleDate: row.sale_date, minSalePrice: row.min_price ?? null });
    const dedupKey = `${row.item_id}:${type}:${row.sale_date}`;
    const res = store.upsert(
      'INSERT OR IGNORE INTO events (item_id, type, payload, dedup_key, created_at) VALUES (?, ?, ?, ?, ?)',
      [row.item_id, type, payload, dedupKey, nowISO],
    );
    inserted += res.changes;
  }
  return inserted;
}

/**
 * D-7/D-1 리마인더 이벤트를 생성한다.
 *
 * @param store 스토어(트랜잭션 밖에서 호출 가능).
 * @param now 실행 기준 instant(Date|epoch ms) — todayKST 산출용.
 * @param nowISO events.created_at 저장용 ISO 문자열(기본: now 의 ISO).
 */
export function generateDdayEvents(
  store: Store,
  now: Date | number,
  nowISO?: string,
): DdayResult {
  const createdAt = nowISO ?? new Date(typeof now === 'number' ? now : now.getTime()).toISOString();
  const today = todayKST(now);
  const d7date = addDaysKST(today, 7);
  const d1date = addDaysKST(today, 1);

  const d7 = insertDday(store, schedulesOn(store, d7date), 'd7', createdAt);
  const d1 = insertDday(store, schedulesOn(store, d1date), 'd1', createdAt);
  return { d7, d1 };
}
