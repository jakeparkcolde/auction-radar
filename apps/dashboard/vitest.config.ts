import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// 워크스페이스 패키지를 소스로 alias 해 테스트가 dist 빌드에 의존하지 않게 한다. (CLI 설정과 동일 패턴)
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
    // 기본 환경은 node. 클라이언트(DOM) 테스트만 파일 상단 `// @vitest-environment happy-dom` 로 전환한다.
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // 커버리지 임계값(85/80) 대상: 데이터 레이어(query·store)·렌더 유틸(render) 만.
      // Vitest 4 는 coverage.all 을 제거했고 include 에 매칭되는 모든 파일을 측정한다
      //  (미테스트 파일도 0% 로 드러남 — 구 all:true 와 동일 효과). (계획서 §5, 결정 D6)
      // 마크업/배선 레이어는 스냅샷·통합 테스트로 검증하므로 로직 임계값에서 제외한다:
      //  - src/server.ts   : node:http 배선(엔드포인트 라우팅) — 서버 통합 테스트로 커버.
      //  - src/client/**   : 브라우저 DOM 마크업 렌더러 — happy-dom mount-and-assert 로 커버.
      include: ['src/query/**/*.ts', 'src/render/**/*.ts', 'src/store/**/*.ts'],
      exclude: ['src/**/*.d.ts'],
      thresholds: {
        lines: 85,
        functions: 85,
        statements: 85,
        branches: 80,
      },
    },
  },
});
