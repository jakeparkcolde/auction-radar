/**
 * @auction-radar/alert — 매칭 엔진 + notifier(telegram) + digest + quiet hours + D-day generator.
 *
 * SPEC-ALERT-001 공개 표면. 하위 SPEC(CLI 등)이 소비하는 계약을 export 한다.
 */

/** 패키지 버전 마커. */
export const ALERT_PACKAGE_VERSION = '0.1.0' as const;

// 마이그레이션 (alert 소유 — store BUILTIN 과 조합해서 사용)
export { ALERT_MIGRATIONS } from './migrations.js';

// notifier
export type { Notifier, RenderedMessage, SendResult } from './notifier/Notifier.js';
export { htmlEscape } from './notifier/htmlEscape.js';
export {
  TelegramNotifier,
  DEFAULT_TELEGRAM_BASE_URL,
  DEFAULT_INTER_SEND_DELAY_MS,
} from './notifier/TelegramNotifier.js';
export type { TelegramConfig, FetchLike, FetchResponse } from './notifier/TelegramNotifier.js';

// renderer
export { renderMessage, formatKRW, DISCLAIMER, enrichEmphasized } from './render/renderer.js';
export type { RenderInput, RenderEventType, EnrichInfo } from './render/renderer.js';

// matcher
export { evaluate, matchEvents } from './match/matcher.js';
export type { WatchlistConfig, MatchEvent, MatchItem, MatchResult } from './match/matcher.js';

// cursor
export { selectUndelivered, recordSent, recordFailed, recordHeld } from './cursor/cursor.js';
export type { UndeliveredEvent } from './cursor/cursor.js';

// digest
export {
  decideDigest,
  buildDigest,
  splitMessage,
  TELEGRAM_MAX,
  NOTE_SUMMARY,
  NOTE_TOO_MANY,
  NOTE_TRUNCATED,
} from './digest/digest.js';
export type { DigestMode, DigestDecision, DigestItem } from './digest/digest.js';

// quiet hours
export { decideDelivery, DEFAULT_QUIET_HOURS } from './quiet/quietHours.js';
export type { DeliveryDecision } from './quiet/quietHours.js';

// D-day generator
export { generateDdayEvents } from './dday/ddayGenerator.js';
export type { DdayResult } from './dday/ddayGenerator.js';

// time (KST)
export {
  kstParts,
  todayKST,
  addDaysKST,
  daysUntilKST,
  isWithinQuietHours,
  nextWindowEndISO,
} from './time/kst.js';
export type { KstParts } from './time/kst.js';

// testing util (mock 텔레그램 서버 — F8 컨트리뷰터용)
export { startMockTelegramServer } from './testing/mockTelegramServer.js';
export type { MockTelegramServer, CapturedSend, MockResponse } from './testing/mockTelegramServer.js';
