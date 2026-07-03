import { htmlEscape } from '../notifier/htmlEscape.js';

/**
 * 메시지 렌더러. (SPEC-ALERT-001 REQ-010/011/017, 기획서 §6.5)
 *
 * - §6.5 HTML 템플릿을 따른다(parse_mode=HTML).
 * - 가격: 원 단위 정수 → 억/만 환산(소수 둘째 자리 반올림), 1억 미만 "8,450만".
 * - 가격 라인 "3.2억 → 2.56억 (−20%)" 은 payload 의 전/후 값으로 렌더링(재계산 아님 = DB 현재값 재조회 금지).
 * - 모든 스크랩 유래 문자열은 htmlEscape 후 삽입.
 * - 면책 고지 "공고 시점 기준 · 입찰 전 원문/등기부 재확인" 은 항상 포함.
 * - enrich 할인율 라인은 데이터 존재 시에만 포함(부재 시 나머지 포맷 그대로).
 */

/** 이벤트 종류(라벨 매핑용). */
export type RenderEventType = 'new' | 'price_drop' | 'changed' | 'cancelled' | 'd7' | 'd1';

/** 실거래 할인율 슬롯(SPEC-ENRICH-001 데이터). */
export interface EnrichInfo {
  /** 중위값 대비 할인율(%) — 음수면 저가. */
  readonly discountPct: number;
  /** 표본 수. */
  readonly sampleSize: number;
  /** 신뢰도 등급 라벨(예: "높음"). */
  readonly confidence: string;
}

/** 렌더링 입력(매처/커서가 DB row 로부터 구성). */
export interface RenderInput {
  readonly eventType: RenderEventType;
  /** 법원명(예: "인천지방법원"). */
  readonly courtName: string;
  /** 사건번호(예: "2025타경12345"). */
  readonly caseNumber: string;
  /** 정규화 지역(예: "인천 서구"). */
  readonly region?: string | null;
  /** 소재지 상세/원문. */
  readonly addressDetail?: string | null;
  /** 면적 표기(예: "74㎡"). */
  readonly area?: string | null;
  /** 원문 용도(예: "아파트"). */
  readonly usage?: string | null;
  /** payload 전 최저가(원). */
  readonly beforePrice?: number | null;
  /** payload 후(현재) 최저가(원). */
  readonly afterPrice?: number | null;
  /** 유찰 횟수. */
  readonly failedCount?: number | null;
  /** 매각기일(YYYY-MM-DD). */
  readonly saleDate?: string | null;
  /** D-day 카운트(양수). d7/d1 및 기일 표기용. */
  readonly dday?: number | null;
  /** 원문 링크. */
  readonly sourceUrl?: string | null;
  /** enrich 할인율(부재 시 라인 생략). */
  readonly enrich?: EnrichInfo | null;
}

/** 면책 고지 문구(모든 사용자 노출 메시지에 포함). */
export const DISCLAIMER = '공고 시점 기준 · 입찰 전 원문/등기부 재확인' as const;

/** 이벤트 종류 → 라벨. */
const LABELS: Record<RenderEventType, string> = {
  new: '신건',
  price_drop: '유찰',
  changed: '변경',
  cancelled: '취하',
  d7: 'D-7',
  d1: 'D-1',
};

/** 유니코드 마이너스 사인(U+2212) — 기획서 §6.5 표기. */
const MINUS = '−';

/** 소수 불필요 시 정수로, 필요 시 최대 2자리로 문자열화(트레일링 0 제거). */
function trimNumber(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/**
 * 원 단위 정수를 억/만 표기로 환산한다.
 *
 * - 1억 이상: 억 단위, 소수 둘째 자리 반올림(예: 320000000 → "3.2억", 256000000 → "2.56억").
 * - 1억 미만: 만 단위 정수 + 천단위 콤마(예: 84500000 → "8,450만").
 */
export function formatKRW(won: number): string {
  const abs = Math.abs(won);
  if (abs >= 1e8) {
    return `${trimNumber(won / 1e8)}억`;
  }
  const man = Math.round(won / 1e4);
  return `${man.toLocaleString('en-US')}만`;
}

/** 전/후 최저가로 하락률(%) 정수를 계산한다. */
function discountPercent(before: number, after: number): number {
  if (before === 0) return 0;
  return Math.round(((after - before) / before) * 100);
}

/** 부호 있는 퍼센트 표기(예: -20 → "−20%"). */
function signedPercent(pct: number): string {
  const sign = pct < 0 ? MINUS : pct > 0 ? '+' : '';
  return `${sign}${Math.abs(pct)}%`;
}

/** 가격 라인을 구성한다(전/후가 있으면 화살표 표기). */
function priceLine(input: RenderInput): string | null {
  const { beforePrice, afterPrice, failedCount } = input;
  const failedSuffix =
    typeof failedCount === 'number' && failedCount > 0 ? ` · 유찰 ${failedCount}회` : '';

  if (typeof beforePrice === 'number' && typeof afterPrice === 'number' && beforePrice !== afterPrice) {
    const pct = signedPercent(discountPercent(beforePrice, afterPrice));
    return `💰 최저가 ${formatKRW(beforePrice)} → <b>${formatKRW(afterPrice)}</b> (${pct})${failedSuffix}`;
  }
  if (typeof afterPrice === 'number') {
    return `💰 최저가 <b>${formatKRW(afterPrice)}</b>${failedSuffix}`;
  }
  return null;
}

/** enrich 할인율 라인(부재 시 null). */
function enrichLine(enrich: EnrichInfo | null | undefined): string | null {
  if (!enrich) return null;
  const pct = signedPercent(enrich.discountPct);
  const conf = htmlEscape(enrich.confidence);
  return `📊 인근 실거래 중위값 대비 <b>${pct}</b> (표본 ${enrich.sampleSize}건 · 신뢰도 ${conf})`;
}

/** 매각기일 라인(기일/ D-day 존재 시). */
function saleDateLine(input: RenderInput): string | null {
  if (!input.saleDate) return null;
  const dday =
    typeof input.dday === 'number' ? ` (D-${input.dday})` : '';
  return `📅 매각기일 ${htmlEscape(input.saleDate)}${dday}`;
}

/**
 * RenderInput 을 HTML 메시지 문자열로 렌더링한다.
 *
 * 면책 고지는 항상 마지막 줄에 포함된다.
 */
export function renderMessage(input: RenderInput): string {
  const label = LABELS[input.eventType];
  const court = htmlEscape(input.courtName);
  const caseNo = htmlEscape(input.caseNumber);

  const locParts = [input.region, input.addressDetail, input.area]
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .map(htmlEscape);
  const usage = input.usage ? ` (${htmlEscape(input.usage)})` : '';

  const lines: string[] = [];
  lines.push(`🔔 <b>[${label}]</b> ${court} ${caseNo}`);
  if (locParts.length > 0) {
    lines.push(`📍 ${locParts.join(' ')}${usage}`);
  }
  const price = priceLine(input);
  if (price) lines.push(price);
  const enrich = enrichLine(input.enrich);
  if (enrich) lines.push(enrich);
  const saleDate = saleDateLine(input);
  if (saleDate) lines.push(saleDate);
  if (input.sourceUrl) {
    lines.push(`🔗 <a href="${htmlEscape(input.sourceUrl)}">법원 원문 보기</a>`);
  }
  lines.push(`⚠️ ${DISCLAIMER}`);

  return lines.join('\n');
}
