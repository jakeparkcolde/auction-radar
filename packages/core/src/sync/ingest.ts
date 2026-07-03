import type { Store } from '@auction-radar/store';
import { generateEvents, stateHash } from '../diff/index.js';
import { normalizeCaseNumber, regionNorm } from '../normalize/index.js';
import type { ItemState, SourceRecord } from '../types.js';
import { mapUsage, type UsageCategory } from '../usage-map.js';

/**
 * 레코드 수집(ingest) 로직. (REQ-012, 013, 014, 015, 016, 019)
 *
 * 목록/상세에서 얻은 SourceRecord 를 파싱 → 정규화 → case/item upsert →
 * state_hash diff → 이벤트 생성/삽입(dedup)까지 수행한다.
 * 파싱 실패 레코드는 skip 하고 호출측이 raw_snapshots(parse_ok=0)에 저장한다.
 */

/** 정규화까지 완료된 레코드. */
export interface ParsedRecord {
  readonly court: string;
  readonly caseNumber: string;
  readonly itemNo: number;
  readonly usage: string | null;
  readonly usageCategory: UsageCategory;
  readonly usageWarning?: string;
  readonly addressRaw: string | null;
  readonly regionNorm: string | null;
  readonly appraisedPrice: number | null;
  readonly minSalePrice: number | null;
  readonly failedCount: number;
  readonly correctionCount: number;
  readonly cancellationCount: number;
  readonly status: string | null;
  readonly nextSaleDate: string | null;
  readonly salePlace: string | null;
  readonly remarks: string | null;
}

/** 파싱 결과. */
export interface ParseOutcome {
  readonly ok: boolean;
  readonly parsed?: ParsedRecord;
  readonly warning?: string;
}

/** 값이 유한한 숫자이거나 null/undefined 인지 검증하고 숫자|null 로 강제한다. */
function coerceNullableNumber(value: unknown, fieldName: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  throw new TypeError(`필드 "${fieldName}" 형변환 실패`);
}

/** count 필드: 없으면 0, 숫자가 아니면 형변환 실패. */
function coerceCount(value: unknown, fieldName: string): number {
  if (value === undefined || value === null) return 0;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  throw new TypeError(`필드 "${fieldName}" 형변환 실패`);
}

/**
 * SourceRecord 를 파싱·정규화한다. 필수 필드 누락·형변환 실패 시 ok=false.
 * (REQ-016)
 */
export function parseRecord(rec: SourceRecord): ParseOutcome {
  try {
    const court = typeof rec.court === 'string' ? rec.court.trim() : '';
    const rawCaseNumber = typeof rec.caseNumber === 'string' ? rec.caseNumber : '';
    if (!court) throw new TypeError('필수 필드 "court" 누락');
    const caseNumber = normalizeCaseNumber(rawCaseNumber);
    if (!caseNumber) throw new TypeError('필수 필드 "caseNumber" 누락');

    const usage = rec.usage ?? null;
    const usageMapping = mapUsage(usage);
    const addressRaw = rec.addressRaw ?? null;

    const parsed: ParsedRecord = {
      court,
      caseNumber,
      itemNo: typeof rec.itemNo === 'number' && Number.isInteger(rec.itemNo) ? rec.itemNo : 1,
      usage,
      usageCategory: usageMapping.category,
      ...(usageMapping.warning !== undefined ? { usageWarning: usageMapping.warning } : {}),
      addressRaw,
      regionNorm: regionNorm(addressRaw),
      appraisedPrice: coerceNullableNumber(rec.appraisedPrice, 'appraisedPrice'),
      minSalePrice: coerceNullableNumber(rec.minSalePrice, 'minSalePrice'),
      failedCount: coerceCount(rec.failedCount, 'failedCount'),
      correctionCount: coerceCount(rec.correctionCount, 'correctionCount'),
      cancellationCount: coerceCount(rec.cancellationCount, 'cancellationCount'),
      status: rec.status ?? null,
      nextSaleDate: rec.nextSaleDate ?? null,
      salePlace: rec.salePlace ?? null,
      remarks: rec.remarks ?? null,
    };
    return { ok: true, parsed };
  } catch (err) {
    return { ok: false, warning: err instanceof Error ? err.message : String(err) };
  }
}

/** items 행에서 읽어온 이전 상태 형상. */
interface ItemRow {
  readonly id: number;
  readonly min_sale_price: number | null;
  readonly failed_count: number;
  readonly next_sale_date: string | null;
  readonly correction_count: number;
  readonly cancellation_count: number;
  readonly status: string | null;
  readonly appraised_price: number | null;
}

/** ingest 결과. */
export interface IngestResult {
  readonly itemId: number;
  readonly isNew: boolean;
  readonly eventsCreated: number;
}

/** case 를 upsert 하고 case_id 를 반환한다. */
function upsertCase(store: Store, parsed: ParsedRecord, now: string): number {
  const existing = store.get<{ id: number }>(
    'SELECT id FROM cases WHERE court_code = ? AND case_number = ?',
    [parsed.court, parsed.caseNumber],
  );
  if (existing !== undefined) {
    store.upsert('UPDATE cases SET status = ?, updated_at = ? WHERE id = ?', [
      parsed.status,
      now,
      existing.id,
    ]);
    return existing.id;
  }
  const res = store.upsert(
    'INSERT INTO cases (court_code, case_number, status, updated_at) VALUES (?, ?, ?, ?)',
    [parsed.court, parsed.caseNumber, parsed.status, now],
  );
  return res.lastInsertRowid;
}

