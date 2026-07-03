/**
 * 순수 표시 포맷 유틸. (SPEC-UI-001 REQ-004/005/006)
 *
 * 가격(억/만)·D-day·강조 규칙·법원 링크는 공유 유틸을 재사용한다(단일 소스 — 표기 불일치 방지).
 *  - formatKRW / DISCLAIMER / daysUntilKST / enrichEmphasized : @auction-radar/alert
 *  - courtAuctionUrl : @auction-radar/core
 */

export { formatKRW, DISCLAIMER, daysUntilKST, enrichEmphasized } from '@auction-radar/alert';
export { courtAuctionUrl } from '@auction-radar/core';

/** 유니코드 마이너스 사인(U+2212) — 알림 렌더러와 동일 표기. */
const MINUS = '−';

/**
 * 부호 있는 퍼센트 표기(예: -32 → "−32%"). 알림 렌더러 signedPercent 와 동일 출력.
 *
 * @param pct 정수 퍼센트(음수면 할인).
 */
export function signedPercentText(pct: number): string {
  const sign = pct < 0 ? MINUS : pct > 0 ? '+' : '';
  return `${sign}${Math.abs(pct)}%`;
}

/** 이벤트 타입 → 한국어 라벨(타임라인 표시용). */
const EVENT_LABELS: Record<string, string> = {
  new: '신건',
  price_drop: '유찰',
  changed: '변경',
  cancelled: '취하',
  d7: 'D-7',
  d1: 'D-1',
};

/**
 * 이벤트 타입 라벨을 반환한다(미지의 타입은 원문 그대로).
 *
 * @param type 이벤트 타입.
 */
export function eventLabel(type: string): string {
  return EVENT_LABELS[type] ?? type;
}
