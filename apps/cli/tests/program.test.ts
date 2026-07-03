import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { Command } from 'commander';
import type { Store } from '@auction-radar/store';
import { buildProgram, runCli } from '../src/program.js';
import { ExitCode } from '../src/exit.js';
import {
  addWatchlistDb,
  baseRecord,
  ingest,
  makeConfig,
  makeDeps,
  makeHomeDir,
  makeStore,
} from './helpers.js';

const homes: string[] = [];
afterEach(() => {
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});
function tmpDir(): string {
  const h = makeHomeDir();
  homes.push(h);
  return h;
}

/** 매칭 2건이 준비된 스토어. */
function seededStore(): Store {
  const store = makeStore();
  for (let n = 1; n <= 2; n += 1) ingest(store, baseRecord(n));
  addWatchlistDb(store, { name: 'wl', courts: ['B000280'], usages: ['아파트'], notify: ['new'] });
  return store;
}

describe('종료 코드 규약 (§4)', () => {
  it('성공 → 0 (sync --dry-run)', async () => {
    const { deps } = makeDeps({ store: seededStore() });
    const code = await runCli(deps, ['sync', '--dry-run']);
    expect(code).toBe(ExitCode.OK);
  });

  it('알 수 없는 명령 → 2 (usage)', async () => {
    const { deps } = makeDeps();
    const code = await runCli(deps, ['definitely-not-a-command']);
    expect(code).toBe(ExitCode.USAGE);
  });

  it('필수 인자 누락 → 2 (usage)', async () => {
    const { deps } = makeDeps({ store: seededStore() });
    const code = await runCli(deps, ['case']);
    expect(code).toBe(ExitCode.USAGE);
  });

  it('--help → 0', async () => {
    const { deps } = makeDeps();
    const code = await runCli(deps, ['--help']);
    expect(code).toBe(ExitCode.OK);
  });

  it('런타임 오류(없는 워치리스트 삭제) → 1', async () => {
    const { deps, out } = makeDeps({ store: seededStore() });
    const code = await runCli(deps, ['watch', 'rm', '없는이름']);
    expect(code).toBe(ExitCode.RUNTIME);
    expect(out.stderr.length).toBeGreaterThan(0);
  });
});

describe('program 커맨드 배선 (통합)', () => {
  it('watch list / case / doctor / schedule install 을 실행한다', async () => {
    const store = seededStore();
    const { deps, out } = makeDeps({ store, platform: 'linux' });

    expect(await runCli(deps, ['watch', 'list'])).toBe(ExitCode.OK);
    expect(await runCli(deps, ['case', 'B000280', '2025타경30001'])).toBe(ExitCode.OK);
    expect(await runCli(deps, ['doctor'])).toBe(ExitCode.OK);
    expect(await runCli(deps, ['schedule', 'install'])).toBe(ExitCode.OK);
    expect(out.stdout).toContain('crontab');
    store.close();
  });

  it('export 는 파일 경로로 내보낸다', async () => {
    const store = seededStore();
    // 매칭을 채우기 위해 dry-run sync 로 matchEvents 를 유발.
    const { deps } = makeDeps({ store });
    await runCli(deps, ['sync', '--dry-run']);
    const path = join(tmpDir(), 'out.xlsx');
    const code = await runCli(deps, ['export', '--xlsx', '--out', path]);
    expect(code).toBe(ExitCode.OK);
    expect(readFileSync(path).length).toBeGreaterThan(0);
    store.close();
  });

  it('init 을 실행해 설정을 만든다', async () => {
    const home = tmpDir();
    const { deps } = makeDeps({
      config: makeConfig(),
      homeDir: home,
      env: { TG_TOKEN: 'real-token' },
    });
    const code = await runCli(deps, ['init']);
    expect(code).toBe(ExitCode.OK);
  });
});

/** 커맨드 트리를 재귀적으로 수집한다. */
function collectCommands(cmd: Command): Command[] {
  const acc: Command[] = [];
  for (const sub of cmd.commands) {
    acc.push(sub, ...collectCommands(sub));
  }
  return acc;
}

/** src 트리의 모든 .ts 파일 경로. */
function srcFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) files.push(...srcFiles(full));
    else if (e.name.endsWith('.ts')) files.push(full);
  }
  return files;
}

describe('CLI-REQ-010: 입찰 자동화 부재(음성 게이트)', () => {
  const FORBIDDEN = ['자동제출', '자동 제출', '입찰서', 'auto-submit', 'autosubmit', 'autobid', 'submitbid', 'placebid'];

  it('입찰 관련 명령/별칭/플래그가 존재하지 않는다', () => {
    const { deps } = makeDeps();
    const program = buildProgram(deps);
    const commands = collectCommands(program);

    // 허용된 7개 명령만 존재(+watch/schedule 하위).
    const topLevel = program.commands.map((c) => c.name()).sort();
    expect(topLevel).toEqual(['case', 'doctor', 'export', 'init', 'schedule', 'sync', 'watch']);

    for (const c of commands) {
      const names = [c.name(), ...c.aliases()].join(' ').toLowerCase();
      expect(/bid|입찰|submit|자동제출/.test(names)).toBe(false);
      for (const opt of c.options) {
        expect(/bid|입찰|submit|자동제출/i.test(opt.flags)).toBe(false);
      }
    }
  });

  it('소스 트리에 입찰 자동화 토큰이 없다', () => {
    const srcDir = fileURLToPath(new URL('../src', import.meta.url));
    const files = srcFiles(srcDir);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(file, 'utf8').toLowerCase();
      for (const token of FORBIDDEN) {
        expect(text.includes(token.toLowerCase()), `${file} contains "${token}"`).toBe(false);
      }
    }
  });
});
