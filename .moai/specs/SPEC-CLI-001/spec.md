---
id: SPEC-CLI-001
version: 0.1.0
status: draft
created: 2026-07-03
updated: 2026-07-03
author: Jake / COLDBYTE
priority: high
lifecycle_level: spec-first
---

# SPEC-CLI-001: CLI 명령 · init 마법사 · 설정 관리 · doctor · export · 스케줄링

## HISTORY

| 버전 | 날짜 | 내용 |
|---|---|---|
| v0.1.0 | 2026-07-03 | 최초 작성 — 기획서 v0.2 §6.7, §7, §8 기반 EARS 명세화. [반영 권장] 항목(getUpdates 기반 chat_id 자동 감지, 토큰 로그 마스킹) 반영 |

---

## 1. 개요 (Environment)

- **목적**: `apps/cli` — init/sync/watch/case/export/doctor/schedule 명령을 제공하는 사용자 인터페이스. 제품 목표 "`npx auction-radar init` → 첫 텔레그램 알림 수신까지 10분 이내"(기획서 §2)의 책임 주체.
- **범위**: CLI 명령 7종(기획서 §7 표), 설정 파일(`~/.auction-radar/config.json`, §6.7), launchd/cron 스케줄 안내.
- **의존**: SPEC-COLLECTOR-001(sync 파이프라인), SPEC-ALERT-001(매칭·발송·테스트 발송).

## 2. 가정 (Assumptions)

- A1. 주 타겟(P1 개발자 겸업 투자자)은 터미널 사용이 가능하나 텔레그램 chat_id 확인 방법은 모른다 → init 마법사가 자동 감지해야 10분 목표 달성 가능.
- A2. macOS/Linux 우선, Windows는 best-effort (chmod 600은 Windows에서 no-op). (기획서 §8)
- A3. 스케줄러는 OS 네이티브(launchd/cron)를 사용하며 CLI는 설치 안내·파일 생성만 담당. (기획서 §7)

## 3. 요구사항 (Requirements — EARS)

### 모듈 1: init 마법사 (기획서 §7, §2)

- **CLI-REQ-001** (Event-driven): WHEN `npx auction-radar init`이 실행되면 THEN the system shall 대화형 마법사로 ① 텔레그램 봇 토큰 입력(`env:` 프리픽스 권장 안내) ② chat_id 확보 ③ 첫 워치리스트 조건 생성 ④ 테스트 발송 1건 순서를 완료해야 한다.
- **CLI-REQ-002** (Event-driven): WHEN 사용자가 chat_id를 모른다고 응답하면 THEN the system shall "봇에게 아무 메시지나 보내세요" 안내 후 Bot API `getUpdates`를 폴링해 chat_id를 자동 감지하고 사용자 확인을 받아야 한다. [반영 권장: chat_id 자동 감지 — 10분 셋업 목표의 최대 마찰 지점 해소]
- **CLI-REQ-003** (Event-driven): WHEN 설정 파일이 생성되면 THEN the system shall 파일 권한을 600으로 강제(chmod)하고, 토큰이 `env:` 참조가 아닌 평문으로 저장되는 경우 경고를 출력해야 한다. (기획서 §6.7)

### 모듈 2: 설정 관리 (기획서 §6.7)

- **CLI-REQ-004** (Ubiquitous): The system shall `~/.auction-radar/config.json`을 §6.7 스키마(version, telegram, store, collector, enrich, notify, watchlists)로 관리하고, 로드 시 스키마 검증을 수행하며, `env:` 프리픽스 값은 환경변수에서 해석해야 한다.
- **CLI-REQ-005** (Unwanted): The system shall 텔레그램 토큰·MOLIT 키를 로그·콘솔·doctor 출력에 평문 노출하지 않아야 한다 — 마지막 4자만 표시(마스킹). [반영 권장: 토큰 로그 마스킹]
- **CLI-REQ-006** (State-driven): IF config의 `version`이 현재 지원 버전보다 낮으면 THEN the system shall 설정 마이그레이션을 적용하거나 명확한 업그레이드 안내를 출력해야 한다.

### 모듈 3: sync / watch / case 명령 (기획서 §7)

