/**
 * HTML 이스케이프 유틸. (SPEC-ALERT-001 REQ-011, AC-10, 결정 D4)
 *
 * 스크랩 원문에서 유래한 모든 보간 문자열(case_name, 주소, remarks 등)은
 * 텔레그램 parse_mode=HTML 로 삽입되기 전에 반드시 이스케이프해야 한다.
 *
 * 정확히 `&`, `<`, `>` 3종만 이스케이프한다(따옴표는 그대로 둔다).
 * 텔레그램 HTML 파서는 `"` 를 특수문자로 보지 않으므로 이스케이프 불필요이며,
 * AC-10 기대값을 그대로 만족한다:
 *   htmlEscape('<b>주의</b> & "특약"') === '&lt;b&gt;주의&lt;/b&gt; &amp; "특약"'
 *
 * `&` 를 가장 먼저 치환해야 이후 `&lt;`/`&gt;` 의 `&` 가 재이스케이프되지 않는다.
 */
export function htmlEscape(input: string): string {
  return input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
