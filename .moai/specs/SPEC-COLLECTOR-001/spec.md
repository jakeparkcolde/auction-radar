---
id: SPEC-COLLECTOR-001
version: 0.1.0
status: draft
created: 2026-07-03
updated: 2026-07-03
author: Jake / COLDBYTE
priority: high
lifecycle_level: spec-first
---

# SPEC-COLLECTOR-001: 법원경매 수집 파이프라인 · 데이터 스토어 · 이벤트/diff 엔진

## HISTORY

| 버전 | 날짜 | 내용 |
|---|---|---|
| v0.1.0 | 2026-07-03 | 최초 작성 — 기획서 v0.2 §5, §6.1~6.3, §8, §9, §11 기반 EARS 명세화. [반영 권장] 항목(마이그레이션 테이블, sync lockfile, state_hash 정규화, raw_snapshots 보존 정책, prepared statements, fixture 익명화) 반영 |

---

## 1. 개요 (Environment)

- **목적**: courtauction.go.kr 매각공고를 스로틀링·budget 제약 하에 증분 수집하고, SQLite 스토어에 upsert한 뒤 state_hash 기반 diff로 상태 변화 이벤트를 생성하는 파이프라인. (기획서 §5, §6.2)
- **범위**: `packages/core`(endpoints 상수, 수집, 스로틀링, 파싱, diff, 용도 매핑표), `packages/store`(드라이버 인터페이스 + SQLite), 모노레포 스캐폴딩(M0), `fixtures/` 테스트 인프라.
- **데이터 소스**: courtauction.go.kr 내부 WebSquare XHR 4종 (기획서 §6.2 표). 공식 API 없음. npm `court-auction-notice-search`(MIT) 래핑.
- **런타임**: Node 20+, TypeScript, macOS/Linux 우선 (기획서 §8 이식성).

## 2. 가정 (Assumptions)

- A1. courtauction.go.kr 내부 엔드포인트는 예고 없이 변경될 수 있다 → endpoints 버전 상수 분리 + raw 보존으로 사후 대응. (기획서 §14)
- A2. 연속 호출 시 IP가 약 1시간 차단된다 → 2초+ 딜레이·budget 하한은 협상 불가 제약. (기획서 §10)
- A3. `court-auction-notice-search` 패키지는 단일 메인테이너 리스크가 있다 → 내부 Transport/SourceClient 인터페이스 뒤로 격리, 정확한 버전 고정.
- A4. MVP 스토어는 SQLite 단일 드라이버. Supabase는 v1.x. (기획서 §6.1)

## 3. 요구사항 (Requirements — EARS)

### 모듈 1: 스로틀링 & Budget (기획서 §6.2 스로틀링 정책, §8 크롤링 윤리)

- **COLLECTOR-REQ-001** (Ubiquitous): The system shall courtauction.go.kr 대상 모든 호출 사이에 최소 2,000ms 지연을 적용해야 하며, `minDelayMs`가 2000 미만으로 설정된 경우 해당 값을 무시하고 2000ms를 적용해야 한다(하한 하드코딩).
- **COLLECTOR-REQ-002** (Ubiquitous): The system shall 세션당 호출 budget(기본 10회, `--max-calls` 명시 시 최대 30회)을 강제해야 하며, budget 소진 시 수집을 중단하고 잔량 0을 sync_runs에 기록해야 한다.
- **COLLECTOR-REQ-003** (State-driven): IF 응답에 `data.ipcheck === false`(차단 감지)가 포함되면 THEN the system shall 즉시 sync를 중단하고 `sync_runs.blocked=1`을 기록하며 복구 안내(약 1시간)를 출력해야 한다.
- **COLLECTOR-REQ-004** (Unwanted): The system shall 차단 감지 후 자동 재시도를 수행하지 않아야 한다(차단 연장 방지). The system shall 전체 공고 상세의 무조건 재조회(full re-fetch)를 수행하지 않아야 한다 — 신규/변경 의심 공고만 상세 펼치기.

