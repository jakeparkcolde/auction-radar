import Database from 'better-sqlite3';
import type { Database as DatabaseInstance, Statement } from 'better-sqlite3';
import type { RunResult, SqlParams, Store } from '../driver.js';

/**
 * SqliteStore 개방 옵션. (SPEC-UI-001 결정 D1)
 *
 * 읽기 전용 소비자(대시보드)가 쓰기 pragma 없이 기존 DB 파일을 열 수 있게 한다.
 * 기본값(미지정)은 기존 읽기·쓰기 동작을 그대로 유지한다(하위 호환).
 */
export interface SqliteStoreOptions {
  /** true 면 SQLITE_OPEN_READONLY 로 개방한다(쓰기 pragma 생략). */
  readonly readonly?: boolean;
  /** true 면 파일이 없을 때 새로 만들지 않고 예외를 던진다(읽기 전용에서 기본 true). */
  readonly fileMustExist?: boolean;
}

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
  /** 읽기 전용 개방 여부. 쓰기 API 호출 시 방어에 사용한다. (결정 D1) */
  private readonly isReadonly: boolean;

  /**
   * @param filename 파일 경로 또는 ':memory:' (기본: 인메모리)
   * @param existingDb 트랜잭션 재진입 시 동일 커넥션 공유용 (내부 사용)
   * @param options 개방 옵션(읽기 전용 등). 미지정 시 기존 읽기·쓰기 동작 유지.
   */
  constructor(filename = ':memory:', existingDb?: DatabaseInstance, options?: SqliteStoreOptions) {
    this.isReadonly = options?.readonly === true;
    if (existingDb) {
      // 트랜잭션 재진입 — 동일 커넥션 공유(쓰기 pragma 재설정 금지).
      this.db = existingDb;
    } else if (this.isReadonly) {
      // 읽기 전용 개방: WAL/foreign_keys 쓰기 pragma 를 설정하지 않는다(읽기 전용 커넥션에서 실패). (결정 D1)
      this.db = new Database(filename, {
        readonly: true,
        fileMustExist: options?.fileMustExist ?? true,
      });
    } else {
      this.db = new Database(filename);
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
