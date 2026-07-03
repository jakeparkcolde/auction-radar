import { rmSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DISCLAIMER, startMockTelegramServer } from '@auction-radar/alert';
import type { MockTelegramServer } from '@auction-radar/alert';
import { runInitWizard } from '../src/commands/init.js';
import type { InitDeps } from '../src/commands/init.js';
import { CliError } from '../src/exit.js';
import { fileMode } from '../src/config/io.js';
import { defaultConfigPath } from '../src/config/resolve.js';
import { BufferOutput } from '../src/output.js';
import {
  cannedTgVerify,
  makeHomeDir,
  mockNotifier,
  NO_WAIT_CLOCK,
  NOW,
  scriptedPrompts,
} from './helpers.js';

let server: MockTelegramServer;
const homes: string[] = [];

beforeEach(async () => {
  server = await startMockTelegramServer();
});

afterEach(async () => {
  await server.close();
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});

function homeDir(): string {
  const h = makeHomeDir();
  homes.push(h);
  return h;
}

function initDeps(overrides: Partial<InitDeps> & { home?: string } = {}): InitDeps {
  const home = overrides.home ?? homeDir();
  return {
    prompts: overrides.prompts ?? scriptedPrompts(),
    createTgVerify:
      overrides.createTgVerify ?? (() => cannedTgVerify({ updates: { ok: true, chatIds: ['12345678'] } })),
    createNotifier: overrides.createNotifier ?? (() => mockNotifier(server.url)),
    configPath: overrides.configPath ?? defaultConfigPath(home),
    env: overrides.env ?? { TG_TOKEN: 'real-secret-token' },
    clock: overrides.clock ?? NO_WAIT_CLOCK,
    now: overrides.now ?? (() => NOW),
    out: overrides.out ?? new BufferOutput(),
  };
}

describe('AC-01: init 마법사 전체 흐름', () => {
  it('chat_id 자동 감지(12345678) + config 600 + 테스트 발송 1건(면책 고지)', async () => {
    const out = new BufferOutput();
    const configPath = defaultConfigPath(homeDir());
    const deps = initDeps({
      out,
      configPath,
      prompts: scriptedPrompts({
        inputToken: async () => 'env:TG_TOKEN',
        knowsChatId: async () => false,
      }),
    });

    const result = await runInitWizard(deps);

    // chat_id 자동 감지.
    expect(result.chatId).toBe('12345678');
    expect(result.chatIdAutoDetected).toBe(true);

    // config 600 + env: 참조라 평문 경고 없음.
    expect(fileMode(configPath)).toBe(0o600);
    expect(result.warnings).toHaveLength(0);

    // 테스트 발송 1건 + 면책 고지 포함.
    expect(server.sends).toHaveLength(1);
    expect(result.testSendOk).toBe(true);
    expect(server.sends[0]?.text).toContain(DISCLAIMER);
  });
});

describe('AC-06: init 평문 토큰 경고', () => {
  it('평문 토큰 입력 시 경고 + 권한 600', async () => {
    const out = new BufferOutput();
    const configPath = defaultConfigPath(homeDir());
    const deps = initDeps({
      out,
      configPath,
      prompts: scriptedPrompts({
        inputToken: async () => '123456:PLAINTOKEN',
        knowsChatId: async () => true,
        inputChatId: async () => '999',
      }),
    });

    const result = await runInitWizard(deps);

    expect(result.chatId).toBe('999');
    expect(result.chatIdAutoDetected).toBe(false);
    expect(result.warnings.some((w) => w.includes('평문'))).toBe(true);
    expect(fileMode(configPath)).toBe(0o600);
    expect(out.stderr).toContain('env:TG_TOKEN');
  });
});

describe('init 엣지 케이스', () => {
  it('자동 감지 실패(업데이트 없음)면 CliError', async () => {
    const deps = initDeps({
      createTgVerify: () => cannedTgVerify({ updates: { ok: true, chatIds: [] } }),
      prompts: scriptedPrompts({ knowsChatId: async () => false }),
    });
    await expect(runInitWizard(deps)).rejects.toBeInstanceOf(CliError);
  });

  it('감지 확인 거부 시 직접 입력으로 대체한다', async () => {
    const deps = initDeps({
      prompts: scriptedPrompts({
        knowsChatId: async () => false,
        confirmChatId: async () => false,
        inputChatId: async () => '777',
      }),
    });
    const result = await runInitWizard(deps);
    expect(result.chatId).toBe('777');
    expect(result.chatIdAutoDetected).toBe(false);
  });

  it('빈 토큰이면 CliError', async () => {
    const deps = initDeps({ prompts: scriptedPrompts({ inputToken: async () => '  ' }) });
    await expect(runInitWizard(deps)).rejects.toBeInstanceOf(CliError);
  });
});
