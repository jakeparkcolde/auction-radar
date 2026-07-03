# SPEC-ALERT-001 구현 계획

> Traceability: SPEC-ALERT-001 (spec.md) · 기획서 v0.2 §6.3~6.5, §6.7, §12 (M1~M2)

## 1. 마일스톤 (우선순위 기반)

### Primary Goal — 신건 알림 최소 경로 (기획서 M1: 1차 공개 범위)

1. `packages/alert` 패키지 골격 + Notifier 인터페이스(`send`/`sendDigest`) 정의
2. TelegramNotifier: Bot API `sendMessage`(parse_mode=HTML), 1.1s 발송 간 지연
3. HTML 이스케이프 유틸 (모든 스크랩 유래 문자열 필수 적용, REQ-011)
4. 매칭 엔진 v1: courts + region_norm prefix + usages + 가격 조건 + includeNew
5. 이벤트 소비 커서: notifications LEFT JOIN 기반 미발송 식별 (REQ-005)
6. 메시지 렌더러: §6.5 포맷, 억/만 환산, 면책 고지 자동 포함
7. first-run digest 강제 경로

### Secondary Goal — 알림 완성 (기획서 M2)

1. digest 규칙 전체(≤5 / 6~30 / 31+) + 4,096자 분할 (REQ-012, 013)
2. keywords / excludeKeywords 매칭 (REQ-004)
3. 재시도: 지수 백오프 2회 + failed 기록 + 다음 sync 재발송 (REQ-014)
4. quiet hours: held + deliver_after, 아침 합산 digest, d1 예외 (REQ-015, 016)
5. D-day Generator: 07:50 Asia/Seoul, schedules 스캔, d7/d1 이벤트 (REQ-007~009)
6. 타임존 유틸: Asia/Seoul 고정 연산 (REQ-008)

### Final Goal — enrich 연동 슬롯 (M3 대비)

1. 메시지 렌더러에 할인율 라인 optional slot (REQ-017) — SPEC-ENRICH-001 데이터 존재 시에만 렌더링

## 2. 기술 스택

| 구성요소 | 선택 | 비고 |
|---|---|---|
| 텔레그램 클라이언트 | **raw Bot API (fetch 직접 호출)** — 1차 선택 | 결정 노트: telegraf >= 4.16은 봇 프레임워크(수신·미들웨어 중심)로 발송 전용 용도에 과함. `sendMessage` 1개 엔드포인트만 필요하므로 Node 20 내장 fetch로 직접 호출 → 의존성 0. 수신 기능(명령 봇)이 생기면 telegraf 재검토 |
| 타임존 | Intl API 기반 자체 유틸 또는 date-fns-tz >= 3 | Asia/Seoul 고정. luxon/dayjs 대비 경량 선택 |
| 스토어 접근 | packages/store 드라이버 인터페이스 | SPEC-COLLECTOR-001 계약 준수, prepared statements |
| 테스트 | vitest + **mock 텔레그램 서버 유틸** | 로컬 HTTP 서버로 sendMessage 캡처. 재사용 가능한 테스트 유틸로 export (F8 컨트리뷰터용) |

## 3. 다른 SPEC과의 의존 관계

- **선행**: SPEC-COLLECTOR-001 — events/schedules/watchlists/notifications 스키마, 스토어 드라이버, region_norm 값
- **후행**: SPEC-CLI-001 — sync 명령이 매칭→발송 경로 호출, watch test가 매칭 엔진 dry 평가 사용
- **소프트 의존**: SPEC-ENRICH-001 — 할인율 렌더링 슬롯 (부재 시 정상 동작 필수)

## 4. 리스크 분석 및 대응 (기획서 §14 연계)

| 리스크 | 영향 | 대응 |
|---|---|---|
| 알림 폭주로 사용자 이탈 | 중 | first-run digest 강제, digest 임계값(6/31), quiet hours (기획서 §14) |
| 텔레그램 rate limit 초과(429) | 중 | 1.1s 발송 간 지연 + 지수 백오프, retry_after 헤더 존중 |
| HTML injection (스크랩 원문 유래) | 중 | 전 보간 문자열 이스케이프 강제 + 음성 테스트 케이스 |
| 타임존 오판으로 D-day 누락/중복 | 상 | Asia/Seoul 고정 연산 + UTC 머신 시뮬레이션 테스트 |
| 4096자 초과로 발송 실패 | 저 | 렌더링 후 길이 검사 → 분할/절단 |
| 수집 실패 시 리마인더 미발송 | 상 | D-day Generator 완전 분리 실행 (REQ-009) — 차단 상태 테스트로 검증 |

## 5. 테스트 전략 (기획서 §9)

- mock 텔레그램 서버: 로컬 HTTP 서버로 발송 요청 캡처·검증 (E2E smoke의 공용 유틸)
- digest 경계값 테스트: 5/6/30/31건 정확 경계
- quiet hours 경계 테스트: 22:59/23:00/06:59/07:00 (Asia/Seoul) + d1 예외
- 상태 전이 시나리오: 신건→유찰→기일변경→취하 이벤트가 올바른 메시지로 렌더링 (M2 DoD)
- 커버리지 목표: matcher·digest·quiet hours·renderer 85%+
