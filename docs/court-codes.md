# 법원사무소 코드표 (court-codes)

> 워치리스트의 `courts` 필드와 수집 범위 결정에 쓰이는 법원사무소 코드 참고표입니다.
> 권위 있는 최신 목록은 실행 시 `selectCortOfcCdLst` 엔드포인트로 조회합니다
> (`packages/core/src/endpoints.ts` → `ENDPOINTS.courtCodeList`).

## 코드 형식

- 형식: `B` + 6자리 숫자 (예: `B000280`)
- 워치리스트 `courts` 에 지정하면 수집 범위가 해당 법원으로 제한됩니다 (budget 절약, §6.4 1차 필터).

## 자주 쓰는 예시 코드

| 코드 | 법원 |
|---|---|
| B000210 | 서울중앙지방법원 |
| B000280 | 인천지방법원 |

> ⚠️ 위 표는 문서 예시일 뿐이며, 전체·최신 목록은 `auction-radar` 실행 시 코드표 조회로 채워집니다.
> 코드 검증·보강은 good-first-issue 대상입니다.

## 갱신 절차

1. `selectCortOfcCdLst` 응답을 로컬에서 조회 (contract 테스트, 월 1회 수동)
2. 변경이 있으면 본 문서와 관련 상수를 갱신
3. 응답 스키마가 바뀌면 `endpoints.ts` 의 `ENDPOINTS_VERSION` 을 올림
