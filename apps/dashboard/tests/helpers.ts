import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BUILTIN_MIGRATIONS, runMigrations, SqliteStore } from '@auction-radar/store';
import type { Store } from '@auction-radar/store';
import { ALERT_MIGRATIONS } from '@auction-radar/alert';

/**
 * 대시보드 테스트 공용 시드 헬퍼.
 *
 * 서버가 자체 커넥션으로 파일을 열어야 하므로 :memory: 가 아닌 TEMP-FILE DB 를 쓴다.
 * 시드는 RW 스토어로 마이그레이션·삽입 후 close(마지막 커넥션 checkpoint)한다.
 * 여기서의 INSERT 는 테스트 시드(스토어 패키지 API)이며 대시보드 코드 경로가 아니다.
 */

/** 임시 파일 DB 핸들. */
export interface TempDb {
  readonly path: string;
  readonly dir: string;
  cleanup(): void;
}

/** 기준 시각: 2026-07-03 12:00 KST (03:00Z). */
export const NOW = new Date('2026-07-03T03:00:00Z');

/**
 * 마이그레이션이 적용된 임시 파일 DB 를 만들고 시드 콜백을 실행한다.
 *
 * @param seed 시드 콜백(RW 스토어).
 */
export function makeTempDb(seed?: (store: Store) => void): TempDb {
  const dir = mkdtempSync(join(tmpdir(), 'ar-dash-'));
  const path = join(dir, 'test.db');
  const store = new SqliteStore(path);
  runMigrations(store, [...BUILTIN_MIGRATIONS, ...ALERT_MIGRATIONS]);
  if (seed) seed(store);
  store.close();
  return {
    path,
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** ISO 문자열(now 기준 days 만큼 이전/이후). */
function iso(days: number): string {
  return new Date(NOW.getTime() + days * 86_400_000).toISOString();
}

/**
 * AC-01/02/03/07 전체 시나리오 시드.
 *
 * - 워치리스트 "인천 서구 아파트"(id=1) 에 물건 A·B 가 매칭.
 * - A: enrich 높음(−32%, 표본 14, 강조), 매각기일 D-5(임박).
 * - B: enrich 낮음(참고치, 표본 2, 강조 없음).
 * - C: 워치리스트 미매칭(필터 시 제외).
 */
export function seedFull(store: Store): void {
  // 워치리스트.
  store.upsert(
    'INSERT INTO watchlists (id, name, config, enabled, created_at) VALUES (?, ?, ?, 1, ?)',
    [1, '인천 서구 아파트', '{}', iso(-30)],
  );
  store.upsert(
    'INSERT INTO watchlists (id, name, config, enabled, created_at) VALUES (?, ?, ?, 1, ?)',
    [2, '부천 오피스텔', '{}', iso(-30)],
  );

  // 사건.
  const cases: [number, string, string][] = [
    [10, 'B000210', '2025타경1000'],
    [11, 'B000210', '2025타경1001'],
    [12, 'B000211', '2025타경1002'],
  ];
  for (const [id, court, no] of cases) {
    store.upsert(
      'INSERT INTO cases (id, court_code, case_number, case_name, status, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [id, court, no, '아파트 임의경매', '진행중', iso(-1)],
    );
  }

  // 물건 A(id=100): enrich 높음, 임박 D-5.
  store.upsert(
    `INSERT INTO items
       (id, case_id, item_no, usage, usage_category, address_raw, region_norm, lawd_cd,
        appraised_price, min_sale_price, failed_count, next_sale_date, status, first_seen_at, last_seen_at)
     VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [100, 10, '아파트', '아파트', '행복아파트', '인천 서구', '11710', 400_000_000, 256_000_000, 1, '2026-07-08', '진행중', iso(-40), iso(-1)],
  );
  // 물건 B(id=101): enrich 낮음.
  store.upsert(
    `INSERT INTO items
       (id, case_id, item_no, usage, usage_category, address_raw, region_norm, lawd_cd,
        appraised_price, min_sale_price, failed_count, next_sale_date, status, first_seen_at, last_seen_at)
     VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [101, 11, '아파트', '아파트', '샛별아파트', '인천 서구', '11720', 350_000_000, 255_000_000, 0, '2026-09-01', '진행중', iso(-40), iso(-1)],
  );
  // 물건 C(id=102): 미매칭, enrich 없음(lawd_cd null).
  store.upsert(
    `INSERT INTO items
       (id, case_id, item_no, usage, usage_category, address_raw, region_norm, lawd_cd,
        appraised_price, min_sale_price, failed_count, next_sale_date, status, first_seen_at, last_seen_at)
     VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [102, 12, '아파트', '아파트', '한빛아파트', '부천 원미', null, 500_000_000, 480_000_000, 0, '2026-10-01', '진행중', iso(-40), iso(-1)],
  );

  // 매각기일(schedules) — A 의 최신 기일.
  store.upsert(
    'INSERT INTO schedules (item_id, sale_date, sale_place, min_price, result) VALUES (?, ?, ?, ?, ?)',
    [100, '2026-07-08', '인천지법 경매1계', 256_000_000, '예정'],
  );

  // 이벤트 + 매칭.
  // A: price_drop (워치리스트 1 매칭).
  store.upsert(
    'INSERT INTO events (id, item_id, type, payload, dedup_key, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [1000, 100, 'price_drop', '{}', 'k-1000', iso(-2)],
  );
  store.upsert('INSERT INTO matches (event_id, watchlist_id) VALUES (?, ?)', [1000, 1]);
  // A: d7 (워치리스트 1 매칭).
  store.upsert(
    'INSERT INTO events (id, item_id, type, payload, dedup_key, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [1001, 100, 'd7', '{}', 'k-1001', iso(-1)],
  );
  store.upsert('INSERT INTO matches (event_id, watchlist_id) VALUES (?, ?)', [1001, 1]);
  // B: new (워치리스트 1 매칭).
  store.upsert(
    'INSERT INTO events (id, item_id, type, payload, dedup_key, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [1002, 101, 'new', '{}', 'k-1002', iso(-3)],
  );
  store.upsert('INSERT INTO matches (event_id, watchlist_id) VALUES (?, ?)', [1002, 1]);
  // C: new (미매칭).
  store.upsert(
    'INSERT INTO events (id, item_id, type, payload, dedup_key, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [1003, 102, 'new', '{}', 'k-1003', iso(-3)],
  );

  // rt_trades: A(11710) 14건 → median 376M(할인 −32%, 표본 14 → 높음).
  for (let i = 0; i < 14; i += 1) {
    store.upsert(
      'INSERT INTO rt_trades (lawd_cd, deal_ym, apt_name_norm, area, floor, price, deal_date, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ['11710', '202607', '행복아파트', null, null, 376_000_000, '2026-07-01', iso(-5)],
    );
  }
  // rt_trades: B(11720) 2건 → median 300M(할인 −15%, 표본 2 → 낮음).
  for (let i = 0; i < 2; i += 1) {
    store.upsert(
      'INSERT INTO rt_trades (lawd_cd, deal_ym, apt_name_norm, area, floor, price, deal_date, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ['11720', '202607', '샛별아파트', null, null, 300_000_000, '2026-07-01', iso(-5)],
    );
  }

  // sync_runs: 성공 1건(배너 없음).
  store.upsert(
    'INSERT INTO sync_runs (started_at, finished_at, calls_used, items_upserted, events_created, blocked, error) VALUES (?, ?, ?, ?, ?, 0, NULL)',
    [iso(-1), iso(-1), 10, 3, 4],
  );
}

/**
 * AC-08 시드: 마지막 sync 차단(blocked=1) + 2일 전 성공.
 */
export function seedBlocked(store: Store): void {
  store.upsert(
    'INSERT INTO sync_runs (started_at, finished_at, calls_used, items_upserted, events_created, blocked, error) VALUES (?, ?, ?, ?, ?, 0, NULL)',
    [iso(-2), iso(-2), 5, 2, 3],
  );
  store.upsert(
    'INSERT INTO sync_runs (started_at, finished_at, calls_used, items_upserted, events_created, blocked, error) VALUES (?, ?, ?, ?, ?, 1, ?)',
    [iso(0), iso(0), 0, 0, 0, '레이트 리밋 차단'],
  );
}

/**
 * AC-07 시드: 물건은 있으나 rt_trades 가 비어 있음(enrich 부재).
 */
export function seedNoTrades(store: Store): void {
  store.upsert(
    'INSERT INTO cases (id, court_code, case_number, updated_at) VALUES (?, ?, ?, ?)',
    [20, 'B000210', '2025타경2000', iso(-1)],
  );
  store.upsert(
    `INSERT INTO items
       (id, case_id, item_no, usage, address_raw, region_norm, lawd_cd,
        appraised_price, min_sale_price, failed_count, next_sale_date, status, first_seen_at, last_seen_at)
     VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    [200, 20, '아파트', '행복아파트', '인천 서구', '11710', 400_000_000, 256_000_000, '2026-08-01', '진행중', iso(-10), iso(-1)],
  );
  store.upsert(
    'INSERT INTO events (id, item_id, type, payload, dedup_key, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [2000, 200, 'new', '{}', 'k-2000', iso(-2)],
  );
}
