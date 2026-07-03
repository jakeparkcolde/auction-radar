/**
 * Notifier 채널 인터페이스. (SPEC-ALERT-001 REQ-010, 기획서 §6.5)
 *
 * v2 채널 확장(F8: 디스코드·Slack·이메일)을 위해 이 인터페이스만 본 SPEC 에서 확정하고
 * packages/alert 에서 export 한다. MVP 구현체는 TelegramNotifier 이다.
 */

/** 렌더링 완료된(HTML) 발송 메시지. */
export interface RenderedMessage {
  /** notifications 기록용 이벤트 id (digest 요약 메시지는 없을 수 있음). */
  readonly eventId?: number;
  /** 채널 (기본 telegram). */
  readonly channel?: string;
  /** parse_mode=HTML 로 발송할 본문. */
  readonly text: string;
}

/** 단건 발송 결과. */
export interface SendResult {
  /** 발송 성공 여부. */
  readonly ok: boolean;
  /** 재시도 가능 실패 여부(429/5xx). */
  readonly retryable?: boolean;
  /** 실패 사유. */
  readonly error?: string;
  /** 429 응답의 retry_after(ms) — 존재 시 백오프 대신 이 값을 존중한다. */
  readonly retryAfterMs?: number;
  /** 발송에 사용된 시도 횟수(최초 1 + 재시도). */
  readonly attempts?: number;
}

/** 알림 채널 추상화. */
export interface Notifier {
  /** 단일 메시지 발송. */
  send(msg: RenderedMessage): Promise<SendResult>;
  /** 복수 메시지(요약/분할 조각)를 순차 발송. */
  sendDigest(msgs: RenderedMessage[]): Promise<SendResult[]>;
}
