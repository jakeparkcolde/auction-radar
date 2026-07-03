import type { Store } from '@auction-radar/store';
import type { RenderEventType, RenderInput } from '../render/renderer.js';

/**
 * 이벤트 소비 커서. (SPEC-ALERT-001 REQ-005/006, AC-04)
 *
 * - selectUndelivered: matches 된 이벤트 중 미발송(notifications 부재 또는 status IN
 *   ('failed','held') 이고 deliver_after 가 없거나 now 이하)만 선별한다.
 * - record*: 발송 결과(sent/failed/held)를 notifications 에 기록한다.
 * - 이미 sent 인 이벤트는 재선별되지 않는다(중복 발송 방어, REQ-006).
 */

const DEFAULT_CHANNEL = 'telegram';

/** 선별된 미발송 이벤트(렌더링에 필요한 정규화 형상). */
export interface UndeliveredEvent {
  readonly eventId: number;
  readonly type: string;
  readonly render: RenderInput;
}

interface UndeliveredRow {
  readonly event_id: number;
  readonly type: string;
  readonly payload: string;
  readonly court_code: string;
  readonly case_number: string;
  readonly region_norm: string | null;
  readonly address_raw: string | null;
  readonly usage: string | null;
  readonly min_sale_price: number | null;
  readonly failed_count: number;
  readonly next_sale_date: string | null;
}

/**
 * 미발송 이벤트 선별 쿼리.
 *
 * notifications 는 event 당 최신 행(MAX(id)) 기준으로 상태를 판정한다.
 * SQLite 는 MAX() 집계 시 동일 행의 다른 컬럼을 함께 반환한다.
 */
const UNDELIVERED_SQL = `
  SELECT e.id AS event_id, e.type, e.payload,
         c.court_code, c.case_number,
         i.region_norm, i.address_raw, i.usage, i.min_sale_price, i.failed_count, i.next_sale_date
  FROM events e
  JOIN matches m ON m.event_id = e.id
  JOIN items i ON i.id = e.item_id
  JOIN cases c ON c.id = i.case_id
  LEFT JOIN (
    SELECT event_id, status, deliver_after, MAX(id) AS mid
    FROM notifications
    WHERE channel = ?
    GROUP BY event_id
  ) n ON n.event_id = e.id
  WHERE n.event_id IS NULL
     OR (n.status IN ('failed','held') AND (n.deliver_after IS NULL OR n.deliver_after <= ?))
  GROUP BY e.id
  ORDER BY e.id
`;

/** payload 에서 전/후 최저가를 추출한다(재계산 없이 snapshot 사용). */
function extractPrices(
  type: string,
  payload: Record<string, unknown>,
  currentMin: number | null,
): { before: number | null; after: number | null } {
  if (type === 'price_drop') {
    const before = (payload.before as { minSalePrice?: number | null } | undefined)?.minSalePrice ?? null;
    const after = (payload.after as { minSalePrice?: number | null } | undefined)?.minSalePrice ?? null;
    return { before, after };
  }
  if (type === 'new') {
    const after = (payload.minSalePrice as number | null | undefined) ?? currentMin;
    return { before: null, after };
  }
  return { before: null, after: currentMin };
}

/** DB row 를 RenderInput 으로 매핑한다. */
function toRenderInput(row: UndeliveredRow): RenderInput {
  const payload = JSON.parse(row.payload) as Record<string, unknown>;
  const { before, after } = extractPrices(row.type, payload, row.min_sale_price);
  return {
    eventType: row.type as RenderEventType,
    courtName: row.court_code,
    caseNumber: row.case_number,
    region: row.region_norm,
    addressDetail: null,
    usage: row.usage,
    beforePrice: before,
    afterPrice: after,
    failedCount: row.failed_count,
    saleDate: row.next_sale_date,
    sourceUrl: null,
    enrich: null,
  };
}

/** 미발송(또는 재시도 대상) 이벤트를 선별한다. */
export function selectUndelivered(
  store: Store,
  nowISO: string,
  channel: string = DEFAULT_CHANNEL,
): UndeliveredEvent[] {
  const rows = store.query<UndeliveredRow>(UNDELIVERED_SQL, [channel, nowISO]);
  return rows.map((row) => ({
    eventId: row.event_id,
    type: row.type,
    render: toRenderInput(row),
  }));
}

/** 발송 성공 기록. */
export function recordSent(
  store: Store,
  eventId: number,
  nowISO: string,
  channel: string = DEFAULT_CHANNEL,
): void {
  store.upsert('INSERT INTO notifications (event_id, channel, status, sent_at) VALUES (?, ?, ?, ?)', [
    eventId,
    channel,
    'sent',
    nowISO,
  ]);
}

/** 발송 실패 기록(다음 sync 에서 재시도 대상). */
export function recordFailed(
  store: Store,
  eventId: number,
  error: string,
  channel: string = DEFAULT_CHANNEL,
): void {
  store.upsert('INSERT INTO notifications (event_id, channel, status, error) VALUES (?, ?, ?, ?)', [
    eventId,
    channel,
    'failed',
    error,
  ]);
}

/** quiet hours 보류 기록(deliver_after 이후 재선별). */
export function recordHeld(
  store: Store,
  eventId: number,
  deliverAfterISO: string,
  channel: string = DEFAULT_CHANNEL,
): void {
  store.upsert(
    'INSERT INTO notifications (event_id, channel, status, deliver_after) VALUES (?, ?, ?, ?)',
    [eventId, channel, 'held', deliverAfterISO],
  );
}