### 모듈 2: 수집 절차 (기획서 §6.2 수집 절차)

- **COLLECTOR-REQ-005** (Event-driven): WHEN `sync`가 시작되면 THEN the system shall ① warmup으로 세션 쿠키를 확보하고 ② 워치리스트에서 대상 법원 집합을 도출하며(조건에 법원이 없으면 전체 대상 + 경고 출력) ③ 법원별 당월+익월 공고 목록을 조회해야 한다.
- **COLLECTOR-REQ-006** (Event-driven): WHEN 공고 카드가 신규이거나 변경 의심으로 판정되면 THEN the system shall 해당 공고만 `selectRletDspslPbancDtl`로 상세 펼치기를 수행해야 한다.
- **COLLECTOR-REQ-007** (State-driven): IF 이미 실행 중인 sync가 존재하면(lockfile 감지) THEN the system shall 새 sync 실행을 거부하고 안내 메시지를 출력해야 한다. [반영 권장: 동시 sync 방지 — cron/launchd와 수동 실행 중첩 시 요청 속도 2배로 차단 리스크 발생]
- **COLLECTOR-REQ-008** (Optional): Where 직접 HTTP transport가 차단·5xx로 실패하면, the system may playwright-core fallback transport로 전환할 수 있다(optional dependency로 패키징).

### 모듈 3: 스토어 & 스키마 (기획서 §6.1)

- **COLLECTOR-REQ-009** (Ubiquitous): The system shall 기획서 §6.1의 스키마(cases, items, schedules, events, watchlists, matches, notifications, rt_trades, sync_runs, raw_snapshots)를 SQLite로 구현하고, `store` 패키지의 드라이버 인터페이스(`get/upsert/query/tx`)를 통해서만 접근해야 한다.
- **COLLECTOR-REQ-010** (Ubiquitous): The system shall `schema_migrations` 테이블 기반 forward-only 마이그레이션 러너를 제공해야 하며, 앱 시작 시 스키마 버전을 검사하고 필요한 마이그레이션을 순차 적용해야 한다. [반영 권장: DB 마이그레이션 전략 — 셀프호스팅 사용자의 업그레이드 경로 보장]
- **COLLECTOR-REQ-011** (Unwanted): The system shall 문자열 보간(string interpolation)으로 SQL을 구성하지 않아야 한다 — 모든 쿼리는 prepared statement로만 실행. [반영 권장: SQL injection 방지 — 워치리스트 keywords/excludeKeywords가 쿼리로 유입됨]
- **COLLECTOR-REQ-012** (Ubiquitous): The system shall 사건번호를 정규화 규칙(공백 제거, 전각→반각 변환, "2025타경12345" 표준형)에 따라 저장해야 하며, 정규화 함수는 테스트 벡터로 검증되어야 한다. [반영 권장: 사건번호 정규화 edge case]

### 모듈 4: 이벤트 & diff (기획서 §6.3)

- **COLLECTOR-REQ-013** (Ubiquitous): The system shall `state_hash = sha1(min_sale_price | failed_count | 다음 sale_date | correction_count | cancellation_count | status)`를 **정준 직렬화 규칙**(구분자 `|` 고정, null은 리터럴 문자열 `"null"`, 필드 순서 고정, 숫자는 십진 문자열)에 따라 계산해야 하며, 직렬화 포맷은 fixture 테스트로 고정되어야 한다. [반영 권장: state_hash 정준화 — 리팩토링 시 해시 변동으로 인한 changed 이벤트 폭주 방지]
- **COLLECTOR-REQ-014** (Event-driven): WHEN item upsert 후 state_hash가 저장값과 다르면 THEN the system shall §6.3 규칙에 따라 이벤트를 생성해야 한다: `new`(최초 upsert, dedup_key `{item_id}:new`), `price_drop`(failed_count 증가 또는 min_sale_price 감소, `{item_id}:drop:{failed_count}`), `changed`(sale_date 변경/correction·cancellation 증가/status 변경, `{item_id}:chg:{state_hash}`), `cancelled`(취하·정지 계열 전이, `{item_id}:cancel`).
- **COLLECTOR-REQ-015** (Ubiquitous): The system shall dedup_key UNIQUE 제약으로 중복 이벤트 삽입을 DB 레벨에서 차단해야 하며(멱등 sync), 이벤트 payload에 변화 전/후 값을 JSON으로 저장해 알림 렌더링 시 재계산이 불필요해야 한다.

