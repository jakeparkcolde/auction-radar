import type { EnrichInfoLike } from '@auction-radar/enrich';
import type { ItemRow } from '../query/items.js';
import type { EventRow } from '../query/events.js';
import type { WatchlistMatchRow } from '../query/matches.js';
import type { SyncStatus } from '../query/status.js';
import {
  courtAuctionUrl,
  daysUntilKST,
  DISCLAIMER,
  enrichEmphasized,
  eventLabel,
  formatKRW,
  signedPercentText,
} from './format.js';

/**
 * 대시보드 뷰 모델 조립. (SPEC-UI-001)
 *
 * 순수 함수 — 이미 조회된 원시 행(query 레이어 산출)을 표시용 JSON 으로 변환한다.
 * 서버는 이 결과를 /api/data 로 전달하고, 클라이언트는 JSON 만 소비해 DOM 을 렌더한다.
 * 법원 링크·가격·D-day·강조를 서버 사이드에서 계산하므로 빌드된 HTML 셸에 외부 URL 이 없다. (AC-05)
 */

/** enrich 표시 뷰(부재 시 item.enrich = null). */
export interface EnrichView {
  /** 부호 있는 할인율 정수(음수=할인). */
  readonly discountPct: number;
  /** 표시 문자열(예: "−32%"). */
  readonly discountText: string;
  /** 표본 수. */
  readonly sampleSize: number;
  /** 신뢰도 표시 라벨(예: "높음", "참고치 (표본 부족)"). */
  readonly confidence: string;
  /** 강조(굵게) 허용 여부 — 클라이언트가 CSS 로 굵게 처리. (결정 D5) */
  readonly emphasize: boolean;
}

/** 물건 표시 뷰. */
export interface ItemView {
  readonly id: number;
  readonly courtCode: string;
  readonly caseNumber: string;
  readonly caseName: string | null;
  readonly usage: string | null;
  readonly usageCategory: string | null;
  readonly region: string | null;
  readonly addressDetail: string | null;
  /** 감정가(억/만 환산). 없으면 null. */
  readonly appraisedPriceText: string | null;
  /** 최저매각가(억/만 환산). 없으면 null. */
  readonly minSalePriceText: string | null;
  /** 감정가 원 단위 정수(정렬·필터용). 없으면 null. */
  readonly appraisedPrice: number | null;
  /** 최저매각가 원 단위 정수(정렬·필터용). 없으면 null. */
  readonly minSalePrice: number | null;
  readonly failedCount: number;
  /** 매각기일(YYYY-MM-DD). 없으면 null. */
  readonly saleDate: string | null;
  /** D-day(양수=미래). 없으면 null. */
  readonly dday: number | null;
  /** 법원 원문 링크. */
  readonly courtUrl: string;
  /** enrich 표시(부재 시 null — AC-07). */
  readonly enrich: EnrichView | null;
}

/** 이벤트 타임라인 뷰. */
export interface EventView {
  readonly id: number;
  readonly type: string;
  readonly label: string;
  readonly createdAt: string;
  readonly caseNumber: string;
  readonly region: string | null;
}

/** 워치리스트 뷰(필터·매칭 카운트). */
export interface WatchlistView {
  readonly id: number;
  readonly name: string;
  readonly matchCount: number;
  readonly enabled: boolean;
}

/** sync 상태 뷰(배너). */
export interface StatusView {
  readonly blocked: boolean;
  readonly hasError: boolean;
  readonly errorText: string | null;
  readonly lastSuccessAt: string | null;
  readonly latestFinishedAt: string | null;
  /** 차단 또는 실패 → 경고 배너 표시. (REQ-008) */
  readonly warn: boolean;
}

/** 전체 뷰 모델(/api/data 응답). */
export interface ViewModel {
  /** 스키마 존재 여부(false 면 초기 상태). (결정 D1, AC-09) */
  readonly schemaPresent: boolean;
  /** 물건·이벤트가 모두 없으면 true → "데이터 없음" 안내. (AC-09) */
  readonly empty: boolean;
  /** 면책 고지(모든 화면 고정). (REQ-006) */
  readonly disclaimer: string;
  /** 생성 시각 ISO. */
  readonly generatedAt: string;
  readonly status: StatusView;
  readonly watchlists: readonly WatchlistView[];
  readonly items: readonly ItemView[];
  readonly events: readonly EventView[];
  /** D-7 이내 임박 물건(상단 고정 섹션). (REQ-009) */
  readonly imminent: readonly ItemView[];
}

