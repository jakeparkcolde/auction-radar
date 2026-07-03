/**
 * 용도 매핑표. (기획서 §6.4, REQ-019)
 *
 * 원문 usage(예: "아파트", "연립주택", "다세대주택", "근린생활시설")를
 * 표준 카테고리(아파트/빌라/오피스텔/상가/토지/기타)로 접는다.
 * 미매핑 용도는 "기타"로 흘리고 경고를 남긴다.
 *
 * good-first-issue: 용도 매핑 케이스 추가는 이 표를 갱신한다(docs/usage-map.md 공개).
 */

/** 표준 용도 카테고리. */
export type UsageCategory = '아파트' | '빌라' | '오피스텔' | '상가' | '토지' | '기타';

/** 원문 용도 → 표준 카테고리 매핑표. */
export const USAGE_MAP: ReadonlyMap<string, UsageCategory> = new Map([
  ['아파트', '아파트'],
  ['주상복합', '아파트'],
  ['연립주택', '빌라'],
  ['다세대주택', '빌라'],
  ['연립다세대', '빌라'],
  ['빌라', '빌라'],
  ['다가구주택', '빌라'],
  ['오피스텔', '오피스텔'],
  ['근린생활시설', '상가'],
  ['근린상가', '상가'],
  ['상가', '상가'],
  ['점포', '상가'],
  ['상업용', '상가'],
  ['사무실', '상가'],
  ['토지', '토지'],
  ['대지', '토지'],
  ['임야', '토지'],
  ['전', '토지'],
  ['답', '토지'],
  ['과수원', '토지'],
  ['잡종지', '토지'],
  ['농지', '토지'],
]);

/** 용도 매핑 결과. */
export interface UsageMapping {
  readonly category: UsageCategory;
  /** 매핑표에 없어 "기타"로 폴백했는지 여부. */
  readonly unmapped: boolean;
  /** 경고 메시지(폴백 시에만). */
  readonly warning?: string;
}

/**
 * 원문 용도를 표준 카테고리로 매핑한다.
 *
 * @param raw 원문 용도 문자열
 * @returns 매핑 결과. 미매핑이면 category="기타", unmapped=true, warning 포함.
 */
export function mapUsage(raw: string | null | undefined): UsageMapping {
  const key = (raw ?? '').trim();
  const category = key ? USAGE_MAP.get(key) : undefined;
  if (category !== undefined) {
    return { category, unmapped: false };
  }
  return {
    category: '기타',
    unmapped: true,
    warning: `미매핑 용도 "${key}" → 기타로 분류됨`,
  };
}
