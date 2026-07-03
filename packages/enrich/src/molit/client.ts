import type { RtTradeRecord } from '../types.js';
import { parseMolitResponse } from './parser.js';

/**
 * MOLIT 실거래가 클라이언트. (REQ-001, 결정 D2/D3)
 *
 * - base URL 은 설정 주입(엔드포인트 개편 대응). serviceKey 는 Decoding 키를 저장하고
 *   URLSearchParams 로 단일 인코딩한다(이중 인코딩 방지).
 * - fetch 는 주입 가능(alert FetchLike 패턴)해 CI 에서 실 네트워크 호출 0건.
 * - pageNo/numOfRows/totalCount 로 페이지네이션한다.
 * - HTTP 오류(쿼터 소진 등)는 예외로 던져 오케스트레이터가 캐시로 폴백하게 한다. (REQ-003)
 */

/** MOLIT fetch 응답의 최소 형상(전역 Response 가 구조적으로 만족). */
export interface MolitFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

/** 주입 가능한 fetch 형상(GET 전용, 전역 fetch 의 최소 부분집합). */
export type MolitFetchLike = (url: string) => Promise<MolitFetchResponse>;

/** 페이지당 최대 건수(MOLIT 상한 100). */
export const DEFAULT_NUM_OF_ROWS = 100;

/** 페이지네이션 안전 상한(무한 루프 방지). */
const MAX_PAGES = 100;

/** 전역 fetch 를 MolitFetchLike 로 감싼 기본 구현. */
const defaultFetch: MolitFetchLike = (url) =>
  globalThis.fetch(url) as unknown as Promise<MolitFetchResponse>;

export class MolitClient {
  private readonly baseUrl: string;
  private readonly serviceKey: string;
  private readonly fetchFn: MolitFetchLike;
  private readonly numOfRows: number;

  /**
   * @param baseUrl    MOLIT 엔드포인트 base URL.
   * @param serviceKey Decoding 서비스 키(URLSearchParams 로 단일 인코딩됨).
   * @param fetchFn    주입 fetch(기본: 전역 fetch).
   * @param numOfRows  페이지당 건수(기본 100).
   */
  constructor(
    baseUrl: string,
    serviceKey: string,
    fetchFn: MolitFetchLike = defaultFetch,
    numOfRows: number = DEFAULT_NUM_OF_ROWS,
  ) {
    this.baseUrl = baseUrl;
    this.serviceKey = serviceKey;
    this.fetchFn = fetchFn;
    this.numOfRows = Math.min(numOfRows, DEFAULT_NUM_OF_ROWS);
  }

  /** 단일 페이지 요청 URL 을 구성한다(serviceKey 단일 인코딩). */
  private buildUrl(lawdCd: string, dealYmd: string, pageNo: number): string {
    const params = new URLSearchParams({
      serviceKey: this.serviceKey,
      LAWD_CD: lawdCd,
      DEAL_YMD: dealYmd,
      pageNo: String(pageNo),
      numOfRows: String(this.numOfRows),
    });
    return `${this.baseUrl}?${params.toString()}`;
  }

  /** 단일 페이지를 fetch·파싱한다. HTTP 오류는 예외로 던진다. */
  private async fetchPage(
    lawdCd: string,
    dealYmd: string,
    pageNo: number,
  ): Promise<{ records: RtTradeRecord[]; totalCount: number }> {
    const url = this.buildUrl(lawdCd, dealYmd, pageNo);
    const resp = await this.fetchFn(url);
    if (!resp.ok) {
      throw new Error(`MOLIT HTTP ${resp.status} (lawd_cd=${lawdCd}, deal_ymd=${dealYmd})`);
    }
    const xml = await resp.text();
    return parseMolitResponse(xml, lawdCd, dealYmd);
  }

  /**
   * lawd_cd × deal_ymd(YYYYMM) 의 전체 실거래를 페이지네이션으로 조회한다.
   *
   * @param lawdCd  법정동코드 5자리.
   * @param dealYmd 거래연월 YYYYMM.
   * @returns 전체 페이지의 실거래 레코드.
   * @throws Error — HTTP 오류(쿼터 소진 등). 호출자가 캐시 폴백을 결정한다.
   */
  async fetchMonth(lawdCd: string, dealYmd: string): Promise<RtTradeRecord[]> {
    const first = await this.fetchPage(lawdCd, dealYmd, 1);
    const all: RtTradeRecord[] = [...first.records];

    const totalPages = Math.min(
      Math.max(1, Math.ceil(first.totalCount / this.numOfRows)),
      MAX_PAGES,
    );

    for (let page = 2; page <= totalPages; page += 1) {
      const next = await this.fetchPage(lawdCd, dealYmd, page);
      if (next.records.length === 0) break;
      all.push(...next.records);
    }

    return all;
  }
}
