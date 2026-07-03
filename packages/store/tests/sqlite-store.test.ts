import { describe, expect, it } from 'vitest';
import { runMigrations, SqliteStore } from '../src/index.js';

/** 마이그레이션이 적용된 인메모리 스토어를 만든다. */
function freshStore(): SqliteStore {
  const store = new SqliteStore(':memory:');
  runMigrations(store);
  return store;
}

describe('SqliteStore (REQ-009, REQ-011)', () => {
  it('upsert 후 get/query 로 바인딩 파라미터 조회가 동작한다', () => {
    const store = freshStore();
    const res = store.upsert(
      'INSERT INTO cases (court_code, case_number, updated_at) VALUES (?, ?, ?)',
      ['B000280', '2025타경12345', '2026-07-03T00:00:00Z'],
    );
    expect(res.changes).toBe(1);
    expect(res.lastInsertRowid).toBeGreaterThan(0);

    const row = store.get<{ case_number: string }>(
      'SELECT case_number FROM cases WHERE court_code = ?',
      ['B000280'],
    );
    expect(row?.case_number).toBe('2025타경12345');

    const all = store.query<{ id: number }>('SELECT id FROM cases');
    expect(all).toHaveLength(1);
    store.close();
  });

  it('이름 기반 파라미터 객체를 지원한다', () => {
    const store = freshStore();
    store.upsert(
      'INSERT INTO cases (court_code, case_number, updated_at) VALUES (@court, @num, @ts)',
      { court: 'B000210', num: '2025타경1', ts: '2026-07-03T00:00:00Z' },
    );
    const row = store.get<{ court_code: string }>('SELECT court_code FROM cases WHERE case_number = @num', {
      num: '2025타경1',
    });
    expect(row?.court_code).toBe('B000210');
    store.close();
  });

  it('tx 는 예외 발생 시 롤백한다', () => {
    const store = freshStore();
    expect(() =>
      store.tx((s) => {
        s.upsert('INSERT INTO cases (court_code, case_number, updated_at) VALUES (?, ?, ?)', [
          'B1',
          'C1',
          't',
        ]);
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(store.query('SELECT id FROM cases')).toHaveLength(0);
    store.close();
  });

  it('tx 는 정상 반환 시 커밋하고 값을 반환한다', () => {
    const store = freshStore();
    const n = store.tx((s) => {
      s.upsert('INSERT INTO cases (court_code, case_number, updated_at) VALUES (?, ?, ?)', [
        'B2',
        'C2',
        't',
      ]);
      return 42;
    });
    expect(n).toBe(42);
    expect(store.query('SELECT id FROM cases')).toHaveLength(1);
    store.close();
  });

  it('UNIQUE 충돌 시 ON CONFLICT DO NOTHING 은 changes=0 을 반환한다', () => {
    const store = freshStore();
    // events.item_id 외래키를 만족시키기 위해 case/item 을 먼저 생성한다.
    const caseId = store.upsert(
      'INSERT INTO cases (court_code, case_number, updated_at) VALUES (?, ?, ?)',
      ['B1', 'C1', 't'],
    ).lastInsertRowid;
    const itemId = store.upsert(
      'INSERT INTO items (case_id, item_no, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)',
      [caseId, 1, 't', 't'],
    ).lastInsertRowid;

    const sql =
      'INSERT INTO events (item_id, type, payload, dedup_key, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(dedup_key) DO NOTHING';
    const a = store.upsert(sql, [itemId, 'new', '{}', `${itemId}:new`, 't']);
    const b = store.upsert(sql, [itemId, 'new', '{}', `${itemId}:new`, 't']);
    expect(a.changes).toBe(1);
    expect(b.changes).toBe(0);
    store.close();
  });
});
