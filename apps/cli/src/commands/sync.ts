import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  BudgetGuard,
  DEFAULT_MAX_CALLS,
  HARD_CAP_CALLS,
  runSync,
  SyncLock,
  Throttler,
} from '@auction-radar/core';
import type { Clock, Logger } from '@auction-radar/core';
import type { Store } from '@auction-radar/store';
import {
  decideDelivery,
  matchEvents,
  recordFailed,
  recordHeld,
  recordSent,
  renderMessage,
  selectUndelivered,
} from '@auction-radar/alert';
import type { Notifier } from '@auction-radar/alert';
import {
  enrichUndelivered,
  loadEnrichTargets,
  resolveEnrichConfig,
  toEnrichInfo,
} from '@auction-radar/enrich';
import type { EnrichResult, MolitFetchLike } from '@auction-radar/enrich';
import type { Config } from '../config/schema.js';
import { withDisclaimer } from '../disclaimer.js';
import { maskSecrets } from '../util/mask.js';
import type { Output } from '../output.js';
import { deriveWatchlistCourts, seedWatchlists } from '../store/watchlists.js';

/**
 * sync 명령 — 수집 → 매칭 → 발송 파이프라인. (CLI-REQ-007/014/015, AC-02/10/11)
 */

/** sync 플래그. */
export interface SyncFlags {
  readonly dryRun?: boolean;
  readonly firstRun?: boolean;
  /** --max-calls N (config·기본값보다 우선, 하드 상한 30 으로 캡). */
  readonly maxCalls?: number;
}

/** runSyncCommand 컨텍스트. */
export interface SyncCtx {
  readonly store: Store;
  readonly source: Parameters<typeof runSync>[0]['source'];
  readonly notifier: Notifier;
  readonly config: Config;
  readonly flags: SyncFlags;
  readonly lockPath: string;
  readonly clock: Clock;
  readonly now: () => string;
  readonly out: Output;
  /** 조회 대상 년월(테스트 주입). 미지정 시 core 가 당월+익월 계산. */
  readonly months?: readonly string[];
}

/** sync 결과(테스트 검증용). */
export interface SyncCommandResult {
  readonly rejected: boolean;
  readonly blocked: boolean;
  readonly fullScan: boolean;
  readonly callsUsed: number;
  readonly matched: number;
  readonly sent: number;
  readonly held: number;
  readonly failed: number;
  readonly dryRun: boolean;
  readonly budgetLimit: number;
}

/** 비밀값을 마스킹해 out.log 로 흘려보내는 Logger. */
function maskingLogger(out: Output, secrets: ReadonlyArray<string | undefined>): Logger {
  return {
    info: (m) => out.log(maskSecrets(m, secrets)),
    warn: (m) => out.log(maskSecrets(m, secrets)),
  };
}

/** 매칭 이벤트 한 건의 간단 요약(dry-run 출력용). */
function matchSummary(courtName: string, caseNumber: string, region: string | null | undefined): string {
  const loc = region ? ` · ${region}` : '';
  return `- ${courtName} ${caseNumber}${loc}`;
}

/**
 * 미발송 이벤트에 대한 enrich 결과 맵을 계산한다. (SPEC-ENRICH-001 REQ-003/011, AC-08)
 *
 * enrich 는 알림 파이프라인의 부가 정보이므로, 어떤 실패도 여기서 흡수해
 * 빈 맵을 반환한다(할인율 라인만 생략, 알림은 정상 발송·sync 성공 유지).
 */
async function computeEnrichMap(
  store: Store,
  config: Config,
  eventIds: readonly number[],
  now: () => string,
  logger: Logger,
): Promise<Map<number, EnrichResult | null>> {
  if (eventIds.length === 0) return new Map();
  try {
    const enrichConfig = resolveEnrichConfig({
      enabled: config.enrich.enabled,
      ...(config.enrich.molitKey !== undefined ? { molitKey: config.enrich.molitKey } : {}),
      ...(config.enrich.baseUrl !== undefined ? { baseUrl: config.enrich.baseUrl } : {}),
    });
    const targets = loadEnrichTargets(store, eventIds);
    // enabled + molitKey 일 때만 실제 호출된다(기본 비활성 → 네트워크 없음).
    const fetchFn: MolitFetchLike = (url) =>
      globalThis.fetch(url) as unknown as ReturnType<MolitFetchLike>;
    return await enrichUndelivered(store, enrichConfig, targets, {
      now: () => new Date(now()),
      logger,
      fetchFn,
    });
  } catch (err) {
    logger.warn(`enrich 결합 실패 — 할인율 라인 없이 발송 지속: ${String(err)}`);
    return new Map();
  }
}

/**
 * sync 를 실행한다.
 */
