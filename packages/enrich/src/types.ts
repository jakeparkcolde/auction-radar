/**
 * enrich 도메인 타입. (SPEC-ENRICH-001 §3, REQ-011)
 *
 * 이 파일은 순수 데이터 계약만 정의한다(로직 없음).
 */

/** 신뢰도 등급(정규 enum). 표시 라벨은 render 어댑터가 매핑한다. (REQ-008/009) */
export type Confidence = '높음' | '보통' | '낮음' | '참고치';

/**
 * rt_trades 캐시 한 행에 대응하는 실거래 레코드.
 *
 * 001_init.sql 의 rt_trades 컬럼과 1:1 대응한다(id/fetched_at 제외).
 * price 는 반드시 원 단위 정수(만원 → 원 환산 완료). (REQ-010)
 */
export interface RtTradeRecord {
  readonly lawdCd: string;
  /** 거래 연월 YYYYMM (예: "202606"). */
  readonly dealYm: string;
  /** 정규화 단지명(apt_name_norm). 없으면 null. */
  readonly aptNameNorm: string | null;
  /** 전용면적(㎡). 없으면 null. */
  readonly area: number | null;
  /** 층. 없으면 null. */
  readonly floor: number | null;
  /** 거래가(원 단위 정수). */
  readonly price: number;
  /** 거래 일자 YYYY-MM-DD. 없으면 null. */
  readonly dealDate: string | null;
}

/**
 * enrich 대상 물건. (매칭 입력)
 *
 * items 테이블에서 도출하되, area·aptName 은 원본 스키마에 전용 컬럼이 없어
 * 오케스트레이터가 best-effort 로 구성한다(없으면 null → 매칭 강등).
 */
export interface EnrichTarget {
  /** 이벤트 id(결과 Map 키). */
  readonly eventId: number;
  /** 법정동코드 5자리. 매핑 실패 시 null → enrich skip. (REQ-005) */
  readonly lawdCd: string | null;
  /** 현재 최저매각가(원). */
  readonly minSalePrice: number | null;
  /** 원문 용도(빌라·토지 참고치 고정 판정용, mapUsage 입력). (REQ-009) */
  readonly usage: string | null;
  /** 단지명 원문(정규화 전). 매칭 후보 산정용. */
  readonly aptName: string | null;
  /** 전용면적(㎡). ±10% 밴드 산정용. 없으면 면적 필터 생략. */
  readonly area: number | null;
}

/**
 * enrich 결과(정규 계약 표면). (REQ-011, 결정 D5)
 *
 * discountRate 는 비율(예: 0.319 = −32%), medianPrice·min 은 원 단위.
 * emphasize 는 알림 렌더러의 강조(굵게) 억제 스위치.
 */
export interface EnrichResult {
  /** 할인율 비율 = 1 − (최저매각가 / 실거래 중위값). 예: 0.319. */
  readonly discountRate: number;
  /** 실거래 중위값(원). 대시보드·검증용. */
  readonly medianPrice: number;
  /** 사용된 표본 수. */
  readonly sampleCount: number;
  /** 신뢰도 등급. */
  readonly confidence: Confidence;
  /** 면적 밴드 폴백이 사용되었는지. (검증·대시보드용) */
  readonly fallbackUsed: boolean;
  /** 강조 표기 허용 여부(낮음/참고치는 false). */
  readonly emphasize: boolean;
}
