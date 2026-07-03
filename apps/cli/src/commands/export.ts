import writeXlsxFile from 'write-excel-file/node';
import type { SheetData } from 'write-excel-file/node';
import type { Store } from '@auction-radar/store';
import { withDisclaimer } from '../disclaimer.js';
import type { Output } from '../output.js';

/**
 * export 명령 — 매칭 물건 xlsx 내보내기. (CLI-REQ-012, AC-05, 결정 D2)
 *
 * 매칭된(matches) 물건을 감정가·최저가·기일·주소(+ 법원/사건/용도) 컬럼으로 내보낸다.
 * 특정 워치리스트로 필터링할 수 있다.
 */

/** 내보내기 한 행. */
export interface ExportRow {
  readonly court: string;
  readonly caseNumber: string;
  readonly usage: string | null;
  readonly appraised: number | null;
  readonly minSale: number | null;
  readonly saleDate: string | null;
  readonly address: string | null;
}

/** 내보내기 데이터(헤더 + 행). */
export interface ExportData {
  readonly header: string[];
  readonly rows: ExportRow[];
}

/** 컬럼 헤더(§ 필수: 감정가·최저가·기일·주소 + 법원·사건·용도). */
export const EXPORT_HEADER: readonly string[] = [
  '법원',
  '사건번호',
  '용도',
  '감정가',
  '최저가',
  '기일',
  '주소',
];

interface ExportSqlRow {
  readonly court_code: string;
  readonly case_number: string;
  readonly usage: string | null;
  readonly appraised_price: number | null;
  readonly min_sale_price: number | null;
  readonly next_sale_date: string | null;
  readonly address_raw: string | null;
}

/**
 * 매칭 물건 행을 조회한다(선택적으로 워치리스트 이름으로 필터).
 */
export function buildExportRows(store: Store, watchlistName?: string): ExportData {
  const base = `
    SELECT DISTINCT i.id AS iid, c.court_code, c.case_number, i.usage,
           i.appraised_price, i.min_sale_price, i.next_sale_date, i.address_raw
    FROM matches m
    JOIN events e ON e.id = m.event_id
    JOIN items i ON i.id = e.item_id
    JOIN cases c ON c.id = i.case_id
  `;
  const sql =
    watchlistName === undefined
      ? `${base} ORDER BY i.id`
      : `${base} JOIN watchlists w ON w.id = m.watchlist_id WHERE w.name = ? ORDER BY i.id`;
  const params = watchlistName === undefined ? [] : [watchlistName];

  const sqlRows = store.query<ExportSqlRow>(sql, params);
  const rows: ExportRow[] = sqlRows.map((r) => ({
    court: r.court_code,
    caseNumber: r.case_number,
    usage: r.usage,
    appraised: r.appraised_price,
    minSale: r.min_sale_price,
    saleDate: r.next_sale_date,
    address: r.address_raw,
  }));
  return { header: [...EXPORT_HEADER], rows };
}

/** ExportData → write-excel-file SheetData(헤더 볼드 + 데이터 행). */
export function toSheetData(data: ExportData): SheetData {
  const headerRow = data.header.map((value) => ({
    value,
    type: String,
    fontWeight: 'bold' as const,
  }));
  const dataRows = data.rows.map((r) => [
    { value: r.court, type: String },
    { value: r.caseNumber, type: String },
    { value: r.usage ?? '', type: String },
    r.appraised === null ? null : { value: r.appraised, type: Number },
    r.minSale === null ? null : { value: r.minSale, type: Number },
    { value: r.saleDate ?? '', type: String },
    { value: r.address ?? '', type: String },
  ]);
  return [headerRow, ...dataRows];
}

/**
 * 매칭 물건을 xlsx 파일로 기록하고 데이터 행 수를 반환한다.
 */
export async function writeExportFile(
  store: Store,
  filePath: string,
  watchlistName?: string,
): Promise<number> {
  const data = buildExportRows(store, watchlistName);
  await writeXlsxFile(toSheetData(data)).toFile(filePath);
  return data.rows.length;
}

/** export 명령 옵션. */
export interface ExportOptions {
  readonly filePath: string;
  readonly watchlist?: string;
}

/** export 컨텍스트. */
export interface ExportCtx {
  readonly store: Store;
  readonly out: Output;
}

/**
 * export 명령을 실행한다.
 *
 * @returns 내보낸 데이터 행 수.
 */
export async function runExportCommand(ctx: ExportCtx, opts: ExportOptions): Promise<number> {
  const count = await writeExportFile(ctx.store, opts.filePath, opts.watchlist);
  const scope = opts.watchlist ? ` (워치리스트 "${opts.watchlist}")` : '';
  ctx.out.log(withDisclaimer(`${count}건을 내보냈습니다${scope}: ${opts.filePath}`));
  return count;
}
