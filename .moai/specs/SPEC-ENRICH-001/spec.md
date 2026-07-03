---
id: SPEC-ENRICH-001
version: 0.1.0
status: draft
created: 2026-07-03
updated: 2026-07-03
author: Jake / COLDBYTE
priority: medium
lifecycle_level: spec-first
---

# SPEC-ENRICH-001: 국토부 실거래가 결합 · 중위값 할인율 · 신뢰도 등급

## HISTORY

| 버전 | 날짜 | 내용 |
|---|---|---|
| v0.1.0 | 2026-07-03 | 최초 작성 — 기획서 v0.2 §6.6, §6.4(3계층 lawd_cd), §10 기반 EARS 명세화. [반영 권장] 항목(MOLIT base URL 설정화, 쿼터 소진 시 알림 파이프라인 무중단, 20건 수동 대조) 반영 |

---

## 1. 개요 (Environment)

- **목적**: 국토부 실거래가 OPEN API(공공데이터포털)를 결합해 "최저매각가가 인근 실거래 **중위값** 대비 몇 % 할인인지"를 신뢰도 등급과 함께 산출한다. (기획서 §6.6, F4)
- **범위**: `packages/enrich` — 법정동코드(lawd_cd) 매핑, MOLIT 클라이언트, rt_trades 캐시, 단지명 정규화·매칭, 중위값·할인율·신뢰도 계산.
- **의존**: SPEC-COLLECTOR-001(items.lawd_cd, rt_trades 스키마), SPEC-ALERT-001(메시지 렌더링 슬롯).

## 2. 가정 (Assumptions)

- A1. MOLIT API는 무료 개인 인증키·쿼터가 있으며, 엔드포인트가 apis.data.go.kr 체계로 개편된 이력이 있다 → base URL 설정 분리 필수. (기획서 §6.6, §10)
- A2. 아파트 외(빌라·토지)는 실거래 매칭 정확도가 구조적으로 낮다 → v1.x에서 "참고치" 고정. (기획서 §6.6)
- A3. lawd_cd 매핑 실패 물건이 존재한다 → enrich만 불가하고 매칭·알림(2계층)은 정상 동작. (기획서 §6.4)
- A4. enrich는 기본 비활성(`enrich.enabled: false`)이며 MOLIT 키 등록 시 활성화. (기획서 §6.7)

## 3. 요구사항 (Requirements — EARS)

### 모듈 1: MOLIT 클라이언트 & 캐시 (기획서 §6.6)

- **ENRICH-REQ-001** (Ubiquitous): The system shall MOLIT API base URL을 설정값으로 분리해야 하며(엔드포인트 개편 대응), 요청 파라미터는 `LAWD_CD`(법정동 5자리) + `DEAL_YMD`(YYYYMM)를 사용해야 한다. [반영 권장: base URL 설정화]
- **ENRICH-REQ-002** (Event-driven): WHEN enrich 갱신이 실행되면 THEN the system shall 워치리스트에 등장하는 lawd_cd × 최근 12개월 조합만 조회해 rt_trades에 캐시해야 하며, 동일 조합의 재조회는 월 1회로 제한해야 한다 (쿼터 절약).
- **ENRICH-REQ-003** (State-driven): IF MOLIT 키가 없거나 쿼터가 소진되거나 API가 오류를 반환하면 THEN the system shall enrich만 건너뛰고 알림 파이프라인을 차단·실패시키지 않아야 하며, 기존 캐시가 있으면 캐시 기준으로 계산을 지속해야 한다. [반영 권장: 쿼터 소진 대응]

### 모듈 2: 매칭 알고리즘 (기획서 §6.6 아파트 우선)

- **ENRICH-REQ-004** (Ubiquitous): The system shall 단지명을 정규화(공백·괄호·"아파트" 접미 제거, 숫자 단지 통일)해 `apt_name_norm`으로 저장하고, 후보 산정은 ① 같은 lawd_cd + 단지명 포함 매칭 + 전용면적 ±10% ② 후보 0건 시 같은 lawd_cd + 면적 밴드 전체 폴백(신뢰도 강등) 순서를 따라야 한다.
- **ENRICH-REQ-005** (State-driven): IF item에 lawd_cd가 없으면(3계층 매핑 실패) THEN the system shall 해당 물건의 enrich를 건너뛰고 "실거래 비교 불가" 상태를 기록해야 한다 (알림·매칭은 정상 동작).

