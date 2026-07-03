import { describe, expect, it } from 'vitest';
import type { Migration } from '../src/index.js';
import { BUILTIN_MIGRATIONS, runMigrations, SqliteStore } from '../src/index.js';

describe('마이그레이션 러너 (REQ-010)', () => {
  it('내장 마이그레이션(001)을 적용하고 전체 스키마 테이블을 생성한다', () => {
    const store = new SqliteStore(':memory:');
    const applied = runMigrations(store);
    expect(applied).toBe(1);

    const tables = store
      .query<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .map((r) => r.name);

    // 기획서 §6.1 의 핵심 테이블이 모두 존재해야 한다.
    for (const t of [
      'cases',
      'items',
      'schedules',
      'events',
      'watchlists',
      'matches',
      'notifications',
      'rt_trades',
      'sync_runs',
      'raw_snapshots',
      'schema_migrations',
    ]) {
      expect(tables).toContain(t);
    }
    store.close();
  });

  it('events.dedup_key 에 UNIQUE 제약이 걸려 있다 (REQ-015)', () => {
    const store = new SqliteStore(':memory:');
    runMigrations(store);
    const idx = store.query<{ sql: string }>(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='events'",
    );
    expect(idx[0]?.sql).toContain('dedup_key');
    expect(idx[0]?.sql).toContain('UNIQUE');
    store.close();
  });

  it('AC-04: v1 DB 에 v2 마이그레이션 추가 시 자동 적용되고 재시작 시 재적용되지 않는다', () => {
    const store = new SqliteStore(':memory:');
    // 1) v1 만 적용된 기존 DB
    expect(runMigrations(store, BUILTIN_MIGRATIONS)).toBe(1);

    // 2) v2 마이그레이션이 추가된 새 버전으로 시작
    const withV2: Migration[] = [
      ...BUILTIN_MIGRATIONS,
      { version: 2, name: 'add_notes', sql: 'CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT);' },
    ];
    expect(runMigrations(store, withV2)).toBe(1); // v2 만 새로 적용

    const versions = store
      .query<{ version: number }>('SELECT version FROM schema_migrations ORDER BY version')
      .map((r) => r.version);
    expect(versions).toEqual([1, 2]);

    // 3) 재시작(동일 목록 재실행) 시 재적용 없음
    expect(runMigrations(store, withV2)).toBe(0);
    store.close();
  });

  it('마이그레이션은 멱등하다 — 내장 목록 반복 실행 시 추가 적용 0', () => {
    const store = new SqliteStore(':memory:');
    runMigrations(store);
    expect(runMigrations(store)).toBe(0);
    expect(runMigrations(store)).toBe(0);
    store.close();
  });
});
