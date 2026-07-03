import type { Store } from '@auction-radar/store';
import { stateHash } from '../diff/index.js';
import type { BudgetGuard } from '../throttle/BudgetGuard.js';
import type { Throttler } from '../throttle/Throttler.js';
import type { SourceClient } from '../source/SourceClient.js';
import type { CourtCode, ItemState, RawEnvelope, SourceRecord, SourceResponse } from '../types.js';
import { ingestParsed, parseRecord, type ParsedRecord } from './ingest.js';
import { applyRetention, type RetentionOptions } from './retention.js';
import type { SyncLock } from './lockfile.js';

/**
 * sync 오케스트레이션. (REQ-003, 004, 005, 006, 007)
 *
 * warmup → 대상 법원 도출(비면 전체+경고) → 당월/익월 목록 조회 →
 * 신규/변경 의심 공고만 상세 펼치기 → upsert/diff/이벤트 → sync_runs 기록.
 *
 * 차단(ipcheck=false) 감지 시 즉시 중단(자동 재시도·full re-fetch 금지),
 * lockfile 로 동시 sync 를 거부한다.
 */

/** 최소 로거 인터페이스. */
export interface Logger {
  info(message: string): void;
  warn(message: string): void;
}

const NOOP_LOGGER: Logger = { info: () => {}, warn: () => {} };

/** sync 의존성. */
export interface SyncDeps {
  readonly store: Store;
  readonly source: SourceClient;
  readonly throttler: Throttler;
  readonly budget: BudgetGuard;
  readonly lock: SyncLock;
  /** 워치리스트에서 도출된 대상 법원. 비어 있으면 전체 대상 + 경고. */
  readonly watchlistCourts: readonly CourtCode[];
  /** 조회 대상 년월 (당월+익월). 미지정 시 현재 기준 자동 계산. */
  readonly months?: readonly string[];
  /** ISO 시각 소스. */
  readonly now?: () => string;
  readonly logger?: Logger;
  readonly retention?: RetentionOptions;
}

/** sync 실행 결과. */
export interface SyncResult {
  /** lockfile 로 인해 실행이 거부되었는지. */
  readonly rejected: boolean;
  readonly blocked: boolean;
  /** 워치리스트에 법원이 없어 전체 대상으로 스캔했는지. */
  readonly fullScan: boolean;
  readonly callsUsed: number;
  readonly itemsUpserted: number;
  readonly eventsCreated: number;
  readonly warnings: number;
  readonly runId?: number;
}

/** 차단 감지 시 즉시 스택을 빠져나오기 위한 sentinel. */
class BlockedError extends Error {}

/** budget 소진 시 루프를 중단하기 위한 sentinel. */
class BudgetExhausted extends Error {}

/** 현재 기준 당월/익월(YYYYMM)을 계산한다. */
export function currentAndNextMonth(now = new Date()): [string, string] {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-기반
  const cur = `${y}${String(m + 1).padStart(2, '0')}`;
  const nextDate = new Date(Date.UTC(y, m + 1, 1));
  const next = `${nextDate.getUTCFullYear()}${String(nextDate.getUTCMonth() + 1).padStart(2, '0')}`;
  return [cur, next];
}

/** raw_snapshots 저장. */
function saveRaw(store: Store, raw: RawEnvelope, parseOk: 0 | 1, fetchedAt: string): void {
  store.upsert(
    'INSERT INTO raw_snapshots (endpoint, request, response, parse_ok, fetched_at) VALUES (?, ?, ?, ?, ?)',
    [raw.endpoint, JSON.stringify(raw.request), JSON.stringify(raw.response), parseOk, fetchedAt],
  );
}

/** 정의된(undefined 아님) 필드만 병합한다 (상세가 목록을 덮어씀). */
function mergeRecord(base: SourceRecord, override: SourceRecord | null): SourceRecord {
  if (override === null || typeof override !== 'object') return base;
  const merged: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (v !== undefined) merged[k] = v;
  }
  return merged as SourceRecord;
}

