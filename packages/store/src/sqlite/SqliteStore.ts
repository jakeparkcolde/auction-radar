import Database from 'better-sqlite3';
import type { Database as DatabaseInstance, Statement } from 'better-sqlite3';
import type { RunResult, SqlParams, Store } from '../driver.js';

/**
 * better-sqlite3 기반 Store 구현.
 *
 * - 모든 쿼리는 prepared statement 로 실행하며, 준비된 statement 를 SQL 문자열
 *   기준으로 캐시해 재사용한다. (REQ-011)
 * - 파라미터는 항상 바인딩으로 전달하고 문자열 보간을 사용하지 않는다.
 */
export class SqliteStore implements Store {
  private readonly db: DatabaseInstance;
  private readonly stmtCache = new Map<string, Statement>();

  /**
   * @param filename 파일 경로 또는 ':memory:' (기본: 인메모리)
   * @param existingDb 트랜잭션 재진입 시 동일 커넥션 공유용 (내부 사용)
   */
  constructor(filename = ':memory:', existingDb?: DatabaseInstance) {
    this.db = existingDb ?? new Database(filename);
    if (!existingDb) {
      // 외래키 제약과 WAL 은 스토어 기본값으로 활성화한다.
      this.db.pragma('foreign_keys = ON');
      this.db.pragma('journal_mode = WAL');
    }
  }

  private prepare(sql: string): Statement {
    let stmt = this.stmtCache.get(sql);
    if (stmt === undefined) {
      stmt = this.db.prepare(sql);
      this.stmtCache.set(sql, stmt);
    }
    return stmt;
  }

  /** 위치/이름 파라미터를 better-sqlite3 호출 형태로 바인딩한다. */
  private bindArgs(params?: SqlParams): unknown[] {
    if (params === undefined) return [];
    if (Array.isArray(params)) return [...params];
    // 이름 기반 파라미터 객체는 단일 인자로 전달한다.
    return [params as Record<string, unknown>];
  }

  get<Row = Record<string, unknown>>(sql: string, params?: SqlParams): Row | undefined {
    const stmt = this.prepare(sql);
    return stmt.get(...this.bindArgs(params)) as Row | undefined;
  }

  query<Row = Record<string, unknown>>(sql: string, params?: SqlParams): Row[] {
    const stmt = this.prepare(sql);
    return stmt.all(...this.bindArgs(params)) as Row[];
  }

  upsert(sql: string, params?: SqlParams): RunResult {
    const stmt = this.prepare(sql);
    const info = stmt.run(...this.bindArgs(params));
    return {
      changes: info.changes,
      lastInsertRowid: Number(info.lastInsertRowid),
    };
  }

  tx<T>(fn: (store: Store) => T): T {
    // 동일 커넥션을 공유하는 Store 를 콜백에 전달한다.
    const scoped = new SqliteStore(':memory:', this.db);
    const runner = this.db.transaction(() => fn(scoped));
    return runner();
  }

  execScript(sql: string): void {
    // 정적 DDL 스크립트(마이그레이션 파일) 전용. 사용자 입력을 포함하지 않는다.
    this.db.exec(sql);
  }

  close(): void {
    this.stmtCache.clear();
    this.db.close();
  }
}
