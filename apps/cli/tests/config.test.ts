import { readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BufferOutput } from '../src/output.js';
import { CliError } from '../src/exit.js';
import { fileMode, writeConfig } from '../src/config/io.js';
import { defaultConfigPath, loadConfig } from '../src/config/resolve.js';
import { makeConfig, makeHomeDir } from './helpers.js';

const homes: string[] = [];
function home(): string {
  const h = makeHomeDir();
  homes.push(h);
  return h;
}

afterEach(() => {
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});

/** 임의 객체를 설정 경로에 직접 기록한다(테스트 픽스처). */
function writeRaw(path: string, obj: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(obj, null, 2), 'utf8');
}

describe('AC-06: writeConfig — 권한 600 + 평문 토큰 경고', () => {
  it('평문 토큰은 경고하고 파일 권한을 600 으로 강제한다', () => {
    const path = defaultConfigPath(home());
    const out = new BufferOutput();
    const { warnings } = writeConfig(path, makeConfig({ telegram: { token: '123:PLAIN', chatId: '1' } }), out);

    expect(fileMode(path)).toBe(0o600);
    expect(warnings.some((w) => w.includes('평문'))).toBe(true);
    expect(out.stderr).toContain('env:TG_TOKEN');
  });

  it('env: 참조 토큰은 평문 경고를 내지 않는다', () => {
    const path = defaultConfigPath(home());
    const { warnings } = writeConfig(path, makeConfig({ telegram: { token: 'env:TG_TOKEN', chatId: '1' } }));
    expect(fileMode(path)).toBe(0o600);
    expect(warnings).toHaveLength(0);
  });
});

describe('loadConfig — 검증 + env 해석', () => {
  it('유효 설정을 로드하고 env: 참조를 해석한다', () => {
    const path = defaultConfigPath(home());
    writeRaw(path, makeConfig({ telegram: { token: 'env:TG_TOKEN', chatId: '123' } }));

    const loaded = loadConfig(path, { TG_TOKEN: 'real-secret-token' });
    expect(loaded.config.telegram.token).toBe('real-secret-token');
    // raw 는 env: 참조를 보존한다.
    expect(loaded.raw.telegram.token).toBe('env:TG_TOKEN');
  });

  it('참조한 환경변수가 없으면 CliError(exit 1)', () => {
    const path = defaultConfigPath(home());
    writeRaw(path, makeConfig({ telegram: { token: 'env:MISSING', chatId: '1' } }));
    expect(() => loadConfig(path, {})).toThrow(CliError);
  });

  it('파일이 없으면 CliError(exit 1)', () => {
    const path = defaultConfigPath(home());
    try {
      loadConfig(path, {});
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).exitCode).toBe(1);
      expect((err as CliError).message).toContain('init');
    }
  });

  it('스키마 위반이면 CliError(exit 1)', () => {
    const path = defaultConfigPath(home());
    writeRaw(path, { version: 1, telegram: { token: 'x' } }); // chatId·store 누락
    expect(() => loadConfig(path, {})).toThrow(CliError);
  });
});

describe('AC-08: 구버전 config 마이그레이션', () => {
  it('version 0 → 1 로 마이그레이션하고 파일을 재기록한다(권한 600)', () => {
    const path = defaultConfigPath(home());
    writeRaw(path, makeConfig({ version: 0 }));

    const loaded = loadConfig(path, {});
    expect(loaded.migratedFrom).toBe(0);
    expect(loaded.config.version).toBe(1);

    // 디스크에 version 1 로 재기록 + 권한 600.
    const persisted = JSON.parse(readFileSync(path, 'utf8')) as { version: number };
    expect(persisted.version).toBe(1);
    expect(fileMode(path)).toBe(0o600);
  });

  it('미래 버전은 CliError(exit 1) 로 업그레이드를 안내한다', () => {
    const path = defaultConfigPath(home());
    writeRaw(path, makeConfig({ version: 999 }));
    try {
      loadConfig(path, {});
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).exitCode).toBe(1);
      expect((err as CliError).message).toContain('업그레이드');
    }
  });
});
