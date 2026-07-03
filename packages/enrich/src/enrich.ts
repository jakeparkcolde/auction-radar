import type { Store } from '@auction-radar/store';
import type { EnrichConfig } from './config.js';
import type { EnrichResult, EnrichTarget, RtTradeRecord } from './types.js';
import { MolitClient } from './molit/client.js';
import type { MolitFetchLike } from './molit/client.js';
import { last12Months, loadTradesForLawd, refreshRtTradesCache } from './cache/rtTradesCache.js';
import { selectCandidates } from './match/candidates.js';
import { median } from './stats/median.js';
import { discountRate } from './discount/discount.js';
import { gradeConfidence } from './grade/confidence.js';

/**
 * enrich 오케스트레이터. (REQ-002/003/005)
 *
 * 흐름: (선택)캐시 갱신 → 대상별 캐시 매칭 → 중위값·할인율·등급 조립.
 * 실패 격리 원칙:
 *   - enabled=false 또는 molitKey 부재 → 클라이언트 skip(예외 없음), 기존 캐시로 계산.
 *   - 클라이언트 오류(쿼터 소진 등) → 캐시 유지 후 캐시 기준 계산 지속. (REQ-003)
 *   - lawd_cd NULL → "실거래 비교 불가" 기록 후 null(알림·매칭 정상). (REQ-005)
 *   - 대상별 계산 예외 → 해당 대상만 null(파이프라인 무중단).
 */

/** enrich 실행 의존성. */
export interface EnrichDeps {
  /** MOLIT fetch 주입(테스트·CI). 미주입 시 클라이언트 사용 안 함. */
  readonly fetchFn?: MolitFetchLike;
  /** 기준 시각(기본 현재). */
  readonly now?: () => Date;
  /** 로거(관측용). */
  readonly logger?: { warn: (m: string) => void; info?: (m: string) => void };
}

/**
 * 캐시된 실거래로 단일 대상의 enrich 결과를 조립한다(순수 계산, 네트워크 없음).
 *
 * @returns 표본 부족·계산 불가 시 null.
 */
export function computeResult(target: EnrichTarget, trades: readonly RtTradeRecord[]): EnrichResult | null {
  if (target.lawdCd === null) return null;
  if (target.minSalePrice === null) return null;

  const { prices, fallbackUsed } = selectCandidates(trades, target.aptName, target.area);
  if (prices.length === 0) return null;

  const medianPrice = median(prices);
  if (medianPrice === null || medianPrice <= 0) return null;

  const rate = discountRate(target.minSalePrice, medianPrice);
  if (rate === null) return null;

  const { confidence, emphasize } = gradeConfidence({
    sampleCount: prices.length,
    fallbackUsed,
    usage: target.usage,
  });

  return {
    discountRate: rate,
    medianPrice,
    sampleCount: prices.length,
    confidence,
    fallbackUsed,
    emphasize,
  };
}

/** enabled + molitKey + fetchFn 이 모두 있으면 캐시를 갱신한다(오류는 격리). */
async function maybeRefreshCache(
  store: Store,
  config: EnrichConfig,
  targets: readonly EnrichTarget[],
  deps: EnrichDeps,
): Promise<void> {
  if (!config.enabled || !config.molitKey || !deps.fetchFn) return;

  // 워치리스트(=매칭 대상) lawd_cd 집합만 조회한다(비워치리스트는 미조회). (AC-02)
  const lawdCds = [...new Set(targets.map((t) => t.lawdCd).filter((c): c is string => c !== null))];
  if (lawdCds.length === 0) return;

  const client = new MolitClient(config.baseUrl, config.molitKey, deps.fetchFn);
  try {
    await refreshRtTradesCache(store, client, lawdCds, {
      ...(deps.now ? { now: deps.now } : {}),
      ...(deps.logger ? { logger: deps.logger } : {}),
    });
  } catch (err) {
    // 갱신 전체 실패도 캐시 기준 계산으로 이어간다. (REQ-003)
    deps.logger?.warn(`enrich 캐시 갱신 실패 — 기존 캐시로 계산 지속: ${String(err)}`);
  }
}

/**
 * 미발송 이벤트 대상들의 enrich 결과 맵을 만든다.
 *
 * @param store   스토어(rt_trades 캐시 read/write).
 * @param config  enrich 설정.
 * @param targets enrich 대상(이벤트별 물건 정보).
 * @param deps    fetch·시간·로거 주입.
 * @returns eventId → EnrichResult | null 맵(항상 모든 대상 키 포함).
 */
export async function enrichUndelivered(
  store: Store,
  config: EnrichConfig,
  targets: readonly EnrichTarget[],
  deps: EnrichDeps = {},
): Promise<Map<number, EnrichResult | null>> {
  const out = new Map<number, EnrichResult | null>();
  if (targets.length === 0) return out;

  await maybeRefreshCache(store, config, targets, deps);

  const now = (deps.now ?? (() => new Date()))();
  const months = last12Months(now);

  for (const target of targets) {
    try {
      if (target.lawdCd === null) {
        // 3계층 매핑 실패 — enrich 불가로 기록하고 skip. (REQ-005)
        deps.logger?.info?.(`실거래 비교 불가(lawd_cd 없음) event_id=${target.eventId}`);
        out.set(target.eventId, null);
        continue;
      }
      const trades = loadTradesForLawd(store, target.lawdCd, months);
      out.set(target.eventId, computeResult(target, trades));
    } catch (err) {
      // 대상별 예외 격리 — 파이프라인 무중단. (REQ-003)
      deps.logger?.warn(`enrich 계산 실패 event_id=${target.eventId}: ${String(err)}`);
      out.set(target.eventId, null);
    }
  }

  return out;
}

/** items 조인 row(대상 로딩용). */
interface TargetRow {
  readonly event_id: number;
  readonly lawd_cd: string | null;
  readonly min_sale_price: number | null;
  readonly usage: string | null;
  readonly address_raw: string | null;
}

/**
 * 이벤트 id 목록으로 enrich 대상을 로드한다(sync 파이프라인 배선용).
 *
 * items 테이블에 단지명·전용면적 전용 컬럼이 없어 aptName 은 address_raw(best-effort),
 * area 는 null 로 채운다(면적 필터 생략 → 폴백 경로). 스키마 확장은 백로그.
 *
 * @param store    스토어.
 * @param eventIds 대상 이벤트 id.
 */
export function loadEnrichTargets(store: Store, eventIds: readonly number[]): EnrichTarget[] {
  if (eventIds.length === 0) return [];
  const placeholders = eventIds.map(() => '?').join(', ');
  const rows = store.query<TargetRow>(
    `SELECT e.id AS event_id, i.lawd_cd, i.min_sale_price, i.usage, i.address_raw
     FROM events e
     JOIN items i ON i.id = e.item_id
     WHERE e.id IN (${placeholders})`,
    [...eventIds],
  );
  return rows.map((r) => ({
    eventId: r.event_id,
    lawdCd: r.lawd_cd,
    minSalePrice: r.min_sale_price,
    usage: r.usage,
    aptName: r.address_raw,
    area: null,
  }));
}