### 모듈 5: 파싱 실패 처리 & raw 보존 (기획서 §5 설계원칙 3, §6.2 파싱 실패 처리)

- **COLLECTOR-REQ-016** (Event-driven): WHEN 응답 레코드의 필드 누락·형변환 실패가 발생하면 THEN the system shall 해당 레코드만 skip하고 원본 요청/응답을 `raw_snapshots(parse_ok=0)`로 저장하며 경고 카운트를 증가시키되, sync 전체를 실패시키지 않아야 한다.
- **COLLECTOR-REQ-017** (Ubiquitous): The system shall raw_snapshots에 보존 정책(retention)을 적용해야 한다: parse_ok=1 스냅샷은 30일, parse_ok=0 스냅샷은 최근 N건(기본 200건) 유지 후 정리. [반영 권장: raw_snapshots 무한 증가 방지]
- **COLLECTOR-REQ-018** (Unwanted): The system shall 공개 레포에 커밋되는 fixture에 원문 그대로의 개인정보(당사자 성명, 상세 주소 지번)를 포함하지 않아야 한다 — 익명화 체크리스트 통과 후에만 fixtures/에 저장. [반영 권장: fixture PII 익명화]
- **COLLECTOR-REQ-019** (Optional): Where 미매핑 용도(usage)가 발견되면, the system may 해당 물건을 표준 카테고리 "기타"로 흘리고 경고 로그를 남길 수 있다(용도 매핑표는 core 상수 + docs 공개, 기획서 §6.4).

## 4. 명세 (Specifications)

- 엔드포인트·파라미터는 `packages/core/src/endpoints.ts` 버전 상수로 분리한다. (기획서 §8)
- 스토어 드라이버 인터페이스는 SQLite 외 구현(Supabase v1.x)이 코드 변경 없이 교체 가능하도록 트랜잭션 경계를 포함한다.
- 모든 sync 실행은 `sync_runs`(started_at, finished_at, calls_used, items_upserted, events_created, blocked, error)에 기록한다.
- 성능 목표: 워치리스트 3개·법원 2곳 기준 1회 sync ≤ budget 10회 / 60초 내 완료. (기획서 §8)

## 5. 추적성 (Traceability)

| 요구사항 | 기획서 근거 |
|---|---|
| REQ-001~004 | §6.2 스로틀링 정책, §8 크롤링 윤리, §14 |
| REQ-005~008 | §6.2 수집 절차, §5 |
| REQ-009~012 | §6.1, §8 |
| REQ-013~015 | §6.3 |
| REQ-016~019 | §5 설계원칙 3, §6.2, §6.4, §9 |

## 6. Out of Scope / 백로그

- **Supabase(Postgres) 어댑터** — v1.x. 드라이버 인터페이스 seam만 본 SPEC에서 확보. (기획서 §6.1)
- **backup/restore 명령** (`auction-radar backup`, SQLite backup API 사용) — 백로그.
- **구조화 로깅 / 로그 파일 로테이션** — 백로그. 본 SPEC에서는 sync 요약 라인(calls/items/events)만 기계 파싱 가능하게 출력.
- **온비드(공매) 모듈** — 기획서 §4.4 명시적 비지원, 추후 별도 모듈 후보.
- **명세서·감정평가서 PDF 일괄 다운로드** — 기획서 §4.4 비지원.
- **lawd-codes.csv 출처·갱신 프로세스 문서화** — 백로그 (SPEC-ENRICH-001 참조와 공유).
