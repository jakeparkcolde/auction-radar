import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations, SqliteStore } from '@auction-radar/store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FixtureSourceClient, type FixtureScript } from '../src/source/index.js';
import { BudgetGuard } from '../src/throttle/BudgetGuard.js';
import { Throttler, type Clock } from '../src/throttle/Throttler.js';
import { ingestParsed, parseRecord } from '../src/sync/ingest.js';
import { SyncLock } from '../src/sync/lockfile.js';
import { runSync, type Logger } from '../src/sync/orchestration.js';
import type { SourceRecord } from '../src/types.js';

const NOW = () => '2026-07-03T00:00:00Z';

/** 즉시 반환하지만 논리 시간을 진행시키고 지연을 기록하는 fake clock. */
function fakeClock(): { clock: Clock; sleeps: number[] } {
  let t = 0;
  const sleeps: number[] = [];
  return {
    clock: {
      now: () => t,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        t += ms;
      },
    },
    sleeps,
  };
}

function capturingLogger(): { logger: Logger; messages: string[] } {
  const messages: string[] = [];
  return {
    logger: { info: (m) => messages.push(m), warn: (m) => messages.push(m) },
    messages,
  };
}

let dir: string;
let lockPath: string;
let store: SqliteStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ar-sync-'));
  lockPath = join(dir, 'sync.lock');
  store = new SqliteStore(':memory:');
  runMigrations(store);
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

function seed(rec: SourceRecord): void {
  const parsed = parseRecord(rec);
  if (parsed.parsed) ingestParsed(store, parsed.parsed, NOW());
}

const existing = (n: number): SourceRecord => ({
  court: 'B000280',
  caseNumber: `2025타경4000${String(n).padStart(2, '0')}`,
  itemNo: 1,
  usage: '아파트',
  addressRaw: '인천광역시 서구 청라동',
  appraisedPrice: 300000000,
  minSalePrice: 300000000,
  failedCount: 0,
  status: '진행중',
  nextSaleDate: '2026-07-20',
  announcementId: `A-4000${n}`,
});

describe('AC-01: 증분 sync 기본 흐름 (REQ-005, 006)', () => {
  it('warmup→목록(당월+익월) 순서, 신규만 상세, 미변경은 상세 호출 없음', async () => {
    // 기존 item 10건 seed
    for (let i = 1; i <= 10; i += 1) seed(existing(i));

    const newRec: SourceRecord = {
      court: 'B000280',
      caseNumber: '2025타경409999',
      itemNo: 1,
      usage: '아파트',
      addressRaw: '인천광역시 서구 가정동',
      appraisedPrice: 500000000,
      minSalePrice: 500000000,
      failedCount: 0,
      status: '진행중',
      nextSaleDate: '2026-08-05',
      announcementId: 'A-NEW',
    };

    const script: FixtureScript = {
      lists: {
        'B000280:202607': [...Array.from({ length: 10 }, (_, i) => existing(i + 1)), newRec],
        'B000280:202608': [],
      },
    };
    const source = new FixtureSourceClient(script);
    const { clock } = fakeClock();

    const result = await runSync({
      store,
      source,
      throttler: new Throttler(2000, clock),
      budget: new BudgetGuard(30),
      lock: new SyncLock(lockPath),
      watchlistCourts: ['B000280'],
      months: ['202607', '202608'],
      now: NOW,
    });

    expect(result.rejected).toBe(false);
    expect(result.blocked).toBe(false);
    // warmup(1) + list당월(2) + list익월(3) + 신규 상세(4)
    expect(result.callsUsed).toBe(4);
    expect(source.callLog).toEqual([
      'warmup',
      'listAnnouncement',
      'listAnnouncement',
      'detailAnnouncement',
    ]);
    // 상세는 신규 1건에 대해서만
    expect(source.callLog.filter((e) => e === 'detailAnnouncement')).toHaveLength(1);
    // 11건 upsert, 신규 이벤트 1건
    expect(result.itemsUpserted).toBe(11);
    expect(result.eventsCreated).toBe(1);

    const run = store.get<{ calls_used: number; items_upserted: number; events_created: number }>(
      'SELECT calls_used, items_upserted, events_created FROM sync_runs WHERE id = ?',
      [result.runId as number],
    );
    expect(run).toMatchObject({ calls_used: 4, items_upserted: 11, events_created: 1 });
  });
});

describe('AC-05: 차단 감지 즉시 중단 (REQ-003, 004)', () => {
  it('3번째 호출이 ipcheck=false 면 4번째 호출 없이 중단, blocked=1, 복구 안내', async () => {
    const script: FixtureScript = {
      blockOnCall: 3,
      lists: {
        'B000280:202607': [existing(1)],
        'B000280:202608': [existing(2)],
      },
    };
    const source = new FixtureSourceClient(script);
    const { logger, messages } = capturingLogger();
    const { clock } = fakeClock();

    const result = await runSync({
      store,
      source,
      throttler: new Throttler(2000, clock),
      budget: new BudgetGuard(30),
      lock: new SyncLock(lockPath),
      watchlistCourts: ['B000280'],
      months: ['202607', '202608'],
      now: NOW,
      logger,
    });

    expect(result.blocked).toBe(true);
    // 3번째 호출 직후 중단 — 4번째(상세) 없음
    expect(source.calls).toBe(3);
    expect(source.callLog).toEqual(['warmup', 'listAnnouncement', 'listAnnouncement']);

    const run = store.get<{ blocked: number }>('SELECT blocked FROM sync_runs WHERE id = ?', [
      result.runId as number,
    ]);
    expect(run?.blocked).toBe(1);
    expect(messages.some((m) => m.includes('약 1시간'))).toBe(true);
  });
});

