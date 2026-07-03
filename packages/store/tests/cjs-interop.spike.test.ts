import { describe, expect, it } from 'vitest';

/**
 * T001 CJS 상호운용 스파이크.
 *
 * ESM(NodeNext) 패키지에서 네이티브 CJS 모듈인 better-sqlite3 를
 * default import 로 불러와 실제로 동작하는지 확인한다.
 * (모노레포 툴체인이 ESM↔CJS 경계를 넘을 수 있음을 보장)
 */
describe('CJS interop spike: better-sqlite3 in ESM', () => {
  it('better-sqlite3 를 default import 하고 인메모리 쿼리를 실행한다', async () => {
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(':memory:');
    try {
      db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
      const insert = db.prepare('INSERT INTO t (v) VALUES (?)');
      const info = insert.run('hello');
      expect(info.changes).toBe(1);

      const row = db.prepare('SELECT v FROM t WHERE id = ?').get(Number(info.lastInsertRowid)) as {
        v: string;
      };
      expect(row.v).toBe('hello');
    } finally {
      db.close();
    }
  });
});
