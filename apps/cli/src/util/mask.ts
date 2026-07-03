/**
 * 비밀값 마스킹 유틸. (CLI-REQ-005, AC-07)
 *
 * 텔레그램 봇 토큰·MOLIT 키를 로그·콘솔·doctor 출력에 평문 노출하지 않는다.
 * 마지막 4자만 남기고 앞부분은 말줄임표(…)로 가린다.
 */

/** 말줄임 접두(U+2026). */
const ELLIPSIS = '…';

/** 노출 유지할 꼬리 글자 수. */
const VISIBLE_TAIL = 4;

/**
 * 비밀 토큰을 마스킹한다.
 *
 * 예) "123456:ABCdefGHI" → "…fGHI" (마지막 4자만 노출).
 * 4자 이하이면 전부 가린다("…").
 *
 * @param token 마스킹할 원문 토큰(빈 문자열이면 그대로 반환).
 */
export function maskToken(token: string): string {
  if (token.length === 0) return '';
  if (token.length <= VISIBLE_TAIL) return ELLIPSIS;
  return `${ELLIPSIS}${token.slice(-VISIBLE_TAIL)}`;
}

/**
 * 임의 문자열에서 알려진 비밀값들을 마스킹 형태로 치환한다(sweep).
 *
 * sync 오류 로그 등 자유 텍스트에 비밀값이 섞여 들어가는 것을 방어한다.
 * 긴 비밀값부터 치환해 부분 문자열 충돌을 피한다.
 *
 * @param text   원문 텍스트.
 * @param secrets 가릴 비밀값 목록(빈 값/undefined 는 무시).
 */
export function maskSecrets(text: string, secrets: ReadonlyArray<string | undefined>): string {
  const targets = secrets
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .sort((a, b) => b.length - a.length);

  let out = text;
  for (const secret of targets) {
    out = out.split(secret).join(maskToken(secret));
  }
  return out;
}
