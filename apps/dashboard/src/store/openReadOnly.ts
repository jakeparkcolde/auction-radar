import { SqliteStore } from '@auction-radar/store';
import type { Store } from '@auction-radar/store';

/**
 * 대시보드 전용 읽기 전용 스토어 개방. (SPEC-UI-001 REQ-001, 결정 D1)
 *
 * - SqliteStore 를 readonly 로 열어 쓰기 pragma(WAL/foreign_keys) 를 설정하지 않는다.
 * - 마이그레이션을 실행하지 않는다(읽기 전용 — 스키마 생성 금지).
 * - 스키마 존재 여부를 sqlite_master 로 검증한다. 부재 시 빈 상태로 처리한다(AC-09).
 */

/** 대시보드가 조회하는 핵심 테이블(스키마 존재 판정용). */
const REQUIRED_TABLES = ['items', 'cases', 'events', 'sync_runs'] as const;

/** 읽기 전용 개방 결과. */
export interface ReadOnlyHandle {
  /** 읽기 전용 스토어. */
  readonly store: Store;
  /** 대시보드 조회에 필요한 스키마가 존재하는지. false 면 빈 상태(AC-09). */
  readonly schemaPresent: boolean;
}

/**
 * sqlite_master 에서 대시보드 필수 테이블이 모두 존재하는지 확인한다.
 *
 * @param store 읽기 전용 스토어.
 */
export function verifySchema(store: Store): boolean {
  const rows = store.query<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table'",
  );
  const present = new Set(rows.map((r) => r.name));
  return REQUIRED_TABLES.every((t) => present.has(t));
}

/**
 * DB 파일을 읽기 전용으로 연다.
 *
 * @param dbPath SQLite 파일 경로(존재해야 함).
 * @returns 읽기 전용 스토어 + 스키마 존재 플래그.
 */
export function openReadOnly(dbPath: string): ReadOnlyHandle {
  const store = new SqliteStore(dbPath, undefined, { readonly: true, fileMustExist: true });
  return { store, schemaPresent: verifySchema(store) };
}
