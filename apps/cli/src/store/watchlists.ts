import type { Store } from '@auction-radar/store';
import type { WatchlistConfig } from '@auction-radar/alert';
import type { WatchlistEntry } from '../config/schema.js';

/**
 * 워치리스트 DB 접근 헬퍼. (CLI-REQ-008 및 sync 코스 도출)
 *
 * DB `watchlists` 테이블이 매칭의 런타임 소스이며(ALERT matchEvents 계약),
 * config.watchlists 는 첫 sync 시 seed 로만 사용한다.
 */

/** DB 워치리스트 행. */
export interface WatchlistRow {
  readonly id: number;
  readonly name: string;
  readonly config: WatchlistConfig;
  readonly enabled: boolean;
}

interface RawRow {
  readonly id: number;
  readonly name: string;
  readonly config: string;
  readonly enabled: number;
}

/** enabled 여부와 무관하게 전체 워치리스트를 조회한다. */
export function listWatchlists(store: Store): WatchlistRow[] {
  const rows = store.query<RawRow>('SELECT id, name, config, enabled FROM watchlists ORDER BY id');
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    config: JSON.parse(r.config) as WatchlistConfig,
    enabled: r.enabled === 1,
  }));
}

/** 이름으로 워치리스트 1건을 조회한다(없으면 undefined). */
export function getWatchlistByName(store: Store, name: string): WatchlistRow | undefined {
  const r = store.get<RawRow>(
    'SELECT id, name, config, enabled FROM watchlists WHERE name = ? ORDER BY id LIMIT 1',
    [name],
  );
  if (r === undefined) return undefined;
  return { id: r.id, name: r.name, config: JSON.parse(r.config) as WatchlistConfig, enabled: r.enabled === 1 };
}

/** 워치리스트를 추가하고 id 를 반환한다. */
export function addWatchlistRow(store: Store, entry: WatchlistEntry, now: string): number {
  const name = entry.name ?? '내 조건';
  const res = store.upsert(
    'INSERT INTO watchlists (name, config, enabled, created_at) VALUES (?, ?, 1, ?)',
    [name, JSON.stringify(entry), now],
  );
  return res.lastInsertRowid;
}

/** 이름이 일치하는 워치리스트를 삭제하고 삭제 건수를 반환한다. */
export function removeWatchlistByName(store: Store, name: string): number {
  return store.upsert('DELETE FROM watchlists WHERE name = ?', [name]).changes;
}

/**
 * config.watchlists 항목 중 DB 에 이름이 없는 것만 seed 한다(멱등, 첫 sync 편의).
 *
 * @returns seed 된 건수.
 */
export function seedWatchlists(store: Store, entries: readonly WatchlistEntry[], now: string): number {
  let seeded = 0;
  for (const entry of entries) {
    const name = entry.name ?? '내 조건';
    const existing = store.get<{ id: number }>('SELECT id FROM watchlists WHERE name = ? LIMIT 1', [name]);
    if (existing === undefined) {
      addWatchlistRow(store, entry, now);
      seeded += 1;
    }
  }
  return seeded;
}

/** enabled 워치리스트들의 법원 코드 합집합을 도출한다(sync 코스). */
export function deriveWatchlistCourts(store: Store): string[] {
  const rows = listWatchlists(store).filter((w) => w.enabled);
  const set = new Set<string>();
  for (const w of rows) {
    for (const c of w.config.courts ?? []) set.add(c);
  }
  return [...set];
}
