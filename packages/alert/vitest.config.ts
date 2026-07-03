import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// @auction-radar/store·core 를 소스로 alias 해 테스트가 dist 빌드에 의존하지 않게 한다.
const storeSrc = fileURLToPath(new URL('../store/src/index.ts', import.meta.url));
const coreSrc = fileURLToPath(new URL('../core/src/index.ts', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@auction-radar/store': storeSrc,
      '@auction-radar/core': coreSrc,
    },
  },
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/index.ts',
        'src/**/index.ts',
        'src/types.ts',
        'src/migrations.ts',
        'src/testing/**',
        'src/**/*.d.ts',
      ],
      thresholds: {
        lines: 85,
        functions: 85,
        statements: 85,
        branches: 80,
      },
    },
  },
});
