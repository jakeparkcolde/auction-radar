import { ingestParsed, parseRecord } from '@auction-radar/core';
import type { SourceRecord } from '@auction-radar/core';
import { BUILTIN_MIGRATIONS, runMigrations, SqliteStore } from '@auction-radar/store';
import { ALERT_MIGRATIONS } from '../src/index.js';
import type { WatchlistConfig } from '../src/index.js';

/** 테스트 고정 시각(ISO). */
export const NOW = '2026-07-03T00:00:00Z';

/** store + 001 + alert(002) 마이그레이션이 적용된 인메모리 스토어. */
export function freshStore(): SqliteStore {
  const store = new SqliteStore(':memory:');
  runMigrations(store, [...BUILTIN_MIGRATIONS, ...ALERT_MIGRATIONS]);
  return store;
}

/** SourceRecord 를 ingest 하고 itemId 를 반환한다. */
export function ingest(store: SqliteStore, rec: SourceRecord, now: string = NOW): number {
  const parsed = parseRecord(rec);
  if (!parsed.ok || parsed.parsed === undefined) {
    throw new Error(`parse fail: ${parsed.warning ?? 'unknown'}`);
  }
  return ingestParsed(store, parsed.parsed, now).itemId;
}

/** 워치리스트를 삽입하고 id 를 반환한다. */
export function addWatchlist(store: SqliteStore, config: WatchlistConfig, now: string = NOW): number {
  const res = store.upsert(
    'INSERT INTO watchlists (name, config, enabled, created_at) VALUES (?, ?, 1, ?)',
    [config.name ?? 'wl', JSON.stringify(config), now],
  );
  return res.lastInsertRowid;
}

/** 기준 물건 레코드(인천 서구 아파트). */
export function baseRecord(n: number): SourceRecord {
  return {
    court: 'B000280',
    caseNumber: `2025타경3000${String(n).padStart(2, '0')}`,
    itemNo: 1,
    usage: '아파트',
    addressRaw: '인천광역시 서구 청라동',
    appraisedPrice: 400000000,
    minSalePrice: 320000000,
    failedCount: 0,
    status: '진행중',
    nextSaleDate: '2026-07-28',
    announcementId: `A-3000${n}`,
  };
}

/** 특정 물건의 특정 종류 이벤트 id 를 조회한다. */
export function eventIdOf(store: SqliteStore, itemId: number, type: string): number {
  const row = store.get<{ id: number }>('SELECT id FROM events WHERE item_id = ? AND type = ?', [
    itemId,
    type,
  ]);
  if (row === undefined) throw new Error(`no ${type} event for item ${itemId}`);
  return row.id;
}
