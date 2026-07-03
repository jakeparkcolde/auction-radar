import type { Migration } from '@auction-radar/store';

/**
 * alert 패키지 소유 마이그레이션. (SPEC-ALERT-001 D2)
 *
 * notifications 테이블에 `deliver_after`(quiet hours 보류 재발송 가능 시각)를 추가한다.
 * `held` 상태는 status 가 평문 TEXT 이므로 별도 스키마 변경이 필요 없다.
 *
 * NOTE: store 의 BUILTIN_MIGRATIONS 에 등록하지 않고 alert 가 소유한다.
 * 등록 시 store 의 migrations.test.ts(내장 적용 수 == 1 단정)가 깨지므로,
 * COLLECTOR 테스트 보존(never-break)을 위해 조합형으로 분리한다.
 * 앱(CLI)은 `runMigrations(store, [...BUILTIN_MIGRATIONS, ...ALERT_MIGRATIONS])` 로 적용한다.
 */
export const ALERT_MIGRATIONS: readonly Migration[] = [
  {
    version: 2,
    name: 'alert',
    sql: `ALTER TABLE notifications ADD COLUMN deliver_after TEXT;`,
  },
];
