import { describe, expect, it } from 'vitest';
import {
  computeFailedCountFromSchedule,
  decodeDetailToken,
  encodeDetailToken,
  errorCode,
  HttpSourceClient,
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
 * fetchAnnouncementDetail 은 사건 단건 조회(getCaseByCaseNumber)의 매각기일
 * 이력에서 최저매각가 하락 횟수를 세어 유찰 횟수를 근사한다(resultCode 코드표
 * 미확보 — HttpSourceClient 클래스 상단 주석 참고). 순수 함수라 라이브 호출
 * 없이 검증 가능하다.
 */
describe('computeFailedCountFromSchedule', () => {
  it('최저가가 하락한 횟수만큼 유찰로 계산한다', () => {
    const schedule = [
      { itemSeq: '1', eventSeq: '1', saleDate: '2026-01-10', minimumSalePrice: 320_000_000, appraisedPrice: 400_000_000, resultCode: null },
      { itemSeq: '1', eventSeq: '2', saleDate: '2026-02-10', minimumSalePrice: 256_000_000, appraisedPrice: 400_000_000, resultCode: null },
      { itemSeq: '1', eventSeq: '3', saleDate: '2026-03-10', minimumSalePrice: 204_800_000, appraisedPrice: 400_000_000, resultCode: null },
    ];
    expect(computeFailedCountFromSchedule(schedule, '1')).toBe(2);
  });

  it('가격이 오르거나 유지되면 유찰로 세지 않는다', () => {
    const schedule = [
      { itemSeq: '1', eventSeq: '1', saleDate: '2026-01-10', minimumSalePrice: 300_000_000, appraisedPrice: 400_000_000, resultCode: null },
      { itemSeq: '1', eventSeq: '2', saleDate: '2026-02-10', minimumSalePrice: 300_000_000, appraisedPrice: 400_000_000, resultCode: null },
    ];
    expect(computeFailedCountFromSchedule(schedule, '1')).toBe(0);
  });

  it('날짜순이 뒤섞여 있어도 정렬 후 계산한다', () => {
    const schedule = [
      { itemSeq: '1', eventSeq: '2', saleDate: '2026-02-10', minimumSalePrice: 256_000_000, appraisedPrice: null, resultCode: null },
      { itemSeq: '1', eventSeq: '1', saleDate: '2026-01-10', minimumSalePrice: 320_000_000, appraisedPrice: null, resultCode: null },
    ];
    expect(computeFailedCountFromSchedule(schedule, '1')).toBe(1);
  });

  it('다른 물건 회차(itemSeq 불일치)는 제외한다', () => {
    const schedule = [
      { itemSeq: '1', eventSeq: '1', saleDate: '2026-01-10', minimumSalePrice: 320_000_000, appraisedPrice: null, resultCode: null },
      { itemSeq: '2', eventSeq: '1', saleDate: '2026-01-15', minimumSalePrice: 100_000_000, appraisedPrice: null, resultCode: null },
      { itemSeq: '1', eventSeq: '2', saleDate: '2026-02-10', minimumSalePrice: 256_000_000, appraisedPrice: null, resultCode: null },
    ];
    expect(computeFailedCountFromSchedule(schedule, '1')).toBe(1);
  });

  it('itemSeq 가 null 이면(단일 물건 사건) 전체를 하나의 이력으로 취급한다', () => {
    const schedule = [
      { itemSeq: null, eventSeq: '1', saleDate: '2026-01-10', minimumSalePrice: 320_000_000, appraisedPrice: null, resultCode: null },
      { itemSeq: null, eventSeq: '2', saleDate: '2026-02-10', minimumSalePrice: 256_000_000, appraisedPrice: null, resultCode: null },
    ];
    expect(computeFailedCountFromSchedule(schedule, '1')).toBe(1);
  });

  it('날짜나 가격이 없는 항목은 제외한다', () => {
    const schedule = [
      { itemSeq: '1', eventSeq: '1', saleDate: '2026-01-10', minimumSalePrice: 320_000_000, appraisedPrice: null, resultCode: null },
      { itemSeq: '1', eventSeq: '2', saleDate: null, minimumSalePrice: 100_000_000, appraisedPrice: null, resultCode: null },
      { itemSeq: '1', eventSeq: '3', saleDate: '2026-03-10', minimumSalePrice: null, appraisedPrice: null, resultCode: null },
    ];
    expect(computeFailedCountFromSchedule(schedule, '1')).toBe(0);
  });

  it('빈 이력은 0을 반환한다', () => {
    expect(computeFailedCountFromSchedule([], '1')).toBe(0);
  });
});
