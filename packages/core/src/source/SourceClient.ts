import type { CourtCode, DetailRequest, ListRequest, SourceResponse, SourceRecord } from '../types.js';

/**
 * 소스 클라이언트 인터페이스. (REQ-008 연계)
 *
 * court-auction-notice-search 패키지의 단일 메인테이너 리스크를 격리하기 위한 seam.
 * 구현체:
 * - FixtureSourceClient : CI 기본 (네트워크 없음)
 * - HttpSourceClient    : court-auction-notice-search 래핑 (CI 미호출)
 *
 * 각 호출은 SourceResponse 봉투를 반환하며, ipcheck===false 는 차단을 의미한다.
 */
export interface SourceClient {
  /** 세션 쿠키 확보 (warmup). */
  warmup(): Promise<SourceResponse>;

  /** 법원사무소 코드표 조회 (워치리스트에 법원이 없을 때 전체 대상 도출용). */
  fetchCourtCodes(): Promise<SourceResponse<CourtCode[]>>;

  /** 매각공고 목록 조회 (법원 + 년월). */
  fetchAnnouncementList(req: ListRequest): Promise<SourceResponse<SourceRecord[]>>;

  /** 공고 상세 펼치기. */
  fetchAnnouncementDetail(req: DetailRequest): Promise<SourceResponse<SourceRecord>>;
}
