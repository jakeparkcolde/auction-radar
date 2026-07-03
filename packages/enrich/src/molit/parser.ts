import { XMLParser } from 'fast-xml-parser';
import type { RtTradeRecord } from '../types.js';
import { aptNameNorm } from '../normalize/aptName.js';

/**
 * MOLIT 아파트 매매 실거래가 상세(getRTMSDataSvcAptTradeDev) XML 파서. (REQ-010, 결정 D1/D2)
 *
 * XML 파싱은 이 파일에 격리한다(fast-xml-parser 의존성 캡슐화).
 * 가격 단위 변환: dealAmount(만원, 콤마 문자열 "115,000") → 원 단위 정수 1,150,000,000.
 * dealAmount 가 비면 해당 레코드를 드롭한다.
 */

/** 파싱 결과(레코드 + 페이지네이션용 totalCount). */
export interface ParsedMolitPage {
  readonly records: RtTradeRecord[];
  /** 응답 전체 건수(페이지네이션 종료 판정용). 없으면 0. */
  readonly totalCount: number;
}

/** 모든 leaf 를 문자열로 유지해 수치 변환을 명시적으로 제어한다. */
const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  trimValues: true,
});

/** 단일/복수/부재를 배열로 정규화한다. */
function toArray(v: unknown): unknown[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/** 문자열 leaf 를 안전하게 추출한다(숫자여도 문자열화). */
function str(v: unknown): string {
  if (v === undefined || v === null) return '';
  return String(v).trim();
}

/** 만원 콤마 문자열("115,000")을 원 단위 정수로 환산한다. 실패 시 null. (REQ-010) */
export function manwonToWon(dealAmount: string): number | null {
  const cleaned = dealAmount.replace(/,/g, '').trim();
  if (cleaned.length === 0) return null;
  const manwon = Number.parseInt(cleaned, 10);
  if (!Number.isFinite(manwon) || manwon <= 0) return null;
  return manwon * 10000;
}

/** 정수 문자열 → number 또는 null. */
function parseIntOrNull(v: string): number | null {
  if (v.length === 0) return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

/** 실수 문자열 → number 또는 null. */
function parseFloatOrNull(v: string): number | null {
  if (v.length === 0) return null;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/** YYYY / M / D → "YYYY-MM-DD"(zero-pad). 연·월·일 중 하나라도 없으면 null. */
function toDealDate(year: string, month: string, day: string): string | null {
  if (year.length === 0 || month.length === 0 || day.length === 0) return null;
  const mm = month.padStart(2, '0');
  const dd = day.padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

/**
 * MOLIT XML 응답을 실거래 레코드 배열 + totalCount 로 파싱한다.
 *
 * @param xml    MOLIT 응답 XML 문자열.
 * @param lawdCd 요청한 법정동코드 5자리(레코드에 부여).
 * @param dealYm 요청한 거래연월 YYYYMM(레코드에 부여).
 */
export function parseMolitResponse(xml: string, lawdCd: string, dealYm: string): ParsedMolitPage {
  const parsed = parser.parse(xml) as Record<string, unknown>;
  const response = (parsed.response ?? {}) as Record<string, unknown>;
  const body = (response.body ?? {}) as Record<string, unknown>;
  const itemsNode = (body.items ?? {}) as Record<string, unknown>;
  const rawItems = toArray(itemsNode.item);

  const totalCount = parseIntOrNull(str(body.totalCount)) ?? 0;

  const records: RtTradeRecord[] = [];
  for (const raw of rawItems) {
    const item = raw as Record<string, unknown>;
    const price = manwonToWon(str(item.dealAmount));
    if (price === null) continue; // 금액 없는 레코드 드롭.

    records.push({
      lawdCd,
      dealYm,
      aptNameNorm: aptNameNorm(str(item.aptNm)) || null,
      area: parseFloatOrNull(str(item.excluUseAr)),
      floor: parseIntOrNull(str(item.floor)),
      price,
      dealDate: toDealDate(str(item.dealYear), str(item.dealMonth), str(item.dealDay)),
    });
  }

  return { records, totalCount };
}
