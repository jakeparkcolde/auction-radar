# SPEC-CLI-001 구현 계획

> Traceability: SPEC-CLI-001 (spec.md) · 기획서 v0.2 §6.7, §7, §12 (M1~M2)

## 1. 마일스톤 (우선순위 기반)

### Primary Goal — M1 필수 명령 (init / sync / doctor)

1. `apps/cli` 골격: 커맨드 라우팅, 공통 출력(고지 자동 포함), 종료 코드 규약
2. config 모듈: 스키마 검증, `env:` 해석, chmod 600, version 필드 (REQ-003~006)
3. 토큰 마스킹 유틸 (모든 출력 경로 공통, REQ-005)
4. `init` 마법사: 토큰 → getUpdates chat_id 자동 감지 → 워치리스트 1건 → 테스트 발송 (REQ-001~002)
5. `sync`: COLLECTOR + ALERT 파이프라인 오케스트레이션, `--dry-run`/`--first-run`/`--max-calls` (REQ-007)
6. `doctor`: 5개 진단 항목 pass/warn/fail (REQ-011)

### Secondary Goal — M2 명령 (watch / case / export / schedule)

1. `watch add|list|rm|test` (REQ-008) — add는 §6.4 config JSON 스키마 대화형 입력
2. `case <법원코드> <사건번호>` 단건 조회 (REQ-009)
3. `export --xlsx [--watch <name>]` (REQ-012)
4. `schedule install`: launchd plist 생성(macOS) / crontab 라인 출력(Linux) (REQ-013)

### Final Goal — 셋업 UX 다듬기

1. 법원 없는 워치리스트 경고 (REQ-015)
2. 신규 사용자 10분 셋업 리허설(수동) — M1 DoD 재현

## 2. 기술 스택

| 구성요소 | 선택 | 비고 |
|---|---|---|
| CLI 프레임워크 | commander >= 12 (또는 citty) | 서브커맨드·플래그 파싱 표준. 경량 우선 |
| 대화형 프롬프트 | @inquirer/prompts >= 5 | init 마법사·watch add |
| 설정 검증 | zod >= 3.23 | config.json 스키마 검증 + 타입 추론 |
| 엑셀 내보내기 | exceljs >= 4.4 | xlsx 쓰기. 스트리밍 writer로 대량 export 대비 |
| 텔레그램 검증 | raw Bot API (getMe/getUpdates) — fetch 직접 | SPEC-ALERT-001 결정과 일치 (telegraf 불채택) |
| 배포 | npm publish, `npx auction-radar` 실행 지원 | bin 필드 + shebang, Node >= 20 engines 명시 |

주: 정확한 안정 버전은 /moai:2-run 단계에서 최종 확인.

## 3. 다른 SPEC과의 의존 관계

- **선행**: SPEC-COLLECTOR-001(sync·case·doctor의 DB/수집 접근), SPEC-ALERT-001(발송·테스트 발송·매칭 미리보기)
- **병행 가능**: config 모듈·명령 골격·마스킹 유틸은 선행 SPEC 인터페이스 확정 후 즉시 병행 개발 가능
- **후행**: SPEC-UI-001(dashboard 실행 진입점을 CLI에 추가할 수 있음 — 백로그)

## 4. 리스크 분석 및 대응

| 리스크 | 영향 | 대응 |
|---|---|---|
| init 마찰로 10분 목표 실패 | 상 (제품 목표 직결) | getUpdates chat_id 자동 감지, 단계별 재시작 가능(중단 시 이어하기), M1 DoD 수동 리허설 |
| 토큰 유출 (로그·이슈 리포트 첨부) | 상 | 전 출력 경로 마스킹 강제 + doctor 출력 스냅샷 테스트 |
| config 스키마 변경으로 기존 사용자 파손 | 중 | version 필드 + 설정 마이그레이션/안내 (REQ-006) |
| launchd/cron 환경 차이 (PATH, 환경변수) | 중 | plist에 절대경로 사용, `env:` 토큰의 launchd EnvironmentVariables 안내 문서화 |
| Windows 동작 불일치 | 저 | best-effort 명시, chmod no-op 경고 문서화 |

## 5. 테스트 전략 (기획서 §9)

- E2E smoke: `--dry-run` + mock 텔레그램 서버(SPEC-ALERT-001 유틸)로 init→sync→발송 경로 검증
- init 마법사: 프롬프트 입력 시뮬레이션(inquirer 테스트 어댑터) + getUpdates mock
- doctor: 각 진단 항목의 pass/warn/fail 3상태 fixture
- config: 잘못된 스키마·구버전·`env:` 미설정 케이스
- 커버리지 목표: config·init·doctor 로직 85%+ (프롬프트 UI 레이어 제외 가능, 사유 명기)
