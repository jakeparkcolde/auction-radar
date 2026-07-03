---
id: SPEC-ALERT-001
version: 0.1.0
status: draft
created: 2026-07-03
updated: 2026-07-03
author: Jake / COLDBYTE
priority: high
lifecycle_level: spec-first
---

# SPEC-ALERT-001: 워치리스트 매칭 엔진 · D-day Generator · 텔레그램 알림

## HISTORY

| 버전 | 날짜 | 내용 |
|---|---|---|
| v0.1.0 | 2026-07-03 | 최초 작성 — 기획서 v0.2 §6.3(d7/d1), §6.4, §6.5, §6.7 기반 EARS 명세화. [반영 권장] 항목(이벤트 소비 커서, held/deliver_after, Asia/Seoul 타임존 고정, HTML 이스케이프, 4096자 분할, mock 텔레그램 테스트 유틸) 반영 |

---

## 1. 개요 (Environment)

- **목적**: events 스트림을 워치리스트 조건과 매칭하고, digest·quiet hours 규칙에 따라 텔레그램(Bot API)으로 발송한다. 수집과 독립 동작하는 D-day Generator가 D-7/D-1 리마인더 이벤트를 생성한다. (기획서 §5 설계원칙 1·2, §6.4~6.5)
- **범위**: `packages/alert`(matcher, notifier(telegram), digest, quiet hours, D-day generator).
- **의존**: SPEC-COLLECTOR-001의 events/schedules/watchlists/notifications 테이블, 스토어 드라이버, region_norm.

## 2. 가정 (Assumptions)

- A1. 텔레그램 Bot API rate limit은 같은 chat 기준 초당 약 1건 → 발송 간 1.1s 지연 필요. (기획서 §6.5)
- A2. 매각기일·quiet hours 등 모든 시각 판단은 **Asia/Seoul(KST)** 기준이다 — 셀프호스팅 머신의 시스템 타임존(UTC 등)과 무관. (기획서에 미명시, [반영 권장] 반영)
- A3. 첫 sync에서는 과거 물건 전체가 '신건'으로 유입되므로 digest 강제가 필수. (기획서 §6.5)
- A4. 알림 채널 확장(디스코드·Slack·이메일)은 v2 — Notifier 인터페이스만 본 SPEC에서 확정. (기획서 §4.3 F8)

## 3. 요구사항 (Requirements — EARS)

### 모듈 1: 매칭 엔진 (기획서 §6.4)

- **ALERT-REQ-001** (Event-driven): WHEN sync가 완료되어 미처리 이벤트가 존재하면 THEN the system shall 각 이벤트를 enabled=1인 모든 워치리스트 config(courts, regions, usages, appraisedMax/Min, minPriceRatioMax, failedCountMin, includeNew, keywords, excludeKeywords, notify)와 평가하고 매칭 결과를 matches 테이블에 기록해야 한다.
- **ALERT-REQ-002** (Ubiquitous): The system shall 지역 매칭을 3계층 순서로만 수행해야 한다: ① 법원 코드(수집 범위 결정) ② region_norm prefix 매칭 ③ lawd_cd(실거래 결합 전용). 정규화되지 않은 원문 주소 문자열에 대한 직접 매칭을 수행하지 않아야 한다.
- **ALERT-REQ-003** (State-driven): IF 이벤트 type이 `new`이고 워치리스트의 `includeNew=true`이면 THEN the system shall minPriceRatioMax·failedCountMin 조건을 무시하고 매칭시켜야 한다.
- **ALERT-REQ-004** (State-driven): IF item의 remarks 또는 주소에 excludeKeywords(예: "지분", "유치권")가 포함되면 THEN the system shall 해당 워치리스트 매칭에서 제외해야 한다.

### 모듈 2: 이벤트 소비 커서 (기획서 §5 설계원칙 2 + [반영 권장])

- **ALERT-REQ-005** (Ubiquitous): The system shall "미발송 이벤트"를 notifications 테이블과의 LEFT JOIN(event_id 부재 또는 status IN ('failed','held'))으로 식별해야 하며, 발송 성공 시 status='sent', 실패 시 status='failed', 보류 시 status='held'와 `deliver_after`(발송 가능 시각)를 기록해야 한다. [반영 권장: 이벤트 소비 커서 명세화 — 재시도·quiet hours 보류의 단일 저장 위치]
- **ALERT-REQ-006** (Unwanted): The system shall 동일 event_id에 대해 같은 채널로 중복 알림을 발송하지 않아야 한다 (notifications 조회 기반 방어).

### 모듈 3: D-day Generator (기획서 §5 설계원칙 1, §6.3)

