import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BUILTIN_MIGRATIONS, runMigrations, SqliteStore } from '../src/index.js';

/**
 * SqliteStore 읽기 전용 개방 옵션 특성 테스트. (SPEC-UI-001 결정 D1)
 *
 * - 기본(RW) 동작이 변하지 않았는지 회귀 방지(characterization).
 * - 읽기 전용 개방 시 쓰기 시도가 거부되는지 확인.
 */
describe('SqliteStore 읽기 전용 옵션 (결정 D1)', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ar-store-ro-'));
    dbPath = join(dir, 'test.db');
    // 시드: RW 로 개방 → 마이그레이션 → 데이터 → close(마지막 커넥션 checkpoint).
    const seed = new SqliteStore(dbPath);
    runMigrations(seed, [...BUILTIN_MIGRATIONS]);
    seed.upsert('INSERT INTO cases (court_code, case_number, updated_at) VALUES (?, ?, ?)', [
      'B000210',
      '2025타경1',
      '2026-07-01T00:00:00Z',
    ]);
    seed.close();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('characterization: 기본(옵션 미지정) 개방은 기존 RW 동작(WAL·foreign_keys)을 유지한다', () => {
    const store = new SqliteStore(dbPath);
    const journal = store.get<{ journal_mode: string }>('PRAGMA journal_mode');
    const fk = store.get<{ foreign_keys: number }>('PRAGMA foreign_keys');
    expect(journal?.journal_mode?.toLowerCase()).toBe('wal');
    expect(fk?.foreign_keys).toBe(1);
    // 쓰기가 정상 동작한다(기존 계약).
    const res = store.upsert(
      'INSERT INTO cases (court_code, case_number, updated_at) VALUES (?, ?, ?)',
      ['B000210', '2025타경2', '2026-07-01T00:00:00Z'],
    );
    expect(res.changes).toBe(1);
    store.close();
  });

  it('읽기 전용 개방은 데이터를 읽을 수 있다', () => {
    const store = new SqliteStore(dbPath, undefined, { readonly: true });
    const rows = store.query<{ case_number: string }>('SELECT case_number FROM cases');
    expect(rows.map((r) => r.case_number)).toContain('2025타경1');
    store.close();
  });

  it('읽기 전용 개방은 쓰기 시도를 거부한다', () => {
    const store = new SqliteStore(dbPath, undefined, { readonly: true });
    expect(() =>
      store.upsert('INSERT INTO cases (court_code, case_number, updated_at) VALUES (?, ?, ?)', [
        'B000210',
        '2025타경X',
        '2026-07-01T00:00:00Z',
      ]),
    ).toThrow();
    store.close();
  });

  it('fileMustExist 기본값으로 존재하지 않는 파일 읽기 전용 개방은 예외', () => {
    const missing = join(dir, 'nope.db');
    expect(() => new SqliteStore(missing, undefined, { readonly: true })).toThrow();
  });
});
