import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { CliError, ExitCode } from '../exit.js';
import { migrateConfig } from './migrate.js';
import { configSchema, type Config } from './schema.js';
import { writeConfigFile } from './io.js';

/**
 * 설정 로딩. (CLI-REQ-004, 006, AC-08)
 *
 * read → JSON parse → 버전 마이그레이션 → zod 검증 → `env:` 참조 해석.
 * 마이그레이션이 일어나면 갱신된(미해석) 설정을 디스크에 다시 기록해 version 을 올린다.
 */

/** 환경변수 참조 프리픽스. */
export const ENV_PREFIX = 'env:' as const;

/** 값이 `env:` 참조인지. */
export function isEnvRef(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(ENV_PREFIX);
}

/**
 * 객체 트리의 모든 `env:VAR` 문자열을 환경변수 값으로 치환한다(재귀).
 *
 * @throws CliError(exit 1) — 참조한 환경변수가 설정되지 않은 경우.
 */
function resolveEnvDeep(value: unknown, env: NodeJS.ProcessEnv): unknown {
  if (isEnvRef(value)) {
    const name = value.slice(ENV_PREFIX.length);
    const resolved = env[name];
    if (resolved === undefined || resolved.length === 0) {
      throw new CliError(
        `환경변수 ${name} 이(가) 설정되지 않았습니다(설정의 ${value} 참조). ` +
          `해당 환경변수를 지정한 뒤 다시 실행하세요.`,
        ExitCode.RUNTIME,
      );
    }
    return resolved;
  }
  if (Array.isArray(value)) {
    return value.map((v) => resolveEnvDeep(v, env));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = resolveEnvDeep(v, env);
    }
    return out;
  }
  return value;
}

/** 검증된 설정의 `env:` 참조를 해석한 새 설정을 반환한다. */
export function resolveEnvRefs(config: Config, env: NodeJS.ProcessEnv = process.env): Config {
  return resolveEnvDeep(config, env) as Config;
}

/** 기본 설정 파일 경로: `<home>/.auction-radar/config.json`. */
export function defaultConfigPath(home: string): string {
  return join(home, '.auction-radar', 'config.json');
}

/** loadConfig 결과. */
export interface LoadedConfig {
  /** `env:` 참조까지 해석된, 런타임에서 바로 쓰는 설정. */
  readonly config: Config;
  /** 검증되었으나 `env:` 참조는 보존된 설정(마이그레이션/재기록용). */
  readonly raw: Config;
  /** 마이그레이션이 일어난 경우 원본 버전. */
  readonly migratedFrom?: number;
  /** 로드한 파일 경로. */
  readonly path: string;
}

/**
 * 설정 파일을 로드·검증·해석한다.
 *
 * @param path 설정 파일 경로.
 * @param env  환경변수 소스(기본 process.env).
 * @throws CliError(exit 1) — 파일 부재/JSON 오류/스키마 위반/마이그레이션 불가/env 미설정.
 */
export function loadConfig(path: string, env: NodeJS.ProcessEnv = process.env): LoadedConfig {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new CliError(
      `설정 파일을 찾을 수 없습니다: ${path}\n먼저 'auction-radar init' 을 실행하세요.`,
      ExitCode.RUNTIME,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new CliError(
      `설정 파일 JSON 파싱 실패: ${err instanceof Error ? err.message : String(err)}`,
      ExitCode.RUNTIME,
    );
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CliError('설정 파일 형식이 올바르지 않습니다(객체가 아님).', ExitCode.RUNTIME);
  }

  const { raw: migratedRaw, migratedFrom } = migrateConfig(parsed as Record<string, unknown>);

  let validated: Config;
  try {
    validated = configSchema.parse(migratedRaw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      const issues = err.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
      throw new CliError(`설정 파일 스키마 검증 실패:\n${issues}`, ExitCode.RUNTIME);
    }
    throw err;
  }

  // 마이그레이션이 일어났으면 갱신된 설정을 디스크에 재기록해 version 을 올린다.
  if (migratedFrom !== undefined) {
    writeConfigFile(path, validated);
  }

  return {
    config: resolveEnvRefs(validated, env),
    raw: validated,
    ...(migratedFrom !== undefined ? { migratedFrom } : {}),
    path,
  };
}
