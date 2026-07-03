import type { ItemState } from '../types.js';
import { stateHash } from './stateHash.js';

/**
 * 이벤트 생성기. (REQ-014, §6.3)
 *
 * 순수 함수: (이전 상태, 다음 상태) → 이벤트 후보 목록.
 * 실제 멱등성은 dedup_key UNIQUE 제약으로 DB 레벨에서 보장된다. (REQ-015)
 *
 * 이벤트 타입과 dedup_key 규칙:
 * - new       : 최초 등장(prev=null)           → {item_id}:new
 * - price_drop: failed_count 증가 또는 min_sale_price 감소 → {item_id}:drop:{failed_count}
 * - changed   : sale_date 변경 / correction·cancellation 증가 / status 변경 → {item_id}:chg:{state_hash}
 * - cancelled : status 가 취하·정지 계열로 전이 → {item_id}:cancel
 */

/** 이벤트 타입 유니온. */
export type EventType = 'new' | 'price_drop' | 'changed' | 'cancelled';

/** 생성된 이벤트 후보. */
export interface EventCandidate {
  readonly type: EventType;
  readonly dedupKey: string;
  readonly payload: Record<string, unknown>;
}

/** 취하·정지 계열 상태 판정 키워드. */
const CANCELLED_KEYWORDS = ['취하', '정지', '취소', '기각'] as const;

/** status 가 취하·정지 계열인지 판정한다. */
function isCancelledStatus(status: string | null): boolean {
  if (status === null) return false;
  return CANCELLED_KEYWORDS.some((kw) => status.includes(kw));
}

/**
 * 이전/다음 상태를 비교해 이벤트 후보를 생성한다.
 *
 * @param prev 이전 상태 (없으면 null → 신건)
 * @param next 다음 상태
 */
export function generateEvents(prev: ItemState | null, next: ItemState): EventCandidate[] {
  const id = next.itemId;

  // 최초 등장 → new 이벤트만.
  if (prev === null) {
    return [
      {
        type: 'new',
        dedupKey: `${id}:new`,
        payload: {
          appraisedPrice: next.appraisedPrice ?? null,
          minSalePrice: next.minSalePrice,
          saleDate: next.nextSaleDate,
          failedCount: next.failedCount,
        },
      },
    ];
  }

  const events: EventCandidate[] = [];

  // price_drop: 유찰 증가 또는 최저가 하락
  const failedIncreased = next.failedCount > prev.failedCount;
  const priceDecreased =
    prev.minSalePrice !== null && next.minSalePrice !== null && next.minSalePrice < prev.minSalePrice;
  if (failedIncreased || priceDecreased) {
    events.push({
      type: 'price_drop',
      dedupKey: `${id}:drop:${next.failedCount}`,
      payload: {
        before: { minSalePrice: prev.minSalePrice, failedCount: prev.failedCount },
        after: { minSalePrice: next.minSalePrice, failedCount: next.failedCount },
      },
    });
  }

  // cancelled 는 status 기반 changed 보다 우선한다 (한 전이당 하나의 상태 이벤트).
  const cancelTransition = !isCancelledStatus(prev.status) && isCancelledStatus(next.status);
  if (cancelTransition) {
    events.push({
      type: 'cancelled',
      dedupKey: `${id}:cancel`,
      payload: {
        before: { status: prev.status },
        after: { status: next.status },
      },
    });
    return events;
  }

  // changed: 기일 변경 / correction·cancellation 증가 / status 변경
  const changed =
    next.nextSaleDate !== prev.nextSaleDate ||
    next.correctionCount > prev.correctionCount ||
    next.cancellationCount > prev.cancellationCount ||
    next.status !== prev.status;
  if (changed) {
    events.push({
      type: 'changed',
      dedupKey: `${id}:chg:${stateHash(next)}`,
      payload: {
        before: {
          nextSaleDate: prev.nextSaleDate,
          correctionCount: prev.correctionCount,
          cancellationCount: prev.cancellationCount,
          status: prev.status,
        },
        after: {
          nextSaleDate: next.nextSaleDate,
          correctionCount: next.correctionCount,
          cancellationCount: next.cancellationCount,
          status: next.status,
        },
      },
    });
  }

  return events;
}
