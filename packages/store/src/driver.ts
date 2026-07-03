/**
 * 스토어 드라이버 인터페이스.
 *
 * SQLite(기본)와 Supabase(v1.x) 구현이 코드 변경 없이 교체 가능하도록
 * 최소 4개 연산(get/query/upsert/tx)만 노출한다. (SPEC-COLLECTOR-001 REQ-009)
 *
 * 모든 쿼리는 반드시 prepared statement + 바인딩 파라미터로 실행되어야 하며,
 * 문자열 보간으로 SQL을 구성해서는 안 된다. (REQ-011)
 */

/** 바인딩 파라미터: 위치 기반 배열 또는 이름 기반 객체. */
export type SqlParams = readonly unknown[] | Record<string, unknown>;

/** 쓰기 연산 결과. */
export interface RunResult {
  /** 변경된 행 수 (INSERT ... DO NOTHING 으로 무시되면 0). */
  readonly changes: number;
  /** 마지막 INSERT 의 rowid (해당 없으면 0). */
  readonly lastInsertRowid: number;
}

/**
 * 스토어 드라이버.
 *
 * tx 콜백에 전달되는 Store 는 동일 트랜잭션 경계 안에서 동작한다.
 */
export interface Store {
  /** 단일 행 조회 (없으면 undefined). */
  get<Row = Record<string, unknown>>(sql: string, params?: SqlParams): Row | undefined;

  /** 복수 행 조회. */
  query<Row = Record<string, unknown>>(sql: string, params?: SqlParams): Row[];

  /** 쓰기(INSERT/UPDATE/DELETE) 실행. */
  upsert(sql: string, params?: SqlParams): RunResult;

  /**
   * 트랜잭션 실행. 콜백이 예외 없이 반환하면 커밋, 예외가 나면 롤백한다.
   * 콜백은 동일 커넥션의 Store 를 받는다.
   */
  tx<T>(fn: (store: Store) => T): T;

  /** 신뢰된(사용자 입력이 없는) 정적 DDL 스크립트 실행 — 마이그레이션 전용. */
  execScript(sql: string): void;

  /** 커넥션 종료. */
  close(): void;
}
