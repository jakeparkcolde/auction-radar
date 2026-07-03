import { describe, expect, it } from 'vitest';
// @ts-expect-error — .mjs 빌드 스크립트(타입 없음, eslint/tsc 대상 아님).
import { buildDashboardHtml } from '../scripts/build-html.mjs';

/**
 * 단일 HTML 인라인 빌드 산출물 정적 검사. (SPEC-UI-001 REQ-003, AC-05)
 *
 * esbuild 로 실제 번들한 결과에 외부 URL·에셋 참조가 0건임을 검증한다(오프라인 완전 동작).
 */
describe('빌드 산출물 외부 URL 0건 (AC-05)', () => {
  it('인라인 HTML 에 http(s)·@import·외부 src/link·url(http) 이 없다', async () => {
    const { html, violations } = (await buildDashboardHtml()) as {
      html: string;
      violations: string[];
    };
    expect(violations).toEqual([]);
    expect(html).not.toMatch(/https?:\/\//i);
    expect(html).not.toMatch(/@import/i);
    expect(html).not.toMatch(/<link\b[^>]*\bhref\s*=/i);
    expect(html).not.toMatch(/<script\b[^>]*\bsrc\s*=/i);
  });

  it('CSS·JS 가 인라인되어 단일 HTML 로 자립한다', async () => {
    const { html } = (await buildDashboardHtml()) as { html: string };
    expect(html).toContain('<style>');
    expect(html).toContain('<script>');
    expect(html).toContain('id="app"');
    // 시스템 폰트 스택만 사용(웹폰트 없음).
    expect(html).toContain('-apple-system');
  });
});