/** 상세 펼치기가 필요한지(신규/변경 의심) 판정한다. (REQ-006) */
function shouldExpandDetail(store: Store, parsed: ParsedRecord): boolean {
  const caseRow = store.get<{ id: number }>(
    'SELECT id FROM cases WHERE court_code = ? AND case_number = ?',
    [parsed.court, parsed.caseNumber],
  );
  if (caseRow === undefined) return true; // 신규 사건

  const itemRow = store.get<ItemState & { id: number }>(
    `SELECT id, min_sale_price AS minSalePrice, failed_count AS failedCount,
            next_sale_date AS nextSaleDate, correction_count AS correctionCount,
            cancellation_count AS cancellationCount, status
       FROM items WHERE case_id = ? AND item_no = ?`,
    [caseRow.id, parsed.itemNo],
  );
  if (itemRow === undefined) return true; // 신규 물건

  const prevState: ItemState = {
    itemId: itemRow.id,
    minSalePrice: itemRow.minSalePrice,
    failedCount: itemRow.failedCount,
    nextSaleDate: itemRow.nextSaleDate,
    correctionCount: itemRow.correctionCount,
    cancellationCount: itemRow.cancellationCount,
    status: itemRow.status,
  };
  const nextState: ItemState = {
    itemId: itemRow.id,
    minSalePrice: parsed.minSalePrice,
    failedCount: parsed.failedCount,
    nextSaleDate: parsed.nextSaleDate,
    correctionCount: parsed.correctionCount,
    cancellationCount: parsed.cancellationCount,
    status: parsed.status,
  };
  // state_hash 가 다르면 변경 의심 → 상세 펼치기.
  return stateHash(prevState) !== stateHash(nextState);
}

/**
 * sync 를 실행한다.
 */
