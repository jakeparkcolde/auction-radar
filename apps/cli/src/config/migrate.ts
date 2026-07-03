import { CliError, ExitCode } from '../exit.js';
import { CURRENT_CONFIG_VERSION } from './schema.js';

/**
 * 설정 버전 마이그레이션 사다리. (CLI-REQ-006, AC-08)
 *
 * 구버전 config 를 현재 버전까지 단계적으로 끌어올린다.
 * 적용 경로가 없으면 명확한 업그레이드 안내와 함께 CliError(exit 1)를 던진다.
 */

/** raw 객체를 한 단계(from → from+1) 끌어올리는 변환. */
type StepMigration = (raw: Record<string, unknown>) => Record<string, unknown>;

/**
 * from-버전 → 변환 함수 매핑.
 *
 * 0 → 1: 최초 스키마 도입. version 필드만 부여하고 나머지는 zod 기본값에 위임한다.
 */
const LADDER: Record<number, StepMigration> = {
  0: (raw) => ({ ...raw, version: 1 }),
};

/** migrateConfig 결과. */
export interface MigrationResult {
  readonly raw: Record<string, unknown>;
  /** 마이그레이션이 일어난 경우 원본 버전(없으면 undefined). */
  readonly migratedFrom?: number;
}

/** raw config 의 버전을 읽는다(숫자가 아니면 0 으로 간주). */
function readVersion(raw: Record<string, unknown>): number {
  const v = raw.version;
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * 구버전 config 를 현재 버전으로 마이그레이션한다.
 *
 * @throws CliError(exit 1) — 미래 버전이거나 적용 경로가 없을 때.
 */
export function migrateConfig(raw: Record<string, unknown>): MigrationResult {
  const from = readVersion(raw);

  if (from === CURRENT_CONFIG_VERSION) {
    return { raw };
  }

  if (from > CURRENT_CONFIG_VERSION) {
    throw new CliError(
      `설정 파일 버전(${from})이 이 CLI 지원 버전(${CURRENT_CONFIG_VERSION})보다 높습니다. ` +
        `auction-radar 를 최신 버전으로 업그레이드하세요.`,
      ExitCode.RUNTIME,
    );
  }

  let current = raw;
  for (let v = from; v < CURRENT_CONFIG_VERSION; v += 1) {
    const step = LADDER[v];
    if (step === undefined) {
      throw new CliError(
        `설정 파일 버전(${from})을 자동 마이그레이션할 수 없습니다. ` +
          `문서의 업그레이드 안내를 참고해 config.json 을 수동 갱신하세요.`,
        ExitCode.RUNTIME,
      );
    }
    current = step(current);
  }

  return { raw: current, migratedFrom: from };
}
