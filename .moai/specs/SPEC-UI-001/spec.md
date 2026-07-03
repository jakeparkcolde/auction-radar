---
id: SPEC-UI-001
version: 0.1.0
status: draft
created: 2026-07-03
updated: 2026-07-03
author: Jake / COLDBYTE
priority: medium
lifecycle_level: spec-first
---

# SPEC-UI-001: 로컬 읽기 전용 대시보드 (단일 HTML)

## HISTORY

| 버전 | 날짜 | 내용 |
|---|---|---|
| v0.1.0 | 2026-07-03 | 최초 작성 — 기획서 v0.2 §4.2 F5, §11(apps/dashboard) 기반 EARS 명세화. [반영 권장] 항목(localhost 전용 바인딩, 외부 네트워크 호출 금지·에셋 인라인) 반영 |

---

## 1. 개요 (Environment)

- **목적**: DB(스토어)를 읽기 전용으로 시각화하는 로컬 대시보드. 매칭 물건·이벤트 이력·D-day 카운트다운·(enrich 존재 시) 할인율을 브라우저에서 조회한다. (기획서 §4.2 F5)
- **범위**: `apps/dashboard` — v1.x는 **단일 HTML** (Next.js 전환은 이후, 기획서 §11).
- **의존**: SPEC-COLLECTOR-001(스토어·events), SPEC-ENRICH-001(할인율 표시 — 소프트 의존).

## 2. 가정 (Assumptions)

- A1. 사용자는 로컬 머신에서 CLI로 대시보드를 실행하며, 외부 공개(포트포워딩)는 지원·권장하지 않는다.
- A2. 알림(텔레그램)과 대시보드는 동일 events 스트림을 소비한다 — 데이터 불일치가 없어야 한다. (기획서 §5 설계원칙 2)
- A3. 단일 HTML 규모에서는 프레임워크 없이(또는 초경량으로) 충분하며, 빌드 산출물은 오프라인에서 완전 동작해야 한다.

## 3. 요구사항 (Requirements — EARS)

### 모듈 1: 읽기 전용 & 보안 경계

- **UI-REQ-001** (Ubiquitous): The system shall 스토어에 대해 읽기 전용으로만 접근해야 한다 — 대시보드 코드 경로에 어떠한 쓰기(INSERT/UPDATE/DELETE) 쿼리도 존재하지 않아야 한다.
- **UI-REQ-002** (Ubiquitous): The system shall 로컬 서버를 `127.0.0.1`(localhost)에만 바인딩해야 한다. [반영 권장: 외부 노출 방지]
- **UI-REQ-003** (Unwanted): The system shall 외부 네트워크 호출(CDN 에셋 포함)을 수행하지 않아야 한다 — 모든 CSS/JS/폰트는 단일 HTML에 인라인. (기획서 §8 프라이버시: 텔레메트리 없음)

### 모듈 2: 데이터 표시

- **UI-REQ-004** (Event-driven): WHEN 대시보드가 로드되면 THEN the system shall 현재 물건 목록(감정가·최저가·유찰 횟수·매각기일 D-day), 이벤트 이력(new/price_drop/changed/cancelled/d7/d1), 워치리스트별 매칭 현황을 events 스트림 기준으로 렌더링해야 한다.
- **UI-REQ-005** (State-driven): IF 물건에 enrich 결과가 존재하면 THEN the system shall 할인율·표본 수·신뢰도 등급을 텔레그램 메시지와 동일한 강조 규칙(신뢰도 "낮음"/"참고치"는 굵게 표시 금지)으로 표시해야 한다. (SPEC-ENRICH-001 REQ-011 계약)
- **UI-REQ-006** (Ubiquitous): The system shall 모든 화면에 "공고 시점 기준 · 입찰 전 원문/등기부 재확인" 고지를 고정 표시하고, 각 물건에 법원 원문 링크를 제공해야 한다. (기획서 §8 신뢰성, §6.5)

### 모듈 3: 필터 & 상태 표시

- **UI-REQ-007** (Event-driven): WHEN 사용자가 워치리스트·이벤트 타입·기간 필터를 선택하면 THEN the system shall 목록을 해당 조건으로 갱신해야 한다.
- **UI-REQ-008** (State-driven): IF 마지막 sync가 차단(blocked=1) 또는 실패 상태이면 THEN the system shall 대시보드 상단에 경고 배너(마지막 성공 sync 시각 포함)를 표시해야 한다.
- **UI-REQ-009** (Optional): Where 매각기일이 임박한(D-7 이내) 물건이 있으면, the system may 별도 "임박" 섹션으로 상단 고정 표시할 수 있다.

## 4. 명세 (Specifications)

- 실행: CLI 또는 `apps/dashboard` 스크립트로 로컬 HTTP 서버 기동 → 브라우저 오픈. 데이터는 서버 사이드에서 스토어를 읽어 JSON으로 제공하거나 정적 생성.
- 가격 표기: 억/만 환산 규칙을 SPEC-ALERT-001 렌더러와 공유(동일 유틸 재사용).
- v1.x 산출물: 단일 HTML(에셋 인라인). Next.js 전환은 별도 SPEC.

## 5. 추적성 (Traceability)

| 요구사항 | 기획서 근거 |
|---|---|
| REQ-001~003 | §4.2 F5 (DB 읽기 전용), §8 프라이버시 |
| REQ-004~006 | §5 설계원칙 2, §6.5, §8 신뢰성 |
| REQ-007~009 | §3 사용자 스토리, §6.3 |

## 6. Out of Scope / 백로그

- **Next.js 전환** — v1.x 이후 (기획서 §11 "단일 HTML → Next.js").
- **원격 접근/인증(외부 공개 모드)** — 백로그. 셀프호스팅 원칙상 로컬 전용 유지가 기본.
- **대시보드에서 워치리스트 편집(쓰기 기능)** — 백로그. v1.x는 읽기 전용 원칙 고수, 편집은 CLI(watch) 담당.
- **차트/시세 추이 시각화** — 백로그.
- **권리분석 체크리스트 UI (F6)** — v2 (기획서 §4.3).
- **다크 모드·i18n** — 백로그.
