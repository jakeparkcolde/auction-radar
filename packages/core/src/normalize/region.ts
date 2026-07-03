/**
 * 지역 정규화 (region_norm). (기획서 §6.4 지역 매칭 2계층, REQ-012 연계)
 *
 * 원문 소재지는 자유 문자열("인천광역시 서구 청라동 …")이다.
 * 시도 축약 + 첫 시군구 추출 → "인천 서구" 형태로 정규화한다.
 * `regions` 조건은 이 문자열의 prefix 매칭으로 소비된다.
 */

/** 시도 전체 명칭 → 축약형 매핑. */
const PROVINCE_MAP: ReadonlyMap<string, string> = new Map([
  ['서울특별시', '서울'],
  ['부산광역시', '부산'],
  ['대구광역시', '대구'],
  ['인천광역시', '인천'],
  ['광주광역시', '광주'],
  ['대전광역시', '대전'],
  ['울산광역시', '울산'],
  ['세종특별자치시', '세종'],
  ['경기도', '경기'],
  ['강원도', '강원'],
  ['강원특별자치도', '강원'],
  ['충청북도', '충북'],
  ['충청남도', '충남'],
  ['전라북도', '전북'],
  ['전북특별자치도', '전북'],
  ['전라남도', '전남'],
  ['경상북도', '경북'],
  ['경상남도', '경남'],
  ['제주특별자치도', '제주'],
  ['제주도', '제주'],
]);

/** 세종처럼 시군구 계층이 없는 광역 단위. */
const SINGLE_TIER = new Set(['세종']);

/** 첫 번째 토큰을 시도 축약형으로 해석한다. 실패 시 null. */
function resolveProvince(token: string): string | null {
  const direct = PROVINCE_MAP.get(token);
  if (direct !== undefined) return direct;
  // 이미 축약형으로 들어온 경우 (예: "인천")
  for (const abbr of PROVINCE_MAP.values()) {
    if (token === abbr) return abbr;
  }
  return null;
}

/** 시군구 토큰인지 판정한다 (시/군/구 로 끝남). */
function isSigungu(token: string): boolean {
  return /(시|군|구)$/.test(token);
}

/**
 * 원문 주소를 정규화 지역 문자열로 변환한다.
 *
 * @param addressRaw 원문 소재지
 * @returns "인천 서구" 형태. 시도 해석 실패 시 null.
 */
export function regionNorm(addressRaw: string | null | undefined): string | null {
  if (!addressRaw) return null;
  const tokens = addressRaw.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  const first = tokens[0] ?? '';
  const province = resolveProvince(first);
  if (province === null) return null;

  if (SINGLE_TIER.has(province)) return province;

  // 시도 이후 첫 시군구 토큰을 찾는다.
  for (let i = 1; i < tokens.length; i += 1) {
    const token = tokens[i] ?? '';
    if (isSigungu(token)) {
      return `${province} ${token}`;
    }
  }
  // 시군구를 못 찾으면 시도만 반환.
  return province;
}