- **ALERT-REQ-007** (Event-driven): WHEN D-day Generator가 매일 07:50(Asia/Seoul)에 실행되면 THEN the system shall schedules를 스캔해 매각기일 D-7/D-1에 해당하는 물건에 대해 `d7`/`d1` 이벤트(dedup_key `{item_id}:d7:{sale_date}` / `{item_id}:d1:{sale_date}`)를 생성해야 한다.
- **ALERT-REQ-008** (Ubiquitous): The system shall D-day 계산·quiet hours 판정·발송 시각 등 모든 시간 연산을 Asia/Seoul 타임존으로 고정 수행해야 한다(시스템 타임존 비의존). [반영 권장: 타임존 고정]
- **ALERT-REQ-009** (Unwanted): The system shall D-day 이벤트 생성을 수집기 성공 여부에 의존시키지 않아야 한다 — 사이트 차단 상태에서도 DB의 기존 기일 데이터만으로 리마인더가 발송되어야 한다.

### 모듈 4: 텔레그램 발송 & digest (기획서 §6.5)

- **ALERT-REQ-010** (Ubiquitous): The system shall Notifier 인터페이스(`send`, `sendDigest`)를 통해 발송하고, 텔레그램은 parse_mode=HTML로 고정하며(MarkdownV2 금지), 모든 사용자 노출 메시지에 "공고 시점 기준 · 입찰 전 원문/등기부 재확인" 고지를 포함해야 한다.
- **ALERT-REQ-011** (Ubiquitous): The system shall 스크랩 원문에서 유래한 모든 보간 문자열(case_name, 주소, remarks 등)을 HTML 이스케이프 처리 후 메시지에 삽입해야 한다. [반영 권장: HTML injection 방지]
- **ALERT-REQ-012** (Event-driven): WHEN 1회 sync의 매칭 건수가 확정되면 THEN the system shall digest 규칙을 적용해야 한다: ≤5건 개별 발송 / 6~30건 요약 1건 + 상위 5건 상세 + "나머지는 export로 확인" / 31건+ digest만 + 조건 축소 안내 / `--first-run`은 무조건 digest 강제.
- **ALERT-REQ-013** (Ubiquitous): The system shall 단일 메시지가 텔레그램 한도 4,096자를 초과하지 않도록 digest 메시지를 분할 또는 절단(말줄임 + export 안내)해야 한다. [반영 권장: 4096자 한도 대응]
- **ALERT-REQ-014** (State-driven): IF 텔레그램 발송이 실패하면 THEN the system shall 지수 백오프로 최대 2회 재시도하고(발송 간 기본 1.1s 지연 유지), 최종 실패 시 notifications.status='failed'로 기록해 다음 sync에서 재시도해야 한다.

### 모듈 5: Quiet Hours (기획서 §6.7)

- **ALERT-REQ-015** (State-driven): IF 이벤트 발송 시각이 quietHours(기본 23:00~07:00, Asia/Seoul) 내이면 THEN the system shall 발송을 보류(status='held', deliver_after=quiet hours 종료 시각)하고 아침 첫 발송에 digest로 합산해야 한다.
- **ALERT-REQ-016** (State-driven): IF 보류 대상 이벤트의 type이 `d1`이면 THEN the system shall quietHours 규칙의 예외로서 즉시 발송해야 한다. (기획서 §6.7)
- **ALERT-REQ-017** (Optional): Where 실거래 할인율 데이터(SPEC-ENRICH-001)가 존재하면, the system may 메시지에 "인근 실거래 중위값 대비 −N% (표본 n건 · 신뢰도 등급)" 라인을 포함할 수 있다. 데이터 부재 시 해당 라인 없이 정상 발송된다.

## 4. 명세 (Specifications)

- 메시지 포맷: 기획서 §6.5 HTML 템플릿 준수. 가격 표기: 원 단위 정수 → 억/만 환산(소수 둘째 자리 반올림), 1억 미만 "8,450만" 형식.
- payload 기반 렌더링: "3.2억 → 2.56억 (−20%)"은 이벤트 payload의 전/후 값으로 재계산 없이 렌더링.
- Notifier 인터페이스는 v2 채널 확장(F8)을 위해 `packages/alert`에서 export.

## 5. 추적성 (Traceability)

| 요구사항 | 기획서 근거 |
|---|---|
| REQ-001~004 | §6.4 |
| REQ-005~006 | §5 설계원칙 2, §6.5 재시도 |
| REQ-007~009 | §5 설계원칙 1, §6.3 |
| REQ-010~014 | §6.5, §8 신뢰성 |
| REQ-015~017 | §6.7, §6.6 |

## 6. Out of Scope / 백로그

- **알림 채널 확장 (디스코드·Slack·이메일)** — v2 (F8). Notifier 인터페이스만 본 SPEC에서 확정.
- **first-run 자동 감지** (빈 items 테이블이면 `--first-run` 없이 digest 강제) — 백로그. 본 SPEC에서는 플래그 명시 방식.
- **AI 사건 요약 (Claude API BYOK)** — v2 (F7).
- **알림 메시지 i18n** — 백로그 (한국어 고정).
- **워치리스트별 알림 채널 분리 라우팅** — 백로그.
