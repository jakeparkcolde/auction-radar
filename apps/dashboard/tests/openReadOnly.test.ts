import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteStore } from '@auction-radar/store';
import { openReadOnly, verifySchema } from '../src/store/openReadOnly.js';
import { makeTempDb, seedFull } from './helpers.js';

describe('openReadOnly (REQ-001, 결정 D1)', () => {
  const dbs: { cleanup(): void }[] = [];
  afterEach(() => {
    for (const d of dbs) d.cleanup();
    dbs.length = 0;
  });

  it('마이그레이션된 DB 를 읽기 전용으로 열고 스키마 존재를 확인한다', () => {
    const db = makeTempDb(seedFull);
    dbs.push(db);
    const { store, schemaPresent } = openReadOnly(db.path);
    expect(schemaPresent).toBe(true);
    const rows = store.query<{ n: number }>('SELECT COUNT(*) AS n FROM items');
    expect(rows[0]?.n).toBe(3);
    store.close();
  });

  it('읽기 전용 스토어는 쓰기를 거부한다', () => {
    const db = makeTempDb(seedFull);
    dbs.push(db);
    const { store } = openReadOnly(db.path);
    expect(() =>
      store.upsert('INSERT INTO watchlists (name, config, created_at) VALUES (?, ?, ?)', [
        'x',
        '{}',
        '2026-01-01',
      ]),
    ).toThrow();
    store.close();
  });

  it('스키마 없는 빈 파일은 schemaPresent=false (AC-09)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ar-dash-empty-'));
    const path = join(dir, 'blank.db');
    // 빈 파일 생성(마이그레이션 없음).
    new SqliteStore(path).close();
    dbs.push({ cleanup: () => rmSync(dir, { recursive: true, force: true }) });

    const { schemaPresent } = openReadOnly(path);
    expect(schemaPresent).toBe(false);
  });

  it('verifySchema 는 필수 테이블이 모두 있어야 true', () => {
    const db = makeTempDb(seedFull);
    dbs.push(db);
    const { store } = openReadOnly(db.path);
    expect(verifySchema(store)).toBe(true);
    store.close();
  });
});
