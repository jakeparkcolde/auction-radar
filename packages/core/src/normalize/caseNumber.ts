/**
 * 사건번호 정규화. (REQ-012)
 *
 * 규칙:
 * 1. 전각 문자를 반각으로 변환 (예: ２０２５ → 2025, 타경은 한글이라 유지)
 * 2. 모든 공백 제거
 * 3. "2025타경12345" 표준형으로 정리
 *
 * 정규화 함수는 테스트 벡터로 검증된다.
 */

/** 전각(FULLWIDTH) 영숫자/기호를 반각으로 변환한다. */
function toHalfWidth(input: string): string {
  let out = '';
  for (const ch of input) {
    const code = ch.codePointAt(0) ?? 0;
    // 전각 ASCII 영역(U+FF01–U+FF5E) → 반각(U+0021–U+007E)
    if (code >= 0xff01 && code <= 0xff5e) {
      out += String.fromCodePoint(code - 0xfee0);
    } else if (code === 0x3000) {
      // 전각 공백 → 일반 공백 (이후 제거됨)
      out += ' ';
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * 사건번호를 표준형으로 정규화한다.
 *
 * @param raw 원문 사건번호 (전각/공백 포함 가능)
 * @returns 정규화된 사건번호. 입력이 비면 빈 문자열.
 */
export function normalizeCaseNumber(raw: string): string {
  if (!raw) return '';
  const half = toHalfWidth(raw);
  // 모든 공백류(스페이스/탭/개행) 제거
  return half.replace(/\s+/g, '').trim();
}
