import type { Store } from '@auction-radar/store';
import { normalizeCaseNumber } from '@auction-radar/core';
import { formatKRW } from '@auction-radar/alert';
import { withDisclaimer } from '../disclaimer.js';
import type { Output } from '../output.js';

/**
 * case 명령 — 사건 단건 조회(기일 이력 포함). (CLI-REQ-009)
 *
 * DB 의 cases ⋈ items ⋈ schedules 를 읽어 출력한다. 미존재 사건이면 sync 를 안내한다.
 */

/** case 명령 컨텍스트. */
export interface CaseCtx {
  readonly store: Store;
  readonly out: Output;
}

interface CaseRow {
  readonly id: number;
  readonly court_code: string;
  readonly case_number: string;
  readonly status: string | null;
}

interface ItemRow {
  readonly id: number;
  readonly item_no: number;
  readonly usage: string | null;
  readonly address_raw: string | null;
  readonly appraised_price: number | null;
  readonly min_sale_price: number | null;
  readonly next_sale_date: string | null;
}

interface ScheduleRow {
  readonly sale_date: string;
  readonly min_price: number | null;
  readonly result: string | null;
}

/** case 결과(테스트 검증용). */
export interface CaseResult {
  readonly found: boolean;
  readonly itemCount: number;
}

/** 가격을 억/만 표기로(없으면 '-'). */
function price(v: number | null): string {
  return v === null ? '-' : formatKRW(v);
}

/**
 * 사건 단건을 조회·출력한다.
 */
export function runCaseCommand(ctx: CaseCtx, courtCode: string, caseNumberRaw: string): CaseResult {
  const caseNumber = normalizeCaseNumber(caseNumberRaw);
  const row = ctx.store.get<CaseRow>(
    'SELECT id, court_code, case_number, status FROM cases WHERE court_code = ? AND case_number = ?',
    [courtCode, caseNumber],
  );

  if (row === undefined) {
    ctx.out.log(
      withDisclaimer(
        `사건을 찾을 수 없습니다: ${courtCode} ${caseNumber}\n` +
          `아직 수집되지 않았을 수 있습니다. 'auction-radar sync' 를 먼저 실행하세요.`,
      ),
    );
    return { found: false, itemCount: 0 };
  }

  ctx.out.log(`사건 ${row.court_code} ${row.case_number} · 상태 ${row.status ?? '-'}`);

  const items = ctx.store.query<ItemRow>(
    `SELECT id, item_no, usage, address_raw, appraised_price, min_sale_price, next_sale_date
       FROM items WHERE case_id = ? ORDER BY item_no`,
    [row.id],
  );

  for (const item of items) {
    ctx.out.log(
      `  · 물건 ${item.item_no} (${item.usage ?? '-'}) ${item.address_raw ?? '-'} · ` +
        `감정가 ${price(item.appraised_price)} · 최저가 ${price(item.min_sale_price)} · ` +
        `기일 ${item.next_sale_date ?? '-'}`,
    );
    const schedules = ctx.store.query<ScheduleRow>(
      'SELECT sale_date, min_price, result FROM schedules WHERE item_id = ? ORDER BY sale_date',
      [item.id],
    );
    for (const s of schedules) {
      ctx.out.log(`      - 기일 ${s.sale_date} · 최저가 ${price(s.min_price)} · ${s.result ?? '-'}`);
    }
  }

  ctx.out.log(withDisclaimer(''));
  return { found: true, itemCount: items.length };
}
