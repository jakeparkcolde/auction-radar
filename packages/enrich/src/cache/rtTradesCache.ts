import type { Store } from '@auction-radar/store';
import type { MolitClient } from '../molit/client.js';
import type { RtTradeRecord } from '../types.js';

/**
 * rt_trades 캐시 레이어. (REQ-002)
 *
 * - 워치리스트 lawd_cd × 최근 12개월 조합만 조회·캐시한다.
 * - 동일 (lawd_cd, deal_ym) 재조회는 월 1회로 제한한다(MAX(fetched_at) 기준 월 게이트).
 * - 쓰기는 tx 안에서 delete-then-insert(조합 단위 멱등), prepared statement 전용.
 */

const INSERT_SQL =
  'INSERT INTO rt_trades (lawd_cd, deal_ym, apt_name_norm, area, floor, price, deal_date, fetched_at) ' +
  'VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
const DELETE_SQL = 'DELETE FROM rt_trades WHERE lawd_cd = ? AND deal_ym = ?';
const MAX_FETCHED_SQL =
  'SELECT MAX(fetched_at) AS max_fetched FROM rt_trades WHERE lawd_cd = ? AND deal_ym = ?';

/** ISO 문자열의 연-월(YYYY-MM)을 반환한다. */
function yearMonth(iso: string): string {
  return iso.slice(0, 7);
}

/**
 * 기준 시각으로부터 최근 12개월의 DEAL_YMD(YYYYMM) 목록을 반환한다(당월 포함, 내림차순).
 *
 * @param now 기준 시각.
 */
export function last12Months(now: Date): string[] {
  const out: string[] = [];
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-based
  for (let i = 0; i < 12; i += 1) {
    const d = new Date(Date.UTC(year, month - i, 1));
    const ym = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    out.push(ym);
  }
  return out;
}

/**
 * (lawd_cd, deal_ym) 을 이번 달에 이미 fetch 했는지(월 게이트) 판정한다. (REQ-002, AC-02)
 *
 * @returns 이번 달에 fetch 되지 않았다면 true(재조회 필요).
 */
export function shouldRefresh(store: Store, lawdCd: string, dealYm: string, now: Date): boolean {
  const row = store.get<{ max_fetched: string | null }>(MAX_FETCHED_SQL, [lawdCd, dealYm]);
  const last = row?.max_fetched;
  if (!last) return true;
  return yearMonth(last) !== yearMonth(now.toISOString());
}

/**
 * (lawd_cd, deal_ym) 조합의 실거래를 delete-then-insert 로 캐시에 기록한다.
 *
 * @param fetchedAt 기록 시각 ISO.
 */
export function writeTrades(
  store: Store,
  lawdCd: string,
  dealYm: string,
  records: readonly RtTradeRecord[],
  fetchedAt: string,
): void {
  store.tx((s) => {
    s.upsert(DELETE_SQL, [lawdCd, dealYm]);
    for (const r of records) {
      s.upsert(INSERT_SQL, [
        r.lawdCd,
        r.dealYm,
        r.aptNameNorm,
        r.area,
        r.floor,
        r.price,
        r.dealDate,
        fetchedAt,
      ]);
    }
  });
}

/** 캐시 갱신 요약. */
export interface RefreshSummary {
  /** MOLIT 를 실제 호출한 (lawd_cd, deal_ym) 조합 수. */
  readonly fetched: number;
  /** 월 게이트로 건너뛴 조합 수. */
  readonly skipped: number;
  /** 오류로 건너뛴 조합 수(캐시 유지). */
  readonly errors: number;
}

/** 캐시 갱신 의존성. */
export interface RefreshDeps {
  readonly now?: () => Date;
  readonly logger?: { warn: (m: string) => void };
}

/**
 * 워치리스트 lawd_cd × 최근 12개월 조합을 갱신한다(월 게이트 적용). (REQ-002, REQ-003)
 *
 * 조합별 오류는 격리해 다음 조합을 계속 처리한다(쿼터 소진 시 캐시 유지).
 *
 * @param store   스토어.
 * @param client  MOLIT 클라이언트.
 * @param lawdCds 워치리스트 법정동코드 집합.
 * @param deps    시간·로거 주입.
 */
export async function refreshRtTradesCache(
  store: Store,
  client: MolitClient,
  lawdCds: readonly string[],
  deps: RefreshDeps = {},
): Promise<RefreshSummary> {
  const nowFn = deps.now ?? (() => new Date());
  const now = nowFn();
  const months = last12Months(now);

  let fetched = 0;
  let skipped = 0;
  let errors = 0;

  for (const lawdCd of lawdCds) {
    for (const dealYm of months) {
      if (!shouldRefresh(store, lawdCd, dealYm, now)) {
        skipped += 1;
        continue;
      }
      try {
        const records = await client.fetchMonth(lawdCd, dealYm);
        writeTrades(store, lawdCd, dealYm, records, nowFn().toISOString());
        fetched += 1;
      } catch (err) {
        errors += 1;
        deps.logger?.warn(
          `rt_trades 갱신 실패(lawd_cd=${lawdCd}, deal_ym=${dealYm}) — 캐시 유지: ${String(err)}`,
        );
      }
    }
  }

  return { fetched, skipped, errors };
}

/** 매칭용: 대상 lawd_cd 의 실거래 레코드를 캐시에서 읽는다(최근 12개월). */
export function loadTradesForLawd(store: Store, lawdCd: string, months: readonly string[]): RtTradeRecord[] {
  if (months.length === 0) return [];
  const placeholders = months.map(() => '?').join(', ');
  const rows = store.query<{
    lawd_cd: string;
    deal_ym: string;
    apt_name_norm: string | null;
    area: number | null;
    floor: number | null;
    price: number;
    deal_date: string | null;
  }>(
    `SELECT lawd_cd, deal_ym, apt_name_norm, area, floor, price, deal_date
     FROM rt_trades
     WHERE lawd_cd = ? AND deal_ym IN (${placeholders})`,
    [lawdCd, ...months],
  );
  return rows.map((r) => ({
    lawdCd: r.lawd_cd,
    dealYm: r.deal_ym,
    aptNameNorm: r.apt_name_norm,
    area: r.area,
    floor: r.floor,
    price: r.price,
    dealDate: r.deal_date,
  }));
}
