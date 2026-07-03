// 단일 HTML 인라인 빌드. (SPEC-UI-001 REQ-003, AC-05, 결정 D6)
//
// esbuild 로 client/main.ts(JS)·styles.css(CSS)를 번들·최소화한 뒤,
// <style>/<script> 로 인라인한 단일 dist/index.html 을 생성한다(외부 요청 0건).
// 빌드 직후 외부 URL 정적 검사 게이트를 통과해야 한다.

import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const clientEntry = join(root, 'src/client/main.ts');
const cssEntry = join(root, 'src/client/styles.css');

/** 외부 URL/에셋 참조 정적 검사 패턴. (AC-05) */
const FORBIDDEN_PATTERNS = [
  /https?:\/\//i, // 절대 http(s) URL
  /@import/i, // CSS 외부 import
  /url\(\s*['"]?\s*(?:https?:)?\/\//i, // url(http/https/protocol-relative)
  /<link\b[^>]*\bhref\s*=/i, // 외부 <link>
  /<script\b[^>]*\bsrc\s*=/i, // 외부 <script src>
  /<img\b[^>]*\bsrc\s*=\s*['"]?https?:/i, // 외부 이미지
];

/**
 * 단일 HTML(에셋 인라인) 문자열을 만든다.
 *
 * @returns { html, violations } 산출 HTML 과 위반 패턴 목록.
 */
export async function buildDashboardHtml() {
  const jsResult = await build({
    entryPoints: [clientEntry],
    bundle: true,
    minify: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2020'],
    write: false,
  });
  const cssResult = await build({
    entryPoints: [cssEntry],
    bundle: true,
    minify: true,
    loader: { '.css': 'css' },
    write: false,
  });

  const js = jsResult.outputFiles[0].text;
  const css = cssResult.outputFiles[0].text;

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>auction-radar 대시보드</title>
<style>${css}</style>
</head>
<body>
<div id="app"></div>
<script>${js}</script>
</body>
</html>
`;

  const violations = [];
  for (const pattern of FORBIDDEN_PATTERNS) {
    const m = html.match(pattern);
    if (m) violations.push(`${pattern} → ${m[0]}`);
  }

  return { html, violations };
}

/** 빌드 후 dist/index.html 로 쓴다. 위반 시 종료 코드 1. */
async function main() {
  const { html, violations } = await buildDashboardHtml();
  if (violations.length > 0) {
    console.error('외부 URL 정적 검사 실패(AC-05):');
    for (const v of violations) console.error(`  - ${v}`);
    process.exit(1);
  }
  const distDir = join(root, 'dist');
  mkdirSync(distDir, { recursive: true });
  writeFileSync(join(distDir, 'index.html'), html, 'utf8');
  console.log(`dist/index.html 생성 완료 (${html.length} bytes · 외부 URL 0건)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