export async function runSync(deps: SyncDeps): Promise<SyncResult> {
  const { store, source, throttler, budget, lock } = deps;
  const logger = deps.logger ?? NOOP_LOGGER;
  const nowIso = deps.now ?? (() => new Date().toISOString());

  // 동시 sync 방지. (REQ-007)
  if (!lock.acquire()) {
    logger.warn('이미 실행 중인 sync 가 있습니다 (lockfile 감지). 이번 실행을 건너뜁니다.');
    return {
      rejected: true,
      blocked: false,
      fullScan: false,
      callsUsed: 0,
      itemsUpserted: 0,
      eventsCreated: 0,
      warnings: 0,
    };
  }

  const startedAt = nowIso();
  const runId = store.upsert(
    'INSERT INTO sync_runs (started_at, calls_used, items_upserted, events_created, blocked) VALUES (?, 0, 0, 0, 0)',
    [startedAt],
  ).lastInsertRowid;

  let blocked = false;
  let fullScan = false;
  let itemsUpserted = 0;
  let eventsCreated = 0;
  let warnings = 0;
  let errorMessage: string | null = null;

  /** budget/throttle 를 적용한 소스 호출. 차단/소진 시 sentinel throw. */
  async function guardedCall<T>(fn: () => Promise<SourceResponse<T>>): Promise<SourceResponse<T>> {
    if (!budget.tryConsume()) throw new BudgetExhausted();
    await throttler.wait();
    const res = await fn();
    saveRaw(store, res.raw, 1, nowIso());
    if (res.ipcheck === false) {
      blocked = true;
      throw new BlockedError();
    }
    return res;
  }

  try {
    // 1) warmup
    await guardedCall(() => source.warmup());

    // 2) 대상 법원 도출
    let courts: readonly CourtCode[] = deps.watchlistCourts;
    if (courts.length === 0) {
      fullScan = true;
      warnings += 1;
      logger.warn('워치리스트에 대상 법원이 없어 전체 법원을 대상으로 스캔합니다 (budget 주의).');
      const codesRes = await guardedCall(() => source.fetchCourtCodes());
      courts = codesRes.data;
    }

    const months = deps.months ?? currentAndNextMonth();

    // 3) 법원별 당월+익월 목록 조회 (모든 목록을 먼저 조회한 뒤 상세를 펼친다)
    const pending: { court: CourtCode; rec: SourceRecord; parsed: ParsedRecord }[] = [];
    for (const court of courts) {
      for (const ym of months) {
        const listRes = await guardedCall(() => source.fetchAnnouncementList({ court, yearMonth: ym }));
        const records = Array.isArray(listRes.data) ? listRes.data : [];

        for (const rec of records) {
          const outcome = parseRecord(rec);
          if (!outcome.ok || outcome.parsed === undefined) {
            // 파싱 실패 → skip + raw(parse_ok=0) + 경고 (REQ-016)
            saveRaw(store, { endpoint: 'listAnnouncement', request: { court, ym }, response: rec }, 0, nowIso());
            warnings += 1;
            logger.warn(`레코드 파싱 실패: ${outcome.warning ?? 'unknown'}`);
            continue;
          }
          if (outcome.parsed.usageWarning !== undefined) {
            warnings += 1;
            logger.warn(outcome.parsed.usageWarning);
          }
          pending.push({ court, rec, parsed: outcome.parsed });
        }
      }
    }

    // 4) 신규/변경 의심만 상세 펼치기 → upsert/diff/이벤트 (REQ-004, 006)
    for (const { court, rec, parsed } of pending) {
      let effectiveParsed = parsed;
      if (shouldExpandDetail(store, parsed) && rec.announcementId !== undefined) {
        const detailRes = await guardedCall(() =>
          source.fetchAnnouncementDetail({ court, announcementId: rec.announcementId as string }),
        );
        const merged = parseRecord(mergeRecord(rec, detailRes.data));
        if (!merged.ok || merged.parsed === undefined) {
          saveRaw(store, { endpoint: 'detailAnnouncement', request: { court }, response: detailRes.data }, 0, nowIso());
          warnings += 1;
          continue;
        }
        effectiveParsed = merged.parsed;
      }
      const result = ingestParsed(store, effectiveParsed, nowIso());
      itemsUpserted += 1;
      eventsCreated += result.eventsCreated;
    }
  } catch (err) {
    if (err instanceof BlockedError) {
      // 차단 감지 → 즉시 중단. 자동 재시도·full re-fetch 없음. (REQ-003, 004)
      logger.warn(
        '차단(ipcheck=false)이 감지되어 sync 를 즉시 중단합니다. 약 1시간 후 재시도하세요 (자동 재시도 없음).',
      );
    } else if (err instanceof BudgetExhausted) {
      logger.info('호출 budget 이 소진되어 수집을 중단합니다 (잔량 0).');
    } else {
      errorMessage = err instanceof Error ? err.message : String(err);
      logger.warn(`sync 중 오류: ${errorMessage}`);
    }
  } finally {
    // 6) raw_snapshots 보존 정책 적용 (REQ-017)
    try {
      applyRetention(store, deps.retention ?? {});
    } catch (retErr) {
      logger.warn(`retention 정리 실패: ${retErr instanceof Error ? retErr.message : String(retErr)}`);
    }

    // sync_runs 마감 기록
    store.upsert(
      'UPDATE sync_runs SET finished_at = ?, calls_used = ?, items_upserted = ?, events_created = ?, blocked = ?, error = ? WHERE id = ?',
      [nowIso(), budget.used, itemsUpserted, eventsCreated, blocked ? 1 : 0, errorMessage, runId],
    );

    lock.release();
  }

  return {
    rejected: false,
    blocked,
    fullScan,
    callsUsed: budget.used,
    itemsUpserted,
    eventsCreated,
    warnings,
    runId,
  };
}
