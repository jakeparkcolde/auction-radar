/**
 * enrich 설정 해석. (REQ-001, 가정 A4)
 *
 * MOLIT base URL 을 설정값으로 분리해 엔드포인트 개편에 코드 변경 없이 대응한다.
 * enrich 는 기본 비활성이며, molitKey 가 있어야 실제 API 호출이 가능하다.
 */

/**
 * MOLIT 아파트 매매 실거래가 상세 자료(getRTMSDataSvcAptTradeDev) 기본 엔드포인트.
 *
 * apis.data.go.kr 체계(2026 검증). base URL 을 설정으로 교체 가능해야 한다. (REQ-001)
 */
export const DEFAULT_MOLIT_BASE_URL =
  'https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev' as const;

/** enrich 설정(해석 완료 형태). */
export interface EnrichConfig {
  /** enrich 활성 여부(기본 false). */
  readonly enabled: boolean;
  /** MOLIT 서비스 키(Decoding 키). 없으면 API 호출 skip. */
  readonly molitKey?: string;
  /** MOLIT base URL(기본: Dev 상세 엔드포인트). */
  readonly baseUrl: string;
}

/** resolveEnrichConfig 입력(부분 설정 + 환경변수 소스). */
export interface EnrichConfigInput {
  readonly enabled?: boolean;
  readonly molitKey?: string;
  readonly baseUrl?: string;
}

/**
 * 부분 설정을 기본값으로 채워 EnrichConfig 를 만든다. (REQ-001)
 *
 * - enabled 미지정 → false
 * - baseUrl 미지정 → DEFAULT_MOLIT_BASE_URL
 * - molitKey 는 빈 문자열이면 미설정으로 간주(undefined)
 *
 * @param input 부분 설정(CLI enrich 섹션에서 유래).
 */
export function resolveEnrichConfig(input: EnrichConfigInput = {}): EnrichConfig {
  const molitKey = input.molitKey?.trim();
  return {
    enabled: input.enabled ?? false,
    baseUrl: input.baseUrl && input.baseUrl.length > 0 ? input.baseUrl : DEFAULT_MOLIT_BASE_URL,
    ...(molitKey && molitKey.length > 0 ? { molitKey } : {}),
  };
}