/** 물건 + (선택)enrich 페어. */
export interface ItemWithEnrich {
  readonly row: ItemRow;
  readonly enrich: EnrichInfoLike | null;
}

/** 뷰 모델 조립 입력. */
export interface ViewModelInput {
  readonly schemaPresent: boolean;
  readonly now: Date;
  readonly items: readonly ItemWithEnrich[];
  readonly events: readonly EventRow[];
  readonly watchlists: readonly WatchlistMatchRow[];
  readonly status: SyncStatus;
}

/** enrich 어댑터 출력 → 표시 뷰. */
function toEnrichView(enrich: EnrichInfoLike): EnrichView {
  return {
    discountPct: enrich.discountPct,
    discountText: signedPercentText(enrich.discountPct),
    sampleSize: enrich.sampleSize,
    confidence: enrich.confidence,
    // 강조 규칙 단일 소스(결정 D5): 낮음/참고치(emphasize=false)는 굵게 표시 금지.
    emphasize: enrichEmphasized(enrich),
  };
}

/**
 * 단일 물건 행 + enrich 를 표시 뷰로 변환한다.
 *
 * @param row    물건 행.
 * @param enrich enrich 어댑터 출력(없으면 null).
 * @param now    D-day 기준 시각.
 */
export function buildItemView(
  row: ItemRow,
  enrich: EnrichInfoLike | null,
  now: Date,
): ItemView {
  const saleDate = row.next_sale_date ?? row.latest_sale_date;
  return {
    id: row.id,
    courtCode: row.court_code,
    caseNumber: row.case_number,
    caseName: row.case_name,
    usage: row.usage,
    usageCategory: row.usage_category,
    region: row.region_norm,
    addressDetail: row.address_raw,
    appraisedPriceText: row.appraised_price === null ? null : formatKRW(row.appraised_price),
    minSalePriceText: row.min_sale_price === null ? null : formatKRW(row.min_sale_price),
    appraisedPrice: row.appraised_price,
    minSalePrice: row.min_sale_price,
    failedCount: row.failed_count,
    saleDate,
    dday: saleDate ? daysUntilKST(saleDate, now) : null,
    courtUrl: courtAuctionUrl(row.court_code, row.case_number),
    enrich: enrich ? toEnrichView(enrich) : null,
  };
}

/** 이벤트 행 → 타임라인 뷰. */
function buildEventView(row: EventRow): EventView {
  return {
    id: row.id,
    type: row.type,
    label: eventLabel(row.type),
    createdAt: row.created_at,
    caseNumber: row.case_number,
    region: row.region_norm,
  };
}

/** sync 상태 → 배너 뷰. */
function buildStatusView(status: SyncStatus): StatusView {
  const blocked = status.latest?.blocked === 1;
  const hasError = status.latest?.error != null;
  return {
    blocked,
    hasError,
    errorText: status.latest?.error ?? null,
    lastSuccessAt: status.lastSuccessAt,
    latestFinishedAt: status.latest?.finished_at ?? null,
    warn: blocked || hasError,
  };
}

/**
 * 전체 뷰 모델을 조립한다(순수).
 *
 * @param input 조회된 원시 행 + 기준 시각 + 스키마 플래그.
 */
export function buildViewModel(input: ViewModelInput): ViewModel {
  const items = input.items.map((it) => buildItemView(it.row, it.enrich, input.now));
  const events = input.events.map(buildEventView);
  const watchlists = input.watchlists.map((w) => ({
    id: w.watchlist_id,
    name: w.name,
    matchCount: w.match_count,
    enabled: w.enabled === 1,
  }));
  // D-7 이내(당일 포함) 임박 물건 — 매각기일이 지나지 않은 것만. (REQ-009)
  const imminent = items.filter((it) => it.dday !== null && it.dday >= 0 && it.dday <= 7);

  return {
    schemaPresent: input.schemaPresent,
    empty: items.length === 0 && events.length === 0,
    disclaimer: DISCLAIMER,
    generatedAt: input.now.toISOString(),
    status: buildStatusView(input.status),
    watchlists,
    items,
    events,
    imminent,
  };
}
