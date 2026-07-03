import { DISCLAIMER } from '@auction-radar/alert';

/**
 * 면책 고지 재노출. (CLI-REQ-014)
 *
 * ALERT 의 DISCLAIMER("공고 시점 기준 · 입찰 전 원문/등기부 재확인")를 단일 출처로
 * 재-export 하고, 모든 사용자 노출 출력 경로가 붙일 수 있는 헬퍼를 제공한다.
 */
export { DISCLAIMER };

/** 고지 라인(⚠️ 접두). 모든 명령의 출력 말미에 붙인다. */
export const DISCLAIMER_LINE = `⚠️ ${DISCLAIMER}` as const;

/**
 * 본문 뒤에 면책 고지 라인을 붙인다.
 *
 * @param body 사용자 노출 본문(빈 문자열이면 고지만 반환).
 */
export function withDisclaimer(body: string): string {
  if (body.length === 0) return DISCLAIMER_LINE;
  return `${body}\n${DISCLAIMER_LINE}`;
}