/** ItemRow → ItemState 로 변환한다. */
function rowToState(row: ItemRow): ItemState {
  return {
    itemId: row.id,
    minSalePrice: row.min_sale_price,
    failedCount: row.failed_count,
    nextSaleDate: row.next_sale_date,
    correctionCount: row.correction_count,
    cancellationCount: row.cancellation_count,
    status: row.status,
    appraisedPrice: row.appraised_price,
  };
}

/**
 * 파싱된 레코드를 스토어에 반영하고 이벤트를 생성한다.
 *
 * @returns itemId, 신규 여부, 생성된(중복 아닌) 이벤트 수
 */
export function ingestParsed(store: Store, parsed: ParsedRecord, now: string): IngestResult {
  const caseId = upsertCase(store, parsed, now);

  const prevRow = store.get<ItemRow>(
    `SELECT id, min_sale_price, failed_count, next_sale_date, correction_count,
            cancellation_count, status, appraised_price
       FROM items WHERE case_id = ? AND item_no = ?`,
    [caseId, parsed.itemNo],
  );
  const prevState = prevRow !== undefined ? rowToState(prevRow) : null;
  const isNew = prevRow === undefined;

  // 다음 상태의 state_hash 를 미리 계산한다.
  let itemId: number;
  if (prevRow === undefined) {
    const res = store.upsert(
      `INSERT INTO items
         (case_id, item_no, usage, usage_category, address_raw, region_norm,
          appraised_price, min_sale_price, failed_count, correction_count,
          cancellation_count, next_sale_date, status, remarks, state_hash,
          first_seen_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        caseId,
        parsed.itemNo,
        parsed.usage,
        parsed.usageCategory,
        parsed.addressRaw,
        parsed.regionNorm,
        parsed.appraisedPrice,
        parsed.minSalePrice,
        parsed.failedCount,
        parsed.correctionCount,
        parsed.cancellationCount,
        parsed.nextSaleDate,
        parsed.status,
        parsed.remarks,
        '', // state_hash 는 itemId 확정 후 갱신
        now,
        now,
      ],
    );
    itemId = res.lastInsertRowid;
  } else {
    itemId = prevRow.id;
  }

  const nextState: ItemState = {
    itemId,
    minSalePrice: parsed.minSalePrice,
    failedCount: parsed.failedCount,
    nextSaleDate: parsed.nextSaleDate,
    correctionCount: parsed.correctionCount,
    cancellationCount: parsed.cancellationCount,
    status: parsed.status,
    appraisedPrice: parsed.appraisedPrice,
  };
  const newHash = stateHash(nextState);

  if (prevRow !== undefined) {
    store.upsert(
      `UPDATE items SET
         usage = ?, usage_category = ?, address_raw = ?, region_norm = ?,
         appraised_price = ?, min_sale_price = ?, failed_count = ?,
         correction_count = ?, cancellation_count = ?, next_sale_date = ?,
         status = ?, remarks = ?, state_hash = ?, last_seen_at = ?
       WHERE id = ?`,
      [
        parsed.usage,
        parsed.usageCategory,
        parsed.addressRaw,
        parsed.regionNorm,
        parsed.appraisedPrice,
        parsed.minSalePrice,
        parsed.failedCount,
        parsed.correctionCount,
        parsed.cancellationCount,
        parsed.nextSaleDate,
        parsed.status,
        parsed.remarks,
        newHash,
        now,
        itemId,
      ],
    );
  } else {
    store.upsert('UPDATE items SET state_hash = ? WHERE id = ?', [newHash, itemId]);
  }

  // 매각기일 이력 (중복 무시).
  if (parsed.nextSaleDate !== null) {
    store.upsert(
      `INSERT INTO schedules (item_id, sale_date, sale_place, min_price, result)
       VALUES (?, ?, ?, ?, ?) ON CONFLICT(item_id, sale_date) DO NOTHING`,
      [itemId, parsed.nextSaleDate, parsed.salePlace, parsed.minSalePrice, parsed.status],
    );
  }

  // 이벤트 생성 + dedup 삽입.
  const eventsCreated = insertEvents(store, prevState, nextState, now);

  return { itemId, isNew, eventsCreated };
}

/**
 * (이전, 다음) 상태로 이벤트를 생성하고 dedup_key UNIQUE 로 삽입한다.
 * (REQ-014, REQ-015)
 *
 * @returns 실제로 삽입된(중복이 아닌) 이벤트 수
 */
export function insertEvents(
  store: Store,
  prevState: ItemState | null,
  nextState: ItemState,
  now: string,
): number {
  const candidates = generateEvents(prevState, nextState);
  let created = 0;
  for (const ev of candidates) {
    const res = store.upsert(
      `INSERT INTO events (item_id, type, payload, dedup_key, created_at)
       VALUES (?, ?, ?, ?, ?) ON CONFLICT(dedup_key) DO NOTHING`,
      [nextState.itemId, ev.type, JSON.stringify(ev.payload), ev.dedupKey, now],
    );
    created += res.changes;
  }
  return created;
}
