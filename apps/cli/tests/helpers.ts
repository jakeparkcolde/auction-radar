import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ingestParsed, parseRecord } from '@auction-radar/core';
import type { Clock, SourceClient } from '@auction-radar/core';
import type { SourceRecord } from '@auction-radar/core';
import { FixtureSourceClient } from '@auction-radar/core';
import type { Store } from '@auction-radar/store';
import { TelegramNotifier } from '@auction-radar/alert';
import type { Notifier } from '@auction-radar/alert';
import { openStore } from '../src/store/open.js';
import { BufferOutput } from '../src/output.js';
import type { CliDeps } from '../src/deps.js';
import type { Config } from '../src/config/schema.js';
import type { Prompts } from '../src/wizard/port.js';
import type { GetMeResult, GetUpdatesResult } from '../src/telegram/verify.js';

/** 테스트 고정 시각(ISO) — 13:00 KST(주간, quiet hours 밖). */
export const NOW = '2026-07-03T04:00:00.000Z';

/** 대기하지 않는 fake clock. */
export const NO_WAIT_CLOCK: Clock = { now: () => 0, sleep: async () => undefined };

/** store + alert 마이그레이션이 적용된 인메모리 스토어. */
export function makeStore(): Store {
  return openStore(':memory:');
}

/** 임시 홈 디렉터리를 만든다. */
export function makeHomeDir(): string {
  return mkdtempSync(join(tmpdir(), 'ar-cli-'));
}

/** 기준 물건 레코드(인천 서구 아파트, 유찰 후 하락). */
export function baseRecord(n: number): SourceRecord {
  return {
    court: 'B000280',
    caseNumber: `2025타경3000${n}`,
    itemNo: 1,
    usage: '아파트',
    addressRaw: '인천광역시 서구 청라동',
    appraisedPrice: 400000000,
    minSalePrice: 320000000,
    failedCount: 0,
    status: '진행중',
    nextSaleDate: '2026-07-28',
    announcementId: `A-3000${n}`,
  };
}

/** 레코드를 ingest 하고 itemId 를 반환한다. */
export function ingest(store: Store, rec: SourceRecord, now: string = NOW): number {
  const parsed = parseRecord(rec);
  if (!parsed.ok || parsed.parsed === undefined) {
    throw new Error(`parse fail: ${parsed.warning ?? 'unknown'}`);
  }
  return ingestParsed(store, parsed.parsed, now).itemId;
}

/** 워치리스트를 DB 에 직접 삽입한다. */
export function addWatchlistDb(store: Store, config: Record<string, unknown>, now: string = NOW): number {
  return store.upsert(
    'INSERT INTO watchlists (name, config, enabled, created_at) VALUES (?, ?, 1, ?)',
    [(config.name as string) ?? 'wl', JSON.stringify(config), now],
  ).lastInsertRowid;
}

/** 테스트 기본 설정. */
export function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    version: 1,
    telegram: { token: 'CI-FAKE-TOKEN', chatId: '123' },
    store: { driver: 'sqlite', path: ':memory:' },
    collector: { minDelayMs: 2000, maxCallsPerSession: 10, schedule: ['08:00', '18:00'] },
    enrich: { enabled: false },
    notify: { digestThreshold: 6, quietHours: ['23:00', '07:00'] },
    watchlists: [],
    ...overrides,
  };
}

/** getMe/getUpdates 캔드 응답 클라이언트. */
export function cannedTgVerify(opts: {
  me?: GetMeResult;
  updates?: GetUpdatesResult;
}): { getMe(): Promise<GetMeResult>; getUpdates(): Promise<GetUpdatesResult> } {
  return {
    getMe: async () => opts.me ?? { ok: true, username: 'test_bot' },
    getUpdates: async () => opts.updates ?? { ok: true, chatIds: [] },
  };
}

/** mock 서버 baseUrl 로 발송하는 TelegramNotifier. */
export function mockNotifier(baseUrl: string): Notifier {
  return new TelegramNotifier({
    token: 'CI-FAKE-TOKEN',
    chatId: '123',
    baseUrl,
    clock: NO_WAIT_CLOCK,
    interSendDelayMs: 0,
  });
}

/** 발송을 캡처만 하는 fake notifier. */
export function capturingNotifier(): { notifier: Notifier; sends: string[] } {
  const sends: string[] = [];
  return {
    sends,
    notifier: {
      send: async (msg) => {
        sends.push(msg.text);
        return { ok: true };
      },
      sendDigest: async (msgs) => {
        for (const m of msgs) sends.push(m.text);
        return msgs.map(() => ({ ok: true }));
      },
    },
  };
}

/** CliDeps 를 구성하기 위한 오버라이드. */
export interface DepsOverrides {
  out?: BufferOutput;
  store?: Store;
  config?: Config;
  source?: SourceClient;
  notifier?: Notifier;
  prompts?: Prompts;
  tgVerify?: { getMe(): Promise<GetMeResult>; getUpdates(): Promise<GetUpdatesResult> };
  platform?: NodeJS.Platform;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  now?: () => string;
}

/** program 테스트용 CliDeps + 캡처 핸들. */
export interface TestHarness {
  deps: CliDeps;
  out: BufferOutput;
  store: Store;
  config: Config;
}

/** 주입된 fake 로 CliDeps 를 만든다(program 통합 테스트용). */
export function makeDeps(overrides: DepsOverrides = {}): TestHarness {
  const out = overrides.out ?? new BufferOutput();
  const store = overrides.store ?? makeStore();
  const config = overrides.config ?? makeConfig();
  const source = overrides.source ?? new FixtureSourceClient({ lists: {} });
  const notifier = overrides.notifier ?? capturingNotifier().notifier;
  const tgVerify = overrides.tgVerify ?? cannedTgVerify({});
  const homeDir = overrides.homeDir ?? makeHomeDir();

  const deps: CliDeps = {
    out,
    clock: NO_WAIT_CLOCK,
    now: overrides.now ?? (() => NOW),
    env: overrides.env ?? {},
    platform: overrides.platform ?? 'darwin',
    homeDir,
    execPath: '/usr/local/bin/node',
    scriptPath: '/opt/auction-radar/dist/index.js',
    prompts: overrides.prompts ?? scriptedPrompts(),
    openStore: () => store,
    createSource: () => source,
    createNotifier: () => notifier,
    createTgVerify: () => tgVerify as ReturnType<CliDeps['createTgVerify']>,
    loadConfig: () => ({ config, raw: config, path: join(homeDir, 'config.json') }),
  };

  return { deps, out, store, config };
}

/** 기본 스크립트 Prompts(필요 시 부분 오버라이드). */
export function scriptedPrompts(overrides: Partial<Prompts> = {}): Prompts {
  return {
    inputToken: async () => 'env:TG_TOKEN',
    knowsChatId: async () => true,
    inputChatId: async () => '123',
    waitForBotMessage: async () => undefined,
    confirmChatId: async () => true,
    inputWatchlist: async () => ({ name: '내 조건', courts: ['B000280'], notify: ['new'] }),
    ...overrides,
  };
}
