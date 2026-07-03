import type { Store } from '@auction-radar/store';
import {
  computeResult,
  last12Months,
  loadTradesForLawd,
  toEnrichInfo,
} from '@auction-radar/enrich';
import type { EnrichInfoLike, EnrichTarget } from '@auction-radar/enrich';
import type { ItemRow } from './items.js';

/**
 * 물건 × rt_trades 캐시 → enrich 순수 계산 → EnrichInfo. (SPEC-UI-001 REQ-005, AC-07)
 *
 * 소프트 의존: rt_trades 가 비어 있거나 lawd_cd 가 없으면 null 을 반환한다(라인 생략).
 * 읽기 전용 원칙: 캐시에서 읽기만 한다(loadTradesForLawd = store.query).
 * 실거래 캐시 갱신 함수 같은 쓰기·네트워크 경로는 절대 호출하지 않는다(음성 게이트로 강제).
 */

/**
 * 단일 물건의 enrich 표시 정보를 계산한다(부재 시 null).
 *
 * @param store 읽기 전용 스토어.
 * @param item  물건 행.
 * @param now   기준 시각(최근 12개월 캐시 범위 산정).
 */
export function enrichForItem(store: Store, item: ItemRow, now: Date): EnrichInfoLike | null {
  if (item.lawd_cd === null || item.min_sale_price === null) return null;

  const target: EnrichTarget = {
    eventId: item.id,
    lawdCd: item.lawd_cd,
    minSalePrice: item.min_sale_price,
    usage: item.usage,
    // items 스키마에 단지명·면적 전용 컬럼이 없어 best-effort(address_raw), 면적은 생략(폴백 경로). enrich 계약과 동일.
    aptName: item.address_raw,
    area: null,
  };

  const trades = loadTradesForLawd(store, item.lawd_cd, last12Months(now));
  const result = computeResult(target, trades);
  if (result === null) return null;
  return toEnrichInfo(result);
}
