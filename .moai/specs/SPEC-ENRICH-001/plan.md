# SPEC-ENRICH-001 구현 계획

> Traceability: SPEC-ENRICH-001 (spec.md) · 기획서 v0.2 §6.6, §12 (M3)

## 1. 마일스톤 (우선순위 기반)

### Primary Goal — MOLIT 클라이언트 & 캐시

1. `packages/enrich` 골격 + enrich 설정(`molitKey`(env: 지원), `enabled`, `baseUrl`)
2. MOLIT 클라이언트: LAWD_CD + DEAL_YMD 조회, base URL 설정 분리 (REQ-001) — **구현 착수 시 최신 명세 확인** (apis.data.go.kr 개편 이력, 기획서 §6.6 경고)
3. rt_trades 캐시 레이어: lawd_cd × 12개월, 월 1회 갱신 제한 (REQ-002)
4. 만원 → 원 환산 저장 (REQ-010)
5. 실패 격리: 키 부재·쿼터 소진·API 오류 시 파이프라인 무중단 (REQ-003)

### Secondary Goal — 매칭 & 지표

1. 단지명 정규화(apt_name_norm): 공백·괄호·"아파트" 접미 제거, 숫자 단지 통일 + 테스트 벡터 (REQ-004)
2. 후보 산정: 단지명 + 면적 ±10% → 법정동 폴백 (REQ-004)
3. 중위값 계산 + 할인율 `1 − (최저가/중위값)` (REQ-006)
4. 신뢰도 등급 판정기 (높음/보통/낮음 + 빌라·토지 참고치 고정) (REQ-008, 009)
5. 렌더링 계약 구조체 export (REQ-011) → SPEC-ALERT-001 슬롯·SPEC-UI-001 소비

### Final Goal — 검증 (M3 DoD)

1. 아파트 할인율 표본 검증: **수동 대조 20건** — 실제 물건 20건에 대해 산출 할인율과 수동 계산 결과 대조 시트 작성 (기획서 M3 DoD)
2. lawd-codes.csv 동봉 + 매핑 유틸 (SPEC-COLLECTOR-001의 3계층과 연결)

## 2. 기술 스택

| 구성요소 | 선택 | 비고 |
|---|---|---|
| HTTP 클라이언트 | Node 20 내장 fetch | 외부 의존성 불필요 |
| XML 파싱 | fast-xml-parser >= 4.4 | MOLIT 응답이 XML 기반인 경우 대비 (JSON 지원 여부는 구현 시 최신 명세 확인) |
| 통계 | 자체 median 구현 | 의존성 불필요, 짝수 표본 규칙 명시(중앙 2값 평균) |
| 캐시 저장 | packages/store (rt_trades) | prepared statements, SPEC-COLLECTOR-001 계약 |
| 테스트 | vitest + MOLIT 응답 fixture | CI에서 실 API 호출 금지 (쿼터 보호) |

## 3. 다른 SPEC과의 의존 관계

- **선행**: SPEC-COLLECTOR-001 — items.lawd_cd(3계층 매핑 결과), rt_trades 스키마, 스토어 드라이버
- **소비자**: SPEC-ALERT-001(메시지 할인율 라인 슬롯), SPEC-UI-001(대시보드 표시)
- **계약 표면**: `{ discountRate, medianPrice, sampleCount, confidence, fallbackUsed }` (REQ-011) — 이 구조 변경 시 두 소비자 SPEC 동시 갱신 필요

## 4. 리스크 분석 및 대응 (기획서 §14 연계)

| 리스크 | 영향 | 대응 |
|---|---|---|
| 실거래 매칭 오류 → 잘못된 할인율 | 상 | 중위값 사용 + 신뢰도 등급 상시 병기 + 표본 부족 시 강조 억제 + M3 수동 대조 20건 |
| MOLIT 엔드포인트 개편 | 중 | base URL 설정 분리 (REQ-001), doctor에 enrich 연결 확인 항목 추가 검토 |
| 쿼터 소진 | 중 | lawd_cd × 12개월 × 월 1회 캐시 전략, 소진 시 캐시 기반 지속 (REQ-003) |
| 단지명 정규화 실패 (특수 명칭) | 중 | 폴백 밴드 + 신뢰도 강등, 정규화 예외 케이스를 good-first-issue로 운영 (기획서 §13) |
| lawd_cd 매핑 실패 물건 | 저 | enrich만 skip, 알림 정상 (REQ-005) — 매핑 실패율 로그로 관측 |

## 5. 테스트 전략 (기획서 §9)

- MOLIT 응답 fixture 기반: 클라이언트 파싱·환산·캐시 로직 네트워크 없이 검증
- 중위값·할인율 단위 테스트: outlier 포함 표본, 짝수/홀수 표본, 표본 0건
- 신뢰도 등급 경계 테스트: 동일 단지 4건/5건, 폴백 9건/10건 경계
- 폴백 시나리오: 단지명 매칭 0건 → 면적 밴드 폴백 + 신뢰도 강등 확인
- 수동 대조 20건 결과 시트를 레포 docs 또는 SPEC 부속으로 기록 (M3 DoD 증빙)
- 커버리지 목표: 정규화·매칭·통계·등급 모듈 85%+
