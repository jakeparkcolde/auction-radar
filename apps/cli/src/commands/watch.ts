import type { Store } from '@auction-radar/store';
import { evaluate } from '@auction-radar/alert';
import type { WatchlistConfig } from '@auction-radar/alert';
import { CliError, ExitCode } from '../exit.js';
import { withDisclaimer } from '../disclaimer.js';
import type { WatchlistEntry } from '../config/schema.js';
import type { Output } from '../output.js';
import {
  addWatchlistRow,
  getWatchlistByName,
  listWatchlists,
  removeWatchlistByName,
} from '../store/watchlists.js';

/**
 * watch 명령 — 워치리스트 CRUD + 매칭 미리보기. (CLI-REQ-008, AC-03)
 *
 * test 는 현재 DB 기준 매칭 건수를 발송·기록 없이 미리 보여준다.
 */

/** watch 명령 컨텍스트. */
export interface WatchCtx {
  readonly store: Store;
  readonly out: Output;
  readonly now: () => string;
}

/** 이벤트×물건 조인 행(미리보기 평가용). */
interface EventItemRow {
  readonly type: string;
  readonly court_code: string;
  readonly case_number: string;
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
  SELECT e.type,
         c.court_code, c.case_number, i.region_norm, i.usage, i.usage_category,
         i.appraised_price, i.min_sale_price, i.failed_count, i.remarks, i.address_raw
  FROM events e
  JOIN items i ON i.id = e.item_id
  JOIN cases c ON c.id = i.case_id
  ORDER BY e.id
`;

/** 워치리스트를 추가한다. */
export function watchAdd(ctx: WatchCtx, entry: WatchlistEntry): number {
  const id = addWatchlistRow(ctx.store, entry, ctx.now());
  ctx.out.log(withDisclaimer(`워치리스트 "${entry.name ?? '내 조건'}" 를 추가했습니다 (id=${id}).`));
  return id;
}

/** 워치리스트 목록을 출력한다. */
export function watchList(ctx: WatchCtx): number {
  const rows = listWatchlists(ctx.store);
  if (rows.length === 0) {
    ctx.out.log(withDisclaimer('등록된 워치리스트가 없습니다.'));
    return 0;
  }
  ctx.out.log(`워치리스트 ${rows.length}건:`);
  for (const r of rows) {
    const courts = (r.config.courts ?? []).join(',') || '(전체)';
    const state = r.enabled ? 'on' : 'off';
    ctx.out.log(`- [${r.id}] ${r.name} · 법원 ${courts} · ${state}`);
  }
  ctx.out.log(withDisclaimer(''));
  return rows.length;
}

/** 워치리스트를 이름으로 삭제한다. */
export function watchRemove(ctx: WatchCtx, name: string): number {
  const removed = removeWatchlistByName(ctx.store, name);
  if (removed === 0) {
    throw new CliError(`워치리스트 "${name}" 를 찾을 수 없습니다.`, ExitCode.RUNTIME);
  }
  ctx.out.log(withDisclaimer(`워치리스트 "${name}" 를 삭제했습니다.`));
  return removed;
}

/**
 * watch test — 현재 DB 기준 매칭 미리보기(발송·기록 없음). (AC-03)
 *
 * @returns 매칭된 이벤트 수.
 */
export function watchTest(ctx: WatchCtx, name: string): number {
  const wl = getWatchlistByName(ctx.store, name);
  if (wl === undefined) {
    throw new CliError(`워치리스트 "${name}" 를 찾을 수 없습니다.`, ExitCode.RUNTIME);
  }
  const config: WatchlistConfig = wl.config;
  const rows = ctx.store.query<EventItemRow>(EVENT_ITEM_SQL);

  let matched = 0;
  const previews: string[] = [];
  for (const row of rows) {
    const hit = evaluate(
      { type: row.type },
      {
        courtCode: row.court_code,
        regionNorm: row.region_norm,
        usage: row.usage,
        usageCategory: row.usage_category,
        appraisedPrice: row.appraised_price,
        minSalePrice: row.min_sale_price,
        failedCount: row.failed_count,
        remarks: row.remarks,
        addressRaw: row.address_raw,
      },
      config,
    );
    if (hit) {
      matched += 1;
      if (previews.length < 5) {
        const region = row.region_norm ? ` · ${row.region_norm}` : '';
        previews.push(`- ${row.court_code} ${row.case_number}${region}`);
      }
    }
  }

  ctx.out.log(`"${name}" 매칭 미리보기: ${matched}건 (발송하지 않음)`);
  for (const p of previews) ctx.out.log(p);
  ctx.out.log(withDisclaimer(''));
  return matched;
}
