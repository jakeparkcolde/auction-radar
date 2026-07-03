import { BUILTIN_MIGRATIONS, runMigrations, SqliteStore } from '@auction-radar/store';
import { ALERT_MIGRATIONS } from '@auction-radar/alert';
import type { Store } from '@auction-radar/store';

/**
 * 스토어 개방 + 마이그레이션의 단일 조합 지점. (CLI 소유)
 *
 * store 의 BUILTIN 과 alert 소유 ALERT_MIGRATIONS 를 여기 한 곳에서만 조합한다.
 * (ALERT_MIGRATIONS 는 store BUILTIN 에 등록하면 store 테스트가 깨지므로 앱이 조합한다 —
 *  packages/alert/src/migrations.ts 주석 참조.)
 *
 * @param path SQLite 파일 경로 또는 ':memory:'.
 * @returns 마이그레이션이 모두 적용된 Store.
 */
export function openStore(path: string): Store {
  const store = new SqliteStore(path);
  runMigrations(store, [...BUILTIN_MIGRATIONS, ...ALERT_MIGRATIONS]);
  return store;
}