describe('AC-06: 파싱 실패 graceful skip (REQ-016)', () => {
  interface ParseFailFixture {
    court: string;
    yearMonth: string;
    records: SourceRecord[];
  }
  const path = fileURLToPath(new URL('../../../fixtures/list-parse-failure.fixture.json', import.meta.url));
  const fx = JSON.parse(readFileSync(path, 'utf8')) as ParseFailFixture;

  it('20건 중 2건 누락 → 18 upsert + raw(parse_ok=0) 2건 + 경고 2, sync 성공', async () => {
    const script: FixtureScript = {
      lists: { [`${fx.court}:${fx.yearMonth}`]: fx.records },
    };
    const source = new FixtureSourceClient(script);
    const { clock } = fakeClock();

    const result = await runSync({
      store,
      source,
      throttler: new Throttler(2000, clock),
      budget: new BudgetGuard(30),
      lock: new SyncLock(lockPath),
      watchlistCourts: [fx.court],
      months: [fx.yearMonth],
      now: NOW,
    });

    expect(result.blocked).toBe(false);
    expect(result.itemsUpserted).toBe(18);
    expect(result.warnings).toBeGreaterThanOrEqual(2);

    const badRaw = store.get<{ n: number }>(
      'SELECT count(*) AS n FROM raw_snapshots WHERE parse_ok = 0',
    );
    expect(badRaw?.n).toBe(2);

    const items = store.get<{ n: number }>('SELECT count(*) AS n FROM items');
    expect(items?.n).toBe(18);
  });
});

describe('AC-09: budget 상한 및 지연 하한 강제 (REQ-001, 002)', () => {
  it('minDelay 500/maxCalls 50 → 실제 지연 ≥2000ms, 호출 ≤30 (fake clock)', async () => {
    // 40개 법원 → warmup + 40 목록 시도지만 budget 30 에서 소진
    const courts = Array.from({ length: 40 }, (_, i) => `C${String(i).padStart(3, '0')}`);
    const source = new FixtureSourceClient({ lists: {} }); // 모든 목록 빈 배열
    const { clock, sleeps } = fakeClock();

    const result = await runSync({
      store,
      source,
      throttler: new Throttler(500, clock), // 500 → 2000 하한
      budget: new BudgetGuard(50), // 50 → 30 하드 상한
      lock: new SyncLock(lockPath),
      watchlistCourts: courts,
      months: ['202607'],
      now: NOW,
    });

    expect(result.callsUsed).toBe(30);
    expect(result.callsUsed).toBeLessThanOrEqual(30);
    // 호출 간 모든 지연이 2000ms 이상
    expect(sleeps.length).toBeGreaterThan(0);
    expect(Math.min(...sleeps)).toBeGreaterThanOrEqual(2000);
  });
});

describe('REQ-005: 워치리스트에 법원이 없으면 전체 대상 + 경고', () => {
  it('watchlistCourts 가 비면 법원 코드표를 조회하고 fullScan=true, 경고를 남긴다', async () => {
    const script: FixtureScript = {
      courtCodes: ['B000280', 'B000210'],
      lists: {
        'B000280:202607': [],
        'B000210:202607': [],
      },
    };
    const source = new FixtureSourceClient(script);
    const { logger, messages } = capturingLogger();
    const { clock } = fakeClock();

    const result = await runSync({
      store,
      source,
      throttler: new Throttler(2000, clock),
      budget: new BudgetGuard(30),
      lock: new SyncLock(lockPath),
      watchlistCourts: [],
      months: ['202607'],
      now: NOW,
      logger,
    });

    expect(result.fullScan).toBe(true);
    // warmup(1) + courtCodeList(2) + 2개 법원 목록(3,4)
    expect(source.callLog).toEqual([
      'warmup',
      'courtCodeList',
      'listAnnouncement',
      'listAnnouncement',
    ]);
    expect(messages.some((m) => m.includes('전체 법원'))).toBe(true);
  });
});

describe('AC-10: 동시 sync 차단 (REQ-007)', () => {
  it('lockfile 보유 중 두 번째 sync 는 rejected 로 즉시 종료', async () => {
    const source = new FixtureSourceClient({ lists: { 'B000280:202607': [] } });
    const { clock } = fakeClock();

    // 첫 락을 외부에서 선점
    const holder = new SyncLock(lockPath);
    expect(holder.acquire()).toBe(true);

    const result = await runSync({
      store,
      source,
      throttler: new Throttler(2000, clock),
      budget: new BudgetGuard(10),
      lock: new SyncLock(lockPath),
      watchlistCourts: ['B000280'],
      months: ['202607'],
      now: NOW,
    });

    expect(result.rejected).toBe(true);
    expect(source.calls).toBe(0); // 수집 미시작
    holder.release();
  });
});
