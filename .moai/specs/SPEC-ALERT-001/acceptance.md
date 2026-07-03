# SPEC-ALERT-001 인수 기준

> Traceability: SPEC-ALERT-001 (spec.md §3) · 기획서 v0.2 §6.4~6.5, §6.7, §9

## 1. 정상 시나리오 (Given-When-Then)

### AC-01. 워치리스트 매칭 → 개별 발송 (REQ-001, 012)

- **Given**: 워치리스트 "인천 서구 아파트"(courts=[B000280], regions=["인천 서구"], usages=["아파트"], appraisedMax=5억, failedCountMin=1)와 조건에 맞는 `price_drop` 이벤트 3건, mock 텔레그램 서버
- **When**: 매칭·발송을 실행한다
- **Then**: 3건이 개별 메시지로 발송되고(≤5 규칙), 각 메시지는 parse_mode=HTML, "3.2억 → 2.56억 (−20%)" 형식 가격, 면책 고지를 포함하며, notifications에 status='sent' 3건이 기록된다

### AC-02. D-day 리마인더 (REQ-007, 009)

- **Given**: schedules에 매각기일이 오늘+7일인 물건 A, 오늘+1일인 물건 B가 있고, 수집기는 차단 상태(blocked=1)이다
- **When**: D-day Generator가 07:50(Asia/Seoul)에 실행된다
- **Then**: A에 `d7`, B에 `d1` 이벤트가 dedup_key와 함께 생성되고, 수집 실패와 무관하게 텔레그램 발송까지 완료된다

### AC-03. includeNew 신건 우회 (REQ-003)

- **Given**: failedCountMin=1, minPriceRatioMax=0.8, includeNew=true인 워치리스트와 유찰 0회·ratio 100%인 신건(`new`) 이벤트
- **When**: 매칭을 실행한다
- **Then**: ratio·유찰 조건을 무시하고 매칭되어 알림이 발송된다

### AC-04. 미발송 재시도 커서 (REQ-005, 014)

- **Given**: notifications에 status='failed'인 이벤트 2건이 있고 mock 서버가 이번엔 정상 응답한다
- **When**: 다음 sync의 발송 단계가 실행된다
- **Then**: failed 2건이 재발송되어 status='sent'로 갱신되고, 이미 sent인 이벤트는 재발송되지 않는다 (REQ-006)

## 2. 엣지 케이스 시나리오

### AC-05. digest 임계값 경계 (REQ-012)

- **Given**: 매칭 건수가 각각 5건 / 6건 / 30건 / 31건인 4개 시나리오
- **When**: 발송을 실행한다
- **Then**: 5건 → 개별 5건 발송. 6건 → 요약 1건 + 상위 5건 상세. 30건 → 동일(요약+상위5). 31건 → digest 1건만 + "조건이 넓습니다" 안내. 발송 메시지 수가 각 규칙과 정확히 일치한다

### AC-06. first-run digest 강제 (REQ-012)

- **Given**: 빈 DB에서 첫 sync로 신건 120건이 유입되고 `--first-run` 플래그가 지정됨
- **When**: 발송을 실행한다
- **Then**: 개별 메시지 0건, digest만 발송된다

### AC-07. quiet hours 보류 및 아침 합산 (REQ-015)

- **Given**: quietHours=["23:00","07:00"], 23:30(Asia/Seoul)에 `price_drop` 이벤트 발생
- **When**: 발송 단계가 실행된다
- **Then**: 즉시 발송되지 않고 status='held', deliver_after=익일 07:00으로 기록되며, 07:00 이후 첫 발송에서 digest로 합산 발송된다

### AC-08. quiet hours 경계값 + d1 예외 (REQ-015, 016)

- **Given**: 동일 quietHours 설정에서 22:59 이벤트, 23:00 이벤트, 23:30의 `d1` 이벤트
- **When**: 각각 발송 단계가 실행된다
- **Then**: 22:59 → 즉시 발송. 23:00 → 보류. 23:30 `d1` → 예외로 즉시 발송

### AC-09. 타임존 비의존성 (REQ-008)

- **Given**: 시스템 타임존이 UTC인 머신 (TZ=UTC 환경변수)
- **When**: D-day 계산과 quiet hours 판정을 실행한다
- **Then**: 모든 판정이 Asia/Seoul 기준으로 동일하게 동작한다 (KST 07:50 실행, KST 23:00 보류)

### AC-10. HTML 이스케이프 (REQ-011)

- **Given**: remarks에 `<b>주의</b> & "특약"` 문자열이 포함된 물건 이벤트
- **When**: 메시지를 렌더링·발송한다
- **Then**: 해당 문자열이 `&lt;b&gt;주의&lt;/b&gt; &amp; "특약"`로 이스케이프되어 전송되고 텔레그램 API가 파싱 오류를 반환하지 않는다

### AC-11. 4096자 분할 (REQ-013)

- **Given**: 상세 5건 포함 digest 렌더링 결과가 4,096자를 초과하는 긴 주소·비고 데이터
- **When**: 발송한다
- **Then**: 각 전송 메시지가 4,096자 이하로 분할/절단되며 모든 조각이 정상 발송된다

### AC-12. enrich 데이터 부재 시 정상 발송 (REQ-017)

- **Given**: 실거래 캐시가 비어 있는 상태(enrich 미실행)의 매칭 이벤트
- **When**: 발송한다
- **Then**: 할인율 라인 없이 나머지 포맷 그대로 발송에 성공한다

## 3. 품질 게이트

- [ ] fixture + mock 텔레그램 서버 기반 테스트 전체 green — **CI에서 실제 텔레그램 API·실서버 호출 0건**
- [ ] mock 텔레그램 서버가 재사용 가능한 테스트 유틸로 export됨 (F8 채널 컨트리뷰터용)
- [ ] digest 경계값(5/6/30/31)·quiet hours 경계(22:59/23:00/06:59/07:00) 테스트 포함
- [ ] 상태 전이 시나리오(신건→유찰→기일변경→취하) 메시지 렌더링 테스트 통과 (기획서 M2 DoD)
- [ ] 테스트 커버리지: matcher·digest·quiet hours·renderer **85% 이상**
- [ ] 모든 사용자 노출 메시지에 면책 고지 포함 검증 (스냅샷 테스트)
- [ ] lint 0 error, TypeScript strict 0 error
