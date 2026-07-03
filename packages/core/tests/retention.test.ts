import { runMigrations, SqliteStore } from '@auction-radar/store';
import { describe, expect, it } from 'vitest';
import { applyRetention } from '../src/sync/retention.js';

function freshStore(): SqliteStore {
  const store = new SqliteStore(':memory:');
  runMigrations(store);
  return store;
}

function insertRaw(store: SqliteStore, parseOk: 0 | 1, fetchedAt: string): void {
  store.upsert(
    'INSERT INTO raw_snapshots (endpoint, request, response, parse_ok, fetched_at) VALUES (?, ?, ?, ?, ?)',
    ['listAnnouncement', '{}', '{}', parseOk, fetchedAt],
  );
}

describe('raw_snapshots retention (REQ-017, AC-11)', () => {
  it('parse_ok=0 스냅샷 250건 중 최신 200건만 유지된다', () => {
    const store = freshStore();
    for (let i = 0; i < 250; i += 1) {
      insertRaw(store, 0, '2026-07-01T00:00:00Z');
    }
    const res = applyRetention(store, { parseFailKeep: 200 });
    expect(res.deletedParseFail).toBe(50);

    const remaining = store.get<{ n: number }>(
      'SELECT count(*) AS n FROM raw_snapshots WHERE parse_ok = 0',
    );
    expect(remaining?.n).toBe(200);

    // 가장 오래된 50건(작은 id)이 삭제되고 최신 200건이 남는다.
    const minId = store.get<{ m: number }>('SELECT min(id) AS m FROM raw_snapshots');
    expect(minId?.m).toBe(51);
    store.close();
  });

  it('parse_ok=1 스냅샷은 30일 초과분만 삭제한다', () => {
    const store = freshStore();
    const now = new Date('2026-07-31T00:00:00Z');
    // 오래된 것(60일 전) 3건 + 최근(1일 전) 2건
    insertRaw(store, 1, '2026-06-01T00:00:00Z');
    insertRaw(store, 1, '2026-06-01T00:00:00Z');
    insertRaw(store, 1, '2026-06-01T00:00:00Z');
    insertRaw(store, 1, '2026-07-30T00:00:00Z');
    insertRaw(store, 1, '2026-07-30T00:00:00Z');

    const res = applyRetention(store, { parseOkDays: 30, now });
    expect(res.deletedParseOk).toBe(3);

    const remaining = store.get<{ n: number }>(
      'SELECT count(*) AS n FROM raw_snapshots WHERE parse_ok = 1',
    );
    expect(remaining?.n).toBe(2);
    store.close();
  });
});
