import type { WatchlistEntry } from '../config/schema.js';

/**
 * 대화형 프롬프트 포트. (SPEC-CLI-001 결정 D3)
 *
 * init 마법사 로직은 이 포트에만 의존한다. 실제 구현(@inquirer/prompts 어댑터)은
 * wizard/prompts.ts 가, 테스트는 스크립트된 fake 가 제공한다.
 * 이렇게 하면 마법사 "로직"을 UI 라이브러리 없이 결정론적으로 시험할 수 있다.
 */
export interface Prompts {
  /** 봇 토큰 입력(원문 — 'env:TG_TOKEN' 참조 또는 평문). */
  inputToken(): Promise<string>;
  /** chat_id 를 알고 있는지. false 면 자동 감지 흐름으로 진행. */
  knowsChatId(): Promise<boolean>;
  /** chat_id 직접 입력. */
  inputChatId(): Promise<string>;
  /** "봇에게 아무 메시지나 보낸 뒤 계속" 대기(엔터). */
  waitForBotMessage(): Promise<void>;
  /** 자동 감지된 chat_id 확인. */
  confirmChatId(detected: string): Promise<boolean>;
  /** 첫 워치리스트 조건 입력. */
  inputWatchlist(): Promise<WatchlistEntry>;
}