### 모듈 3: 할인율 지표 (기획서 §6.6)

- **ENRICH-REQ-006** (Ubiquitous): The system shall 할인율을 `1 − (최저매각가 / 실거래 중위값)`으로 계산해야 하며, 표본 통계는 반드시 **중위값(median)**을 사용하고 평균(mean)을 사용하지 않아야 한다 (저층·특수거래 outlier 방어).
- **ENRICH-REQ-007** (Unwanted): The system shall 할인율을 신뢰도 등급 없이 단독 표기하지 않아야 한다 — 알림·대시보드에 항상 "표본 n건 · 신뢰도 등급"을 병기.

### 모듈 4: 신뢰도 등급 (기획서 §6.6 표)

- **ENRICH-REQ-008** (Ubiquitous): The system shall 신뢰도 등급을 다음 규칙으로 판정해야 한다: **높음** = 동일 단지 표본 ≥ 5건(12개월) / **보통** = 동일 단지 3~4건 또는 법정동 폴백 ≥ 10건 / **낮음** = 그 외("참고치 (표본 부족)" 표기, 할인율 굵게 표시 금지).
- **ENRICH-REQ-009** (State-driven): IF 물건 용도가 빌라·토지 계열이면 THEN the system shall 신뢰도를 "참고치"로 고정하고 강조 표기를 억제해야 한다. (v1.x 범위)
- **ENRICH-REQ-010** (Optional): Where 가격 데이터 단위 변환이 필요하면, the system shall MOLIT 응답의 만원 단위를 원 단위 정수로 환산해 저장해야 한다 (rt_trades.price, 기획서 §6.1 주석).

### 모듈 5: 렌더링 계약 (SPEC-ALERT-001 / SPEC-UI-001 소비)

- **ENRICH-REQ-011** (Ubiquitous): The system shall enrich 결과를 `{ discountRate, medianPrice, sampleCount, confidence, fallbackUsed }` 구조로 제공해 알림 메시지("인근 실거래 중위값 대비 −32% (표본 14건 · 신뢰도 높음)")와 대시보드가 동일 데이터로 렌더링하게 해야 한다.

## 4. 명세 (Specifications)

- rt_trades 인덱스 `(lawd_cd, apt_name_norm, area)` 활용 (기획서 §6.1).
- lawd_cd 매핑 소스: `docs/lawd-codes.csv` (행정표준코드 테이블 동봉).
- enrich 실행 시점: sync 파이프라인의 후처리 단계 + 월 1회 캐시 갱신 배치.

## 5. 추적성 (Traceability)

| 요구사항 | 기획서 근거 |
|---|---|
| REQ-001~003 | §6.6 소스·캐시 전략, §10 |
| REQ-004~005 | §6.6 매칭 알고리즘, §6.4 3계층 |
| REQ-006~007 | §6.6 지표 (중위값), §14 매칭 오류 리스크 |
| REQ-008~010 | §6.6 신뢰도 표, §6.1 |
| REQ-011 | §6.5 메시지 포맷, F5 |

## 6. Out of Scope / 백로그

- **빌라·토지 전용 매칭 정확도 개선** — v2 이후. v1.x는 "참고치" 고정.
- **lawd-codes.csv 출처(행정표준코드관리시스템)·스냅샷 일자·갱신 스크립트 문서화** — 백로그. 행정구역 개편 대응.
- **전월세 실거래 결합** — 백로그 (매매만 v1.x).
- **오피스텔 실거래 API 분리 대응** — 백로그 (MOLIT 오피스텔 엔드포인트 별도).
- **Supabase 환경에서의 rt_trades 캐시** — SPEC-COLLECTOR-001 백로그(Supabase 어댑터)에 종속.
