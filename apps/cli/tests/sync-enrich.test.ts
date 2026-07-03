import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FixtureSourceClient } from '@auction-radar/core';
import type { SourceRecord } from '@auction-radar/core';
import type { Store } from '@auction-radar/store';
import { runSyncCommand } from '../src/commands/sync.js';
import type { SyncCtx } from '../src/commands/sync.js';
import { BufferOutput } from '../src/output.js';
import {
  addWatchlistDb,
  capturingNotifier,
  ingest,
  makeConfig,
  makeHomeDir,
  makeStore,
  NO_WAIT_CLOCK,
  NOW,
} from './helpers.js';

/**
 * SPEC-ENRICH-001 D8/AC-03 — sync 파이프라인의 enrich 병합 배선 검증.
 *
 * enabled=false 라도 rt_trades 캐시가 있으면 캐시 기준으로 할인율 라인이 렌더된다.
 */

const homes: string[] = [];
function lockPath(): string {
  const h = makeHomeDir();
  homes.push(h);
  return join(h, 'sync.lock');
}
afterEach(() => {
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});

/** 최저매각가 256,000,000원, lawd_cd=28260 인천 서구 청라동 아파트. */
function enrichRecord(): SourceRecord {
  return {
    court: 'B000280',
    caseNumber: '2025타경90001',
    itemNo: 1,
    usage: '아파트',
    addressRaw: '인천광역시 서구 청라동',
    appraisedPrice: 400_000_000,
    minSalePrice: 256_000_000,
    failedCount: 0,
    status: '진행중',
    nextSaleDate: '2026-07-28',
    announcementId: 'A-90001',
  };
}

/** median 이 376,000,000 이 되는 14건(apt_name_norm="청라동" → 대상 주소에 포함). */
function seedRtTrades(store: Store): void {
  const millions = [350, 355, 360, 365, 370, 375, 376, 376, 380, 385, 390, 395, 400, 405];
  const sql =
    'INSERT INTO rt_trades (lawd_cd, deal_ym, apt_name_norm, area, floor, price, deal_date, fetched_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
  for (const m of millions) {
    store.upsert(sql, ['28260', '202607', '청라동', 84.99, 10, m * 1_000_000, '2026-07-05', NOW]);
  }
}

function ctx(store: Store): SyncCtx {
  return {
    store,
    source: new FixtureSourceClient({ lists: { 'B000280:202607': [] } }),
    notifier: capturingNotifier().notifier,
    config: makeConfig(),
    flags: {},
    lockPath: lockPath(),
    clock: NO_WAIT_CLOCK,
    now: () => NOW,
    out: new BufferOutput(),
    months: ['202607'],
  };
}

describe('AC-03: sync enrich 병합', () => {
  it('lawd_cd + rt_trades 캐시가 있으면 알림에 할인율 라인이 병합된다', async () => {
    const store = makeStore();
    const itemId = ingest(store, enrichRecord());
    // 3계층 매핑 결과(lawd_cd)를 부여한다(COLLECTOR 담당 영역을 테스트에서 시뮬레이션).
    store.upsert('UPDATE items SET lawd_cd = ? WHERE id = ?', ['28260', itemId]);
    seedRtTrades(store);
    addWatchlistDb(store, {
      name: '인천 서구 아파트',
      courts: ['B000280'],
      usages: ['아파트'],
      notify: ['new'],
    });

    const { notifier, sends } = capturingNotifier();
    const result = await runSyncCommand({ ...ctx(store), notifier });

    expect(result.sent).toBe(1);
    expect(sends).toHaveLength(1);
    // AC-03 형식: 중위값 376M 대비 최저 256M → −32%, 표본 14, 신뢰도 높음(강조 유지).
    expect(sends[0]).toContain('📊 인근 실거래 중위값 대비 <b>−32%</b> (표본 14건 · 신뢰도 높음)');
    store.close();
  });

  it('enrich 데이터가 없으면 기존과 동일하게 할인율 라인 없이 발송한다', async () => {
    const store = makeStore();
    ingest(store, enrichRecord()); // lawd_cd 미부여 → enrich skip
    addWatchlistDb(store, {
      name: '인천 서구 아파트',
      courts: ['B000280'],
      usages: ['아파트'],
      notify: ['new'],
    });

    const { notifier, sends } = capturingNotifier();
    const result = await runSyncCommand({ ...ctx(store), notifier });

    expect(result.sent).toBe(1);
    expect(sends[0]).not.toContain('📊');
    store.close();
  });
});
