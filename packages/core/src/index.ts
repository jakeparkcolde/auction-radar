// 코어 공개 표면 (하위 SPEC 이 소비하는 계약)

// 타입
export type {
  CourtCode,
  DetailRequest,
  ItemState,
  ListRequest,
  RawEnvelope,
  SourceRecord,
  SourceResponse,
} from './types.js';

// 엔드포인트 상수
export { ENDPOINTS, ENDPOINTS_VERSION, DEFAULT_BASE_URL } from './endpoints.js';
export type { EndpointKey, EndpointSpec } from './endpoints.js';

// 정규화
export { normalizeCaseNumber, regionNorm } from './normalize/index.js';

// diff / 이벤트
export { serializeState, stateHash, generateEvents } from './diff/index.js';
export type { EventCandidate, EventType } from './diff/index.js';

// 용도 매핑
export { USAGE_MAP, mapUsage } from './usage-map.js';
export type { UsageCategory, UsageMapping } from './usage-map.js';

// 스로틀링 / budget
export {
  Throttler,
  HARD_MIN_DELAY_MS,
  systemClock,
  BudgetGuard,
  DEFAULT_MAX_CALLS,
  HARD_CAP_CALLS,
} from './throttle/index.js';
export type { Clock } from './throttle/index.js';

// 소스 클라이언트
export {
  FixtureSourceClient,
  HttpSourceClient,
  loadPlaywrightTransport,
} from './source/index.js';
export type {
  SourceClient,
  FixtureScript,
  BrowserTransport,
  HttpSourceClientOptions,
} from './source/index.js';

// 수집 오케스트레이션
export {
  runSync,
  currentAndNextMonth,
  SyncLock,
  applyRetention,
  parseRecord,
  ingestParsed,
  insertEvents,
} from './sync/index.js';
export type {
  Logger,
  SyncDeps,
  SyncResult,
  RetentionOptions,
  RetentionResult,
  ParsedRecord,
  ParseOutcome,
  IngestResult,
} from './sync/index.js';
