import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Store } from '../driver.js';

const here = dirname(fileURLToPath(import.meta.url));

/** 단일 forward-only 마이그레이션. */
export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

/** 정적 .sql 파일을 읽어 마이그레이션 문자열로 로드한다. */
function loadSql(file: string): string {
  return readFileSync(join(here, file), 'utf8');
}

/** 내장 마이그레이션 목록 (버전 오름차순). */
export const BUILTIN_MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'init', sql: loadSql('001_init.sql') },
];

/** schema_migrations 테이블을 보장한다. */
function ensureMigrationsTable(store: Store): void {
  store.execScript(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version    INTEGER PRIMARY KEY,
       name       TEXT NOT NULL,
       applied_at TEXT NOT NULL
     );`,
  );
}

/** 이미 적용된 버전 집합을 반환한다. */
function appliedVersions(store: Store): Set<number> {
  const rows = store.query<{ version: number }>('SELECT version FROM schema_migrations');
  return new Set(rows.map((r) => r.version));
}

/**
 * 필요한 마이그레이션을 순차 적용한다. (REQ-010)
 *
 * - 앱 시작 시 호출. 이미 적용된 버전은 건너뛴다(멱등).
 * - 각 마이그레이션은 개별 트랜잭션으로 적용하고 schema_migrations 에 기록한다.
 *
 * @returns 이번 호출에서 새로 적용한 마이그레이션 수
 */
export function runMigrations(
  store: Store,
  migrations: readonly Migration[] = BUILTIN_MIGRATIONS,
  now: () => string = () => new Date().toISOString(),
): number {
  ensureMigrationsTable(store);
  const done = appliedVersions(store);
  const pending = [...migrations].filter((m) => !done.has(m.version)).sort((a, b) => a.version - b.version);

  for (const migration of pending) {
    store.tx((s) => {
      s.execScript(migration.sql);
      s.upsert('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)', [
        migration.version,
        migration.name,
        now(),
      ]);
    });
  }
  return pending.length;
}
