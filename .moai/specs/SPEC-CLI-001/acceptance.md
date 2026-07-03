# SPEC-CLI-001 인수 기준

> Traceability: SPEC-CLI-001 (spec.md §3) · 기획서 v0.2 §7, §6.7, §9

## 1. 정상 시나리오 (Given-When-Then)

### AC-01. init 마법사 전체 흐름 (REQ-001, 002, 003)

- **Given**: 설정 파일이 없는 새 환경, mock 텔레그램 서버(getUpdates가 chat_id 12345678 포함 업데이트 반환)
- **When**: `auction-radar init`을 실행하고 토큰 입력 → "chat_id 모름" 선택 → 봇에 메시지 전송(mock) → 워치리스트 1건 입력을 완료한다
- **Then**: chat_id가 자동 감지되어 확인 프롬프트에 표시되고, `~/.auction-radar/config.json`이 권한 600으로 생성되며, 테스트 발송 1건이 mock 서버에 수신되고, 발송 메시지에 면책 고지가 포함된다

### AC-02. sync --dry-run (REQ-007)

- **Given**: 유효한 config와 fixture 기반 수집 환경, 매칭 예상 4건
- **When**: `auction-radar sync --dry-run`을 실행한다
- **Then**: 매칭 결과 4건이 stdout에 출력되고, mock 텔레그램 서버에 발송 요청이 0건이며, notifications 테이블에 기록이 생성되지 않는다

### AC-03. watch test 미리보기 (REQ-008)

- **Given**: DB에 물건 50건이 있고 조건에 맞는 물건이 7건인 워치리스트 "테스트"
- **When**: `auction-radar watch test 테스트`를 실행한다
- **Then**: 매칭 건수 7건과 상위 물건 요약이 출력되고 발송은 발생하지 않는다

### AC-04. doctor 진단 (REQ-011)

- **Given**: 유효 토큰(mock getMe 성공), 정상 DB, 마지막 sync 성공, 차단 없음
- **When**: `auction-radar doctor`를 실행한다
- **Then**: 5개 항목(토큰/DB/마지막 sync/차단/스키마 drift)이 모두 pass로 출력되고, 토큰은 마지막 4자만 표시된다

### AC-05. export xlsx (REQ-012)

- **Given**: 워치리스트 "인천 서구 아파트"에 매칭 물건 12건
- **When**: `auction-radar export --xlsx --watch "인천 서구 아파트"`를 실행한다
- **Then**: 12행 + 헤더를 가진 .xlsx 파일이 생성되고 감정가·최저가·기일·주소 컬럼이 포함된다

## 2. 엣지 케이스 시나리오

### AC-06. 평문 토큰 경고 (REQ-003)

- **Given**: init에서 사용자가 `env:` 대신 평문 토큰 입력을 선택
- **When**: 설정 파일이 저장된다
- **Then**: "환경변수 참조(env:TG_TOKEN)를 권장합니다" 경고가 출력되고 파일 권한은 600으로 강제된다

### AC-07. 토큰 마스킹 (REQ-005)

- **Given**: 토큰 `123456:ABCdefGHI`가 설정된 환경
- **When**: doctor·sync 오류 로그·`--dry-run` 출력을 각각 실행한다
- **Then**: 어떤 출력에도 토큰 전문이 나타나지 않고 마스킹 형태(`…dGHI`)만 표시된다

### AC-08. 구버전 config 마이그레이션 (REQ-006)

- **Given**: `version: 0`(가상 구버전) config 파일
- **When**: 아무 명령이나 실행한다
- **Then**: 마이그레이션이 적용되어 version이 갱신되거나, 적용 불가 시 명확한 업그레이드 안내 후 종료 코드 1로 종료된다

### AC-09. 차단 상태 doctor 경고 (REQ-011)

- **Given**: 마지막 sync_runs.blocked=1인 DB
- **When**: `auction-radar doctor`를 실행한다
- **Then**: 차단 항목이 warn/fail로 표시되고 복구 대기(약 1시간) 안내가 출력된다

### AC-10. 법원 미지정 경고 (REQ-015)

- **Given**: courts가 빈 배열인 워치리스트만 존재
- **When**: `auction-radar sync --dry-run`을 실행한다
- **Then**: "전체 법원 수집 — budget이 빠르게 소진됩니다" 경고가 출력된다

### AC-11. --max-calls 상한 (REQ-007 + COLLECTOR 계약)

- **Given**: `auction-radar sync --max-calls 50` 실행
- **When**: 수집이 시작된다
- **Then**: 호출 상한이 30으로 캡되고 그 사실이 출력에 명시된다

### AC-12. schedule install 플랫폼 분기 (REQ-013)

- **Given**: macOS 환경 / Linux 환경 각각
- **When**: `auction-radar schedule install`을 실행한다
- **Then**: macOS에서는 08:00/18:00 launchd plist가 생성·설치 안내되고, Linux에서는 대응 crontab 라인이 출력된다

## 3. 품질 게이트

- [ ] E2E smoke green: init → sync --dry-run → 발송 경로 (mock 텔레그램 서버, 실서버·실 API 호출 0건 in CI)
- [ ] 테스트 커버리지: config·init 로직·doctor·마스킹 유틸 **85% 이상**
- [ ] fixture 테스트 전체 green (COLLECTOR/ALERT 의존 경로 포함)
- [ ] 토큰 전문이 어떤 테스트 출력 스냅샷에도 미포함 (음성 검증)
- [ ] 입찰 자동화 관련 코드·플래그·숨은 기능 부재 확인 (REQ-010, 코드 리뷰 게이트)
- [ ] M1 DoD: 신규 사용자 10분 셋업 수동 리허설 1회 통과 (기획서 §12)
- [ ] lint 0 error, TypeScript strict 0 error
