/**
 * @auction-radar/enrich — 실거래가 결합 · 중위값 할인율 · 신뢰도 등급. (SPEC-ENRICH-001)
 *
 * 공개 표면. 소비자(SPEC-ALERT-001 렌더러 슬롯, SPEC-UI-001 대시보드, CLI sync)가
 * 소비하는 계약을 export 한다.
 */

/** 패키지 버전 마커. */
export const ENRICH_PACKAGE_VERSION = '0.1.0' as const;

// 타입 계약 (REQ-011, 결정 D5)
export type { Confidence, EnrichResult, EnrichTarget, RtTradeRecord } from './types.js';

// 설정 (REQ-001)
export { resolveEnrichConfig, DEFAULT_MOLIT_BASE_URL } from './config.js';
export type { EnrichConfig, EnrichConfigInput } from './config.js';

// 오케스트레이터 (REQ-002/003/005)
export { enrichUndelivered, computeResult, loadEnrichTargets } from './enrich.js';
export type { EnrichDeps } from './enrich.js';

// MOLIT 클라이언트 & 파서 (REQ-001/010, 결정 D1/D2/D3)
export { MolitClient, DEFAULT_NUM_OF_ROWS } from './molit/client.js';
export type { MolitFetchLike, MolitFetchResponse } from './molit/client.js';
export { parseMolitResponse, manwonToWon } from './molit/parser.js';
export type { ParsedMolitPage } from './molit/parser.js';

// 캐시 (REQ-002)
export {
  refreshRtTradesCache,
  shouldRefresh,
  writeTrades,
  loadTradesForLawd,
  last12Months,
} from './cache/rtTradesCache.js';
export type { RefreshSummary, RefreshDeps } from './cache/rtTradesCache.js';

// 정규화 (REQ-004)
export { aptNameNorm } from './normalize/aptName.js';

// 매칭 (REQ-004)
export { selectCandidates } from './match/candidates.js';
export type { CandidateResult } from './match/candidates.js';

// 통계 (REQ-006)
export { median, mean } from './stats/median.js';
export { discountRate } from './discount/discount.js';

// 등급 (REQ-008/009)
export { gradeConfidence } from './grade/confidence.js';
export type { GradeInput, GradeResult } from './grade/confidence.js';

// 렌더 어댑터 (REQ-011)
export { toEnrichInfo, confidenceLabel } from './render/toEnrichInfo.js';
export type { EnrichInfoLike } from './render/toEnrichInfo.js';
