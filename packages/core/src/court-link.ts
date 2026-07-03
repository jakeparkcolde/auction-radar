import { DEFAULT_BASE_URL } from './endpoints.js';

/**
 * 법원경매 포털 원문 링크 생성. (SPEC-UI-001 결정 D4, 기획서 §6.5)
 *
 * courtauction.go.kr 의 물건 상세는 WebSquare XHR(POST) 로만 조회되어 안정적인
 * 딥링크 GET URL 이 없다. 따라서 포털 랜딩 URL 을 반환하고, 법원코드·사건번호는
 * 사용자가 조회에 사용할 수 있도록 쿼리 파라미터(텍스트) 로 부착한다.
 *
 * DEFAULT_BASE_URL(core 소유)을 단일 소스로 재사용해 표기 불일치를 방지한다.
 * 대시보드는 이 함수를 서버 사이드에서 호출해 결과 URL 을 JSON 으로 전달하므로,
 * 빌드된 HTML 셸에는 http(s):// 리터럴이 포함되지 않는다.
 *
 * @param courtCode 법원사무소 코드(예: "B000210").
 * @param caseNumber 정규화 사건번호(예: "2025타경12345").
 * @returns 포털 URL 문자열.
 */
export function courtAuctionUrl(courtCode: string, caseNumber: string): string {
  const params = new URLSearchParams({
    // 사건번호는 딥링크가 아닌 텍스트 참조값으로 부착한다(사이트 구조 변동 내성).
    cortOfcCd: courtCode,
    caseNo: caseNumber,
  });
  return `${DEFAULT_BASE_URL}/pgj/index.on?${params.toString()}`;
}