export async function runSyncCommand(ctx: SyncCtx): Promise<SyncCommandResult> {
  const { store, out, config, flags } = ctx;
  const secrets = [config.telegram.token, config.enrich.molitKey];

  // config.watchlists 를 DB 에 seed(첫 sync 편의) 후 코스 도출.
  seedWatchlists(store, config.watchlists, ctx.now());
  const courts = deriveWatchlistCourts(store);

  // 법원 미지정 → 전체 스캔 경고. (CLI-REQ-015, AC-10)
  if (courts.length === 0) {
    out.log('전체 법원 수집 — budget이 빠르게 소진됩니다. 워치리스트에 법원을 지정하는 것을 권장합니다.');
  }

  // --max-calls 우선순위: flag > config > 기본(10). 하드 상한 30 캡. (AC-11)
  const requested = flags.maxCalls ?? config.collector.maxCallsPerSession ?? DEFAULT_MAX_CALLS;
  if (requested > HARD_CAP_CALLS) {
    out.log(
      `요청한 호출 상한(${requested})은 하드 상한 ${HARD_CAP_CALLS}회를 초과하여 ${HARD_CAP_CALLS}회로 제한합니다.`,
    );
  }
  const budget = new BudgetGuard(requested);

  // lockfile 부모 디렉터리 보장(첫 실행 시 ~/.auction-radar 미존재 방어).
  mkdirSync(dirname(ctx.lockPath), { recursive: true });

  const logger = maskingLogger(out, secrets);
  const result = await runSync({
    store,
    source: ctx.source,
    throttler: new Throttler(config.collector.minDelayMs, ctx.clock),
    budget,
    lock: new SyncLock(ctx.lockPath),
    watchlistCourts: courts,
    ...(ctx.months !== undefined ? { months: ctx.months } : {}),
    now: ctx.now,
    logger,
  });

  if (result.rejected) {
    out.log(withDisclaimer('이미 실행 중인 sync 가 있어 이번 실행을 건너뜁니다.'));
    return {
      rejected: true,
      blocked: false,
      fullScan: false,
      callsUsed: 0,
      matched: 0,
      sent: 0,
      held: 0,
      failed: 0,
      dryRun: flags.dryRun === true,
      budgetLimit: budget.limit,
    };
  }

  // 매칭 → 미발송 선별.
  matchEvents(store);
  const undelivered = selectUndelivered(store, ctx.now());

  // enrich 결합(할인율·신뢰도) — 실패는 흡수해 알림 파이프라인을 무중단 유지. (REQ-003/011)
  const enrichMap = await computeEnrichMap(
    store,
    config,
    undelivered.map((u) => u.eventId),
    ctx.now,
    logger,
  );

  let sent = 0;
  let held = 0;
  let failed = 0;

  if (flags.dryRun === true) {
    // 발송·기록 없이 매칭 결과만 출력. (AC-02)
    out.log(`매칭 ${undelivered.length}건 (dry-run — 발송하지 않음):`);
    for (const u of undelivered) {
      out.log(matchSummary(u.render.courtName, u.render.caseNumber, u.render.region));
    }
  } else {
    for (const u of undelivered) {
      const decision = decideDelivery(u.type, new Date(ctx.now()), config.notify.quietHours);
      if (decision.action === 'hold') {
        recordHeld(store, u.eventId, decision.deliverAfter);
        held += 1;
        continue;
      }
      // enrich 결과가 있으면 렌더 입력에 병합(없으면 기존과 동일한 렌더). (REQ-011)
      const enrichResult = enrichMap.get(u.eventId) ?? null;
      const renderInput = enrichResult
        ? { ...u.render, enrich: toEnrichInfo(enrichResult) }
        : u.render;
      const text = renderMessage(renderInput);
      const res = await ctx.notifier.send({ text });
      if (res.ok) {
        recordSent(store, u.eventId, ctx.now());
        sent += 1;
      } else {
        recordFailed(store, u.eventId, maskSecrets(res.error ?? 'unknown', secrets));
        failed += 1;
      }
    }
  }

  if (result.blocked) {
    out.log('차단(blocked)이 감지되었습니다. 약 1시간 후 자동 재시도 없이 다시 실행하세요.');
  }

  out.log(
    withDisclaimer(
      `sync 완료 — 호출 ${result.callsUsed}회 · 물건 ${result.itemsUpserted} · ` +
        `이벤트 ${result.eventsCreated} · 매칭 ${undelivered.length} · 발송 ${sent} · 보류 ${held} · 실패 ${failed}`,
    ),
  );

  return {
    rejected: false,
    blocked: result.blocked,
    fullScan: result.fullScan,
    callsUsed: result.callsUsed,
    matched: undelivered.length,
    sent,
    held,
    failed,
    dryRun: flags.dryRun === true,
    budgetLimit: budget.limit,
  };
}
