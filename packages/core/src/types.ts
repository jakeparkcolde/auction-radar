/**
 * 코어 도메인 타입.
 *
 * 스토어는 제네릭 SQL 만 다루므로, 도메인 형상은 core 에서 정의한다.
 */

/** 법원사무소 코드 (예: B000280 인천지법). */
export type CourtCode = string;

/**
 * 소스 응답 봉투.
 *
 * 모든 SourceClient 호출은 이 형태로 반환하며, `ipcheck === false` 는 차단을 뜻한다.
 * (REQ-003)
 */
export interface SourceResponse<T = unknown> {
  /** 정상 응답 여부. */
  readonly ok: boolean;
  /** 차단 감지 플래그. false 이면 IP 차단. undefined 이면 미판정. */
  readonly ipcheck?: boolean;
  /** 파싱 전 원본 데이터. */
  readonly data: T;
  /** raw_snapshots 보존용 원본 요청/응답. */
  readonly raw: RawEnvelope;
}

/** raw_snapshots 저장을 위한 원본 요청/응답 봉투. */
export interface RawEnvelope {
  readonly endpoint: string;
  readonly request: unknown;
  readonly response: unknown;
}

/** 목록 조회 요청 파라미터. */
export interface ListRequest {
  readonly court: CourtCode;
  /** YYYYMM (당월/익월). */
  readonly yearMonth: string;
}

/** 상세 펼치기 요청 파라미터. */
export interface DetailRequest {
  readonly court: CourtCode;
  readonly announcementId: string;
}

/**
 * 목록/상세에서 파싱된 공고 레코드(원시 입력).
 *
 * 필수 필드(court, caseNumber)가 없으면 파싱 실패로 처리한다. (REQ-016)
 */
export interface SourceRecord {
  readonly court?: CourtCode;
  readonly caseNumber?: string;
  readonly itemNo?: number;
  readonly usage?: string | null;
  readonly addressRaw?: string | null;
  readonly appraisedPrice?: number | null;
  readonly minSalePrice?: number | null;
  readonly failedCount?: number | null;
  readonly correctionCount?: number | null;
  readonly cancellationCount?: number | null;
  readonly status?: string | null;
  readonly nextSaleDate?: string | null;
  readonly salePlace?: string | null;
  readonly remarks?: string | null;
  readonly announcementId?: string;
}

/**
 * diff 계산 대상 상태 값.
 *
 * state_hash 와 이벤트 생성은 이 형상만 소비한다(순수). (REQ-013, REQ-014)
 */
export interface ItemState {
  readonly itemId: number | string;
  readonly minSalePrice: number | null;
  readonly failedCount: number;
  readonly nextSaleDate: string | null;
  readonly correctionCount: number;
  readonly cancellationCount: number;
  readonly status: string | null;
  readonly appraisedPrice?: number | null;
}
