import { chmodSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Output } from '../output.js';
import { ENV_PREFIX } from './resolve.js';

/**
 * 설정 파일 쓰기. (CLI-REQ-003, AC-06)
 *
 * - 부모 디렉터리를 생성하고 JSON 을 저장한 뒤 권한을 600 으로 강제한다(Windows 는 no-op).
 * - 토큰이 `env:` 참조가 아닌 평문으로 저장되면 경고를 반환·출력한다.
 */

/** 파일 권한 600. */
const SECURE_MODE = 0o600;

/**
 * 임의 데이터를 설정 파일 경로에 저장하고 권한을 600 으로 맞춘다(저수준, 경고 없음).
 *
 * 마이그레이션 재기록·writeConfig 가 공유한다.
 */
export function writeConfigFile(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8' });
  try {
    chmodSync(path, SECURE_MODE);
  } catch {
    // Windows 등 chmod 미지원 플랫폼은 best-effort(no-op). (가정 A2)
  }
}

/** 파일 권한 비트(하위 9비트)를 반환한다. 파일이 없으면 null. */
export function fileMode(path: string): number | null {
  try {
    return statSync(path).mode & 0o777;
  } catch {
    return null;
  }
}

/** writeConfig 결과. */
export interface WriteConfigResult {
  /** 발생한 경고(평문 토큰 등). */
  readonly warnings: string[];
}

/** 값이 `env:` 참조가 아닌 평문 비밀값인지. */
function isPlaintextSecret(value: string): boolean {
  return value.length > 0 && !value.startsWith(ENV_PREFIX);
}

/**
 * 설정을 저장한다. 저장 후 권한 600 을 보장하고, 평문 토큰이면 경고한다.
 *
 * @param path   설정 파일 경로.
 * @param config 저장할 설정 객체(env: 참조는 그대로 보존).
 * @param out    경고를 즉시 출력할 Output(선택).
 */
export function writeConfig(
  path: string,
  config: { telegram: { token: string }; enrich?: { molitKey?: string } },
  out?: Output,
): WriteConfigResult {
  writeConfigFile(path, config);

  const warnings: string[] = [];
  if (isPlaintextSecret(config.telegram.token)) {
    warnings.push(
      '텔레그램 토큰이 평문으로 저장되었습니다. 환경변수 참조(예: env:TG_TOKEN)를 권장합니다.',
    );
  }
  const molitKey = config.enrich?.molitKey;
  if (typeof molitKey === 'string' && isPlaintextSecret(molitKey)) {
    warnings.push('MOLIT 키가 평문으로 저장되었습니다. 환경변수 참조(env:MOLIT_KEY)를 권장합니다.');
  }

  if (out) {
    for (const w of warnings) out.error(`경고: ${w}`);
  }
  return { warnings };
}
