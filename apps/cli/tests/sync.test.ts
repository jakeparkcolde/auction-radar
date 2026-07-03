import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FixtureSourceClient } from '@auction-radar/core';
import type { Store } from '@auction-radar/store';
import { runSyncCommand } from '../src/commands/sync.js';
import type { SyncCtx } from '../src/commands/sync.js';
import { BufferOutput } from '../src/output.js';
import {
  addWatchlistDb,
  baseRecord,
  capturingNotifier,
  ingest,
  makeConfig,
  makeHomeDir,
  makeStore,
  NO_WAIT_CLOCK,
  NOW,
} from './helpers.js';

const homes: string[] = [];
function lockPath(): string {
  const h = makeHomeDir();
  homes.push(h);
  return join(h, 'sync.lock');
}
afterEach(() => {
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});

/** 4건의 'new' 이벤트 + 매칭 워치리스트를 가진 스토어. */
function storeWith4Matches(courts: string[] = ['B000280']): Store {
  const store = makeStore();
  for (let n = 1; n <= 4; n += 1) ingest(store, baseRecord(n));
  addWatchlistDb(store, { name: '인천 서구 아파트', courts, usages: ['아파트'], notify: ['new'] });
  return store;
}

function ctx(store: Store, overrides: Partial<SyncCtx> = {}): SyncCtx {
  const out = overrides.out ?? new BufferOutput();
  return {
    store,
    source: overrides.source ?? new FixtureSourceClient({ lists: { 'B000280:202607': [] } }),
    notifier: overrides.notifier ?? capturingNotifier().notifier,
    config: overrides.config ?? makeConfig(),
    flags: overrides.flags ?? {},
    lockPath: overrides.lockPath ?? lockPath(),
    clock: NO_WAIT_CLOCK,
    now: () => NOW,
    out,
    months: overrides.months ?? ['202607'],
  };
}

describe('AC-02: sync --dry-run', () => {
  it('매칭 4건 출력 · 발송 0 · notifications 미기록', async () => {
    const store = storeWith4Matches();
    const out = new BufferOutput();
    const { notifier, sends } = capturingNotifier();
    const result = await runSyncCommand(ctx(store, { out, notifier, flags: { dryRun: true } }));

    expect(result.matched).toBe(4);
    expect(result.sent).toBe(0);
    expect(sends).toHaveLength(0);
    expect(out.stdout).toContain('매칭 4건');

    const notif = store.get<{ n: number }>('SELECT count(*) AS n FROM notifications');
    expect(notif?.n).toBe(0);
    store.close();
  });
});

describe('sync 실제 발송(비 dry-run)', () => {
  it('매칭 4건을 발송하고 notifications sent 4건 기록', async () => {
    const store = storeWith4Matches();
    const { notifier, sends } = capturingNotifier();
    const result = await runSyncCommand(ctx(store, { notifier, flags: {} }));

    expect(result.sent).toBe(4);
    expect(sends).toHaveLength(4);
    const sent = store.get<{ n: number }>("SELECT count(*) AS n FROM notifications WHERE status='sent'");
    expect(sent?.n).toBe(4);
    store.close();
  });
});

describe('sync 발송 분기(보류·실패)', () => {
  it('quiet hours 안에서는 발송을 보류(held)한다', async () => {
    const store = storeWith4Matches();
    // 13:00 KST(NOW) 를 포함하는 quiet hours 로 보류 유도.
    const config = makeConfig({ notify: { digestThreshold: 6, quietHours: ['08:00', '18:00'] } });
    const result = await runSyncCommand(ctx(store, { config, flags: {} }));

    expect(result.held).toBe(4);
    expect(result.sent).toBe(0);
    store.close();
  });

  it('발송이 실패하면 failed 로 기록한다', async () => {
    const store = storeWith4Matches();
    const failing = {
      send: async () => ({ ok: false, error: 'HTTP 500' }),
      sendDigest: async (msgs: unknown[]) => msgs.map(() => ({ ok: false, error: 'HTTP 500' })),
    };
    const result = await runSyncCommand(ctx(store, { notifier: failing, flags: {} }));

    expect(result.failed).toBe(4);
    expect(result.sent).toBe(0);
    const failed = store.get<{ n: number }>("SELECT count(*) AS n FROM notifications WHERE status='failed'");
    expect(failed?.n).toBe(4);
    store.close();
  });
});

describe('sync 락·차단 분기', () => {
  it('이미 실행 중이면(락 획득 실패) rejected 로 건너뛴다', async () => {
    const { SyncLock } = await import('@auction-radar/core');
    const store = storeWith4Matches();
    const lp = lockPath();
    const held = new SyncLock(lp);
    expect(held.acquire()).toBe(true);
    try {
      const out = new BufferOutput();
      const result = await runSyncCommand(ctx(store, { out, lockPath: lp, flags: {} }));
      expect(result.rejected).toBe(true);
      expect(out.stdout).toContain('이미 실행 중');
    } finally {
      held.release();
    }
    store.close();
  });

  it('차단(blocked) 감지 시 복구 안내를 출력한다', async () => {
    const store = storeWith4Matches();
    const out = new BufferOutput();
    // 첫 호출(warmup)에서 차단.
    const source = new FixtureSourceClient({ blockOnCall: 1, lists: {} });
    const result = await runSyncCommand(ctx(store, { out, source, flags: { dryRun: true } }));

    expect(result.blocked).toBe(true);
    expect(out.stdout).toContain('차단');
    store.close();
  });
});

describe('config.watchlists seed', () => {
  it('DB 에 없는 config 워치리스트를 seed 한다', async () => {
    const store = makeStore();
    for (let n = 1; n <= 4; n += 1) ingest(store, baseRecord(n));
    const config = makeConfig({
      watchlists: [{ name: 'config-wl', courts: ['B000280'], usages: ['아파트'], notify: ['new'] }],
    });
    const result = await runSyncCommand(ctx(store, { config, flags: { dryRun: true } }));

    // seed 된 워치리스트로 매칭이 발생한다.
    expect(result.matched).toBe(4);
    const seeded = store.get<{ n: number }>("SELECT count(*) AS n FROM watchlists WHERE name='config-wl'");
    expect(seeded?.n).toBe(1);
    store.close();
  });
});

describe('AC-10: 법원 미지정 전체 스캔 경고', () => {
  it('courts 빈 워치리스트만 존재하면 전체 법원 경고 + fullScan', async () => {
    const store = makeStore();
    addWatchlistDb(store, { name: '전지역', courts: [], usages: ['아파트'], notify: ['new'] });
    const out = new BufferOutput();
    const source = new FixtureSourceClient({ courtCodes: ['B000280'], lists: { 'B000280:202607': [] } });

    const result = await runSyncCommand(ctx(store, { out, source, flags: { dryRun: true } }));

    expect(result.fullScan).toBe(true);
    expect(out.stdout).toContain('전체 법원 수집');
    expect(out.stdout).toContain('budget');
    store.close();
  });
});

describe('AC-11: --max-calls 하드 상한', () => {
  it('--max-calls 50 → 유효 30 + 캡 안내', async () => {
    const store = storeWith4Matches();
    const out = new BufferOutput();
    const result = await runSyncCommand(ctx(store, { out, flags: { dryRun: true, maxCalls: 50 } }));

    expect(result.budgetLimit).toBe(30);
    expect(out.stdout).toContain('30회로 제한');
    store.close();
  });
});
