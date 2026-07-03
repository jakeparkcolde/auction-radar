/**
 * courtauction.go.kr 내부 WebSquare XHR 엔드포인트 버전 상수. (기획서 §6.2, §8)
 *
 * 사이트 구조는 예고 없이 변경될 수 있으므로 버전 상수로 분리한다.
 * 스키마 drift 감지 시 ENDPOINTS_VERSION 을 올리고 raw 보존으로 사후 대응한다. (REQ-A1)
 */

/** 엔드포인트 스펙 버전 (contract 테스트로 검증). */
export const ENDPOINTS_VERSION = '2026-07-03' as const;

/** 단일 엔드포인트 정의. */
export interface EndpointSpec {
  readonly path: string;
  readonly method: 'POST';
  readonly description: string;
}

/** 4종 XHR 엔드포인트. */
export const ENDPOINTS = {
  /** 매각공고 목록 (월/일 + 법원 + 입찰구분). */
  listAnnouncement: {
    path: '/pgj/pgj143/selectRletDspslPbanc.on',
    method: 'POST',
    description: '매각공고 목록',
  },
  /** 공고 상세 — 사건/물건 펼치기. */
  detailAnnouncement: {
    path: '/pgj/pgj143/selectRletDspslPbancDtl.on',
    method: 'POST',
    description: '매각공고 상세 (물건 펼치기)',
  },
  /** 사건 단건 조회 (기일 이력·이해관계인). */
  searchCase: {
    path: '/pgj/pgj15A/selectAuctnCsSrchRslt.on',
    method: 'POST',
    description: '사건 단건 조회',
  },
  /** 법원사무소 코드표. */
  courtCodeList: {
    path: '/pgj/pgjComm/selectCortOfcCdLst.on',
    method: 'POST',
    description: '법원사무소 코드표',
  },
} as const satisfies Record<string, EndpointSpec>;

/** 엔드포인트 키 유니온. */
export type EndpointKey = keyof typeof ENDPOINTS;

/** 요청 base URL (설정으로 오버라이드 가능). */
export const DEFAULT_BASE_URL = 'https://www.courtauction.go.kr' as const;
