import { describe, expect, it } from 'vitest';
import {
  decodeDetailToken,
  describeUsageCode,
  encodeDetailToken,
  errorCode,
  HttpSourceClient,
  monthRange,
} from '../src/source/HttpSourceClient.js';

/**
 * HttpSourceClient 회귀 테스트.
 *
 * 실제 court-auction-notice-search@0.3.0 은 `NoticeSearchClient` 클래스가
 * 아니라 함수형 API(searchSaleNotices/getSaleNoticeDetail/getCourtCodes +
 * CourtAuctionHttpClient)를 제공한다. 이전 구현은 존재하지 않는 클래스를
 * 가정해 `cans.NoticeSearchClient is not a constructor` 로 크래시했다.
 * 이 테스트는 그 회귀를 막는다. 네트워크 호출은 수행하지 않는다(생성자만 검증).
 */
describe('HttpSourceClient (실제 API 연동, CI 네트워크 호출 없음)', () => {
  it('실제 패키지 API로 예외 없이 생성된다 (회귀: NoticeSearchClient 크래시)', () => {
    expect(() => new HttpSourceClient()).not.toThrow();
  });

  it('baseUrl 옵션을 받아 예외 없이 생성된다', () => {
    expect(() => new HttpSourceClient({ baseUrl: 'https://example.test' })).not.toThrow();
  });
});

describe('encodeDetailToken / decodeDetailToken', () => {
  it('왕복(round-trip) 시 동일한 토큰을 복원한다', () => {
    const token = { jdbnCd: 'ENC123==', saleDate: '20260728' };
    const encoded = encodeDetailToken(token);
    expect(decodeDetailToken(encoded)).toEqual(token);
  });

  it('잘못된 JSON 은 null 을 반환한다', () => {
    expect(decodeDetailToken('not-json')).toBeNull();
  });

  it('형태가 다른 JSON(필드 누락)은 null 을 반환한다', () => {
    expect(decodeDetailToken(JSON.stringify({ jdbnCd: 'X' }))).toBeNull();
    expect(decodeDetailToken(JSON.stringify({ saleDate: '20260101' }))).toBeNull();
    expect(decodeDetailToken(JSON.stringify({}))).toBeNull();
    expect(decodeDetailToken(JSON.stringify(null))).toBeNull();
  });

  it('announcementId 로 쓰기에 적합한 문자열을 만든다', () => {
    const encoded = encodeDetailToken({ jdbnCd: 'A', saleDate: '20260101' });
    expect(typeof encoded).toBe('string');
  });
});

describe('errorCode', () => {
  it('code 필드가 있는 에러 객체에서 값을 추출한다', () => {
    const err = Object.assign(new Error('blocked'), { code: 'BLOCKED' });
    expect(errorCode(err)).toBe('BLOCKED');
  });

  it('code 필드가 없으면 undefined', () => {
    expect(errorCode(new Error('plain'))).toBeUndefined();
  });

  it('객체가 아닌 값에도 안전하다', () => {
    expect(errorCode('string error')).toBeUndefined();
    expect(errorCode(null)).toBeUndefined();
    expect(errorCode(undefined)).toBeUndefined();
  });

  it('code 가 문자열이 아니면 undefined', () => {
    expect(errorCode({ code: 42 })).toBeUndefined();
  });
});

/**
 * fetchAnnouncementList 는 searchSaleNotices(공고 카드) 대신
 * searchProperties(물건 검색)를 사용한다 — 사건번호·유찰횟수를 목록 단계에서
 * 바로 얻기 위함(HttpSourceClient 클래스 상단 주석 참고). 이 순수 헬퍼들이
 * 그 전환의 핵심 로직이다.
 */
describe('monthRange', () => {
  it('YYYYMM 을 해당 월의 첫날/마지막날로 변환한다', () => {
    expect(monthRange('202602')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });

  it('윤년 2월도 올바르게 계산한다', () => {
    expect(monthRange('202802')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });

  it('31일 짜리 달을 올바르게 계산한다', () => {
    expect(monthRange('202607')).toEqual({ from: '2026-07-01', to: '2026-07-31' });
  });

  it('12월도 다음 해로 넘어가지 않고 같은 해 마지막날을 계산한다', () => {
    expect(monthRange('202612')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });
});

describe('describeUsageCode', () => {
  it('등록된 코드는 한글 이름으로 역조회한다', () => {
    // usage-codes.json 실제 데이터: small "21201" -> "아파트"
    expect(describeUsageCode({ large: null, medium: null, small: '21201' })).toBe('아파트');
  });

  it('소분류가 없으면 중분류로 폴백한다', () => {
    // medium "21200" -> "공동주택"
    expect(describeUsageCode({ large: null, medium: '21200', small: null })).toBe('공동주택');
  });

  it('모두 없으면 null', () => {
    expect(describeUsageCode({ large: null, medium: null, small: null })).toBeNull();
  });

  it('미등록 코드는 원본을 그대로 반환한다(REQ-019 "기타" 폴백으로 이어짐)', () => {
    expect(describeUsageCode({ large: null, medium: null, small: '99999-미지정' })).toBe('99999-미지정');
  });
});
