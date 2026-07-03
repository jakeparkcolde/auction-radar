import { describe, expect, it } from 'vitest';
import { htmlEscape } from '../src/index.js';

describe('htmlEscape (REQ-011, AC-10, D4)', () => {
  it('AC-10: & < > 정확히 3종만 이스케이프하고 따옴표는 보존한다', () => {
    expect(htmlEscape('<b>주의</b> & "특약"')).toBe('&lt;b&gt;주의&lt;/b&gt; &amp; "특약"');
  });

  it('& 를 먼저 치환해 &lt;/&gt; 가 재이스케이프되지 않는다', () => {
    expect(htmlEscape('a<b>c')).toBe('a&lt;b&gt;c');
    expect(htmlEscape('1 & 2 & 3')).toBe('1 &amp; 2 &amp; 3');
  });

  it('작은/큰따옴표는 그대로 둔다', () => {
    expect(htmlEscape(`it's "quoted"`)).toBe(`it's "quoted"`);
  });

  it('이스케이프 대상이 없으면 원문 유지', () => {
    expect(htmlEscape('평범한 텍스트')).toBe('평범한 텍스트');
  });
});