- **CLI-REQ-007** (Event-driven): WHEN `sync [--first-run] [--dry-run] [--max-calls N]`이 실행되면 THEN the system shall 수집 → 매칭 → 발송 파이프라인을 실행하되, `--dry-run`이면 발송 없이 매칭 결과만 stdout에 출력해야 한다.
- **CLI-REQ-008** (Event-driven): WHEN `watch add|list|rm|test <name>`이 실행되면 THEN the system shall 워치리스트 CRUD를 수행하고, `test`는 현재 DB 기준 매칭 건수 미리보기를 발송 없이 출력해야 한다.
- **CLI-REQ-009** (Event-driven): WHEN `case <법원코드> <사건번호>`가 실행되면 THEN the system shall 사건 단건 조회(기일 이력 포함)를 수행해 출력해야 한다 (budget·스로틀링 규칙은 COLLECTOR 규칙 준수).
- **CLI-REQ-010** (Unwanted): The system shall 입찰서 자동 작성·자동 제출 기능을 어떤 형태로도 제공하지 않아야 한다. (기획서 §4.4 레포 철학)

### 모듈 4: doctor & export (기획서 §7)

- **CLI-REQ-011** (Event-driven): WHEN `doctor`가 실행되면 THEN the system shall 다음 항목을 pass/warn/fail로 진단해야 한다: ① 텔레그램 토큰 유효성(`getMe`) ② DB 무결성·스키마 버전 ③ 마지막 sync 상태 ④ 차단 여부(blocked) ⑤ 응답 스키마 drift 경고.
- **CLI-REQ-012** (Event-driven): WHEN `export --xlsx [--watch <name>]`이 실행되면 THEN the system shall 매칭 물건을 엑셀 파일로 내보내야 한다 (P2 스터디 공유 스토리, 기획서 §3).
- **CLI-REQ-013** (Optional): Where 플랫폼이 macOS이면, the system may `schedule install`로 launchd plist(08:00/18:00)를 생성·설치 안내할 수 있다. Linux에서는 crontab 라인을 출력한다. (기획서 §7 launchd 예시)

### 모듈 5: 공통 출력 규칙 (기획서 §8)

- **CLI-REQ-014** (Ubiquitous): The system shall 모든 사용자 노출 출력(테스트 발송 포함)에 "공고 시점 기준 · 입찰 전 원문 재확인" 고지를 자동 포함해야 한다.
- **CLI-REQ-015** (State-driven): IF 워치리스트 조건에 법원이 지정되지 않았으면 THEN the system shall 전체 법원 수집 경고("budget이 빠르게 소진됩니다")를 출력해야 한다. (기획서 §6.2)

## 4. 명세 (Specifications)

- 명령 체계: `auction-radar <command> [subcommand] [flags]`. 종료 코드: 성공 0, 사용자 입력 오류 2, 실행 실패 1.
- init 완료 조건: 테스트 발송 1건이 실제 수신 확인될 것 (10분 목표 DoD, 기획서 M1).
- `--max-calls`는 COLLECTOR의 상한 30을 초과할 수 없다.

## 5. 추적성 (Traceability)

| 요구사항 | 기획서 근거 |
|---|---|
| REQ-001~003 | §7 init, §6.7, §2 |
| REQ-004~006 | §6.7 |
| REQ-007~010 | §7, §4.4 |
| REQ-011~013 | §7 doctor/export/schedule |
| REQ-014~015 | §8 신뢰성, §6.2 |

## 6. Out of Scope / 백로그

- **doctor 종료 코드 세분화** (실패 클래스별 non-zero 코드로 cron 헬스체크 스크립팅 지원) — 백로그.
- **backup/restore 명령** — 백로그 (SPEC-COLLECTOR-001 백로그와 공유).
- **Windows 파일 권한(icacls) 대응** — 백로그. Windows는 best-effort, docs에 한계 명시.
- **`--verbose` 구조화 로깅 / 로그 파일** — 백로그.
- **영문 CLI 메시지 i18n** — 백로그 (README 영문 요약은 별도 docs 작업).
- **schedule install의 systemd timer 지원** — 백로그 (crontab 안내로 충분).
