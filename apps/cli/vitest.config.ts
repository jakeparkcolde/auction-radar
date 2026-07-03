import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// 워크스페이스 패키지를 소스로 alias 해 테스트가 dist 빌드에 의존하지 않게 한다.
const storeSrc = fileURLToPath(new URL('../../packages/store/src/index.ts', import.meta.url));
const coreSrc = fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url));
const alertSrc = fileURLToPath(new URL('../../packages/alert/src/index.ts', import.meta.url));
const enrichSrc = fileURLToPath(new URL('../../packages/enrich/src/index.ts', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@auction-radar/store': storeSrc,
      '@auction-radar/core': coreSrc,
      '@auction-radar/alert': alertSrc,
      '@auction-radar/enrich': enrichSrc,
    },
  },
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // D3: 비-로직 어댑터만 커버리지 제외한다.
      //  - src/index.ts       : bin 진입점(shebang → program.parse) — 실 의존성 wiring 전용.
      //  - src/wizard/prompts.ts : @inquirer/prompts 어댑터 — 순수 로직 없음(입출력 포트).
      // 그 외 모든 로직 모듈(program·commands·config·mask·telegram·store)은 ≥85% 를 만족한다.
      exclude: ['src/index.ts', 'src/wizard/prompts.ts', 'src/**/*.d.ts'],
      thresholds: {
        lines: 85,
        functions: 85,
        statements: 85,
        branches: 80,
      },
    },
  },
});
