/**
 * 단지명 정규화(apt_name_norm). (REQ-004)
 *
 * core 의 정규화 철학(전각 → 반각, 공백 제거)을 미러링하되, 단지명 특화 규칙을 더한다:
 * - 공백/탭/전각공백 제거
 * - 괄호(및 내부 내용) 제거: "청라한양수자인(1단지)" → "청라한양수자인"
 * - "아파트" 접미 제거: "청라자이아파트" → "청라자이"
 * - 숫자 단지 통일: "청라 3 단지" / "청라제3단지" → "청라3단지"
 *
 * 정규화는 매칭(포함 비교)의 안정성을 위해 소문자 변환은 하지 않는다(한글 위주).
 */

/** 전각(FULLWIDTH) 영숫자/기호를 반각으로 변환한다. (core caseNumber 규칙 미러) */
function toHalfWidth(input: string): string {
  let out = '';
  for (const ch of input) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0xff01 && code <= 0xff5e) {
      out += String.fromCodePoint(code - 0xfee0);
    } else if (code === 0x3000) {
      out += ' ';
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * 단지명을 정규화한다.
 *
 * @param raw 원문 단지명(전각/공백/괄호/접미 포함 가능).
 * @returns 정규화 단지명. 입력이 비면 빈 문자열.
 */
export function aptNameNorm(raw: string | null | undefined): string {
  if (!raw) return '';
  let s = toHalfWidth(raw);
  // 괄호(반각/전각)와 내부 내용 제거.
  s = s.replace(/[([{（【][^)\]}）】]*[)\]}）】]/g, '');
  // "제3단지" → "3단지" (숫자 단지 표기 통일: "제" 접두 제거)
  s = s.replace(/제\s*(\d+)\s*단지/g, '$1단지');
  // "3 단지" → "3단지" (숫자와 "단지" 사이 공백 제거)
  s = s.replace(/(\d+)\s*단지/g, '$1단지');
  // 모든 공백류 제거.
  s = s.replace(/\s+/g, '');
  // "아파트" 접미 제거(끝에 붙은 경우만).
  s = s.replace(/아파트$/g, '');
  return s.trim();
}
