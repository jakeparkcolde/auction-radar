# SPEC-COLLECTOR-001 인수 기준

> Traceability: SPEC-COLLECTOR-001 (spec.md §3) · 기획서 v0.2 §6.2~6.3, §9

## 1. 정상 시나리오 (Given-When-Then)

### AC-01. 증분 sync 기본 흐름 (REQ-005, 006)

- **Given**: 워치리스트에 법원 B000280(인천지법)이 지정되어 있고, DB에 기존 item 10건이 저장되어 있다 (fixture 재생 환경)
- **When**: sync를 실행한다
- **Then**: warmup → 목록 조회(당월+익월) 순서로 호출되고, 신규/변경 의심 공고만 상세 펼치기가 호출되며, 기존 미변경 공고에 대해 상세 호출이 발생하지 않는다. sync_runs에 calls_used, items_upserted, events_created가 기록된다

### AC-02. 신건 이벤트 생성 (REQ-014, 015)

- **Given**: DB에 존재하지 않는 물건이 포함된 목록 fixture
- **When**: sync를 실행한다
- **Then**: 해당 item이 upsert되고 `type='new'`, `dedup_key='{item_id}:new'` 이벤트가 정확히 1건 생성되며, payload에 감정가·최저가·기일이 포함된다

### AC-03. 유찰(price_drop) 이벤트 (REQ-013, 014)

- **Given**: failed_count=0, min_sale_price=320,000,000인 기존 item
- **When**: failed_count=1, min_sale_price=256,000,000으로 변경된 fixture로 sync를 실행한다
- **Then**: state_hash가 변경되고 `price_drop` 이벤트(dedup_key `{item_id}:drop:1`)가 생성되며 payload에 변경 전/후 가격이 저장된다

### AC-04. 마이그레이션 러너 (REQ-010)

- **Given**: schema_migrations가 버전 1인 기존 DB 파일
- **When**: 버전 2 마이그레이션이 추가된 새 버전으로 앱을 시작한다
- **Then**: 마이그레이션 2가 자동 적용되고 schema_migrations에 기록되며, 재시작 시 재적용되지 않는다

## 2. 엣지 케이스 시나리오

### AC-05. 차단 감지 즉시 중단 (REQ-003, 004)

- **Given**: 3번째 호출 응답이 `data.ipcheck === false`를 반환하는 mock transport
- **When**: sync를 실행한다
- **Then**: 3번째 호출 직후 sync가 중단되고, 4번째 호출이 발생하지 않으며(자동 재시도 금지), sync_runs.blocked=1이 기록되고 복구 안내(약 1시간)가 출력된다

### AC-06. 파싱 실패 graceful skip (REQ-016)

- **Given**: 20건 중 2건의 필수 필드가 누락된 응답 fixture
- **When**: sync를 실행한다
- **Then**: 18건은 정상 upsert되고, 실패 2건은 raw_snapshots(parse_ok=0)에 원본이 저장되며, 경고 카운트 2가 출력되고, sync 전체는 성공으로 종료된다

### AC-07. dedup 멱등성 재실행 (REQ-015)

- **Given**: 신건→유찰→기일변경→취하 상태 전이 fixture 시퀀스
- **When**: 동일 시퀀스를 처음부터 **2회 반복** 재생한다
- **Then**: 두 번째 재생에서 신규 이벤트가 0건 생성되고(UNIQUE 제약), 이벤트 총계·내용이 1회차와 완전히 동일하다

### AC-08. state_hash 정준 직렬화 고정 (REQ-013)

- **Given**: null 필드(다음 sale_date 없음)를 포함한 item 상태 값 세트와 기대 해시가 기록된 fixture
- **When**: state_hash를 계산한다
- **Then**: 계산 결과가 fixture의 기대 해시와 일치한다 (직렬화 규칙: `|` 구분자, null → "null", 필드 순서 고정)

### AC-09. budget 상한 및 하한 강제 (REQ-001, 002)

- **Given**: `minDelayMs: 500`, `maxCallsPerSession: 50`으로 설정된 config
- **When**: sync를 실행한다
- **Then**: 실제 호출 간 지연은 2,000ms 이상으로 적용되고, 호출 수는 30회(하드 상한)를 초과하지 않는다

### AC-10. 동시 sync 차단 (REQ-007)

- **Given**: 실행 중인 sync가 lockfile을 보유하고 있다
- **When**: 두 번째 sync를 실행한다
- **Then**: 두 번째 프로세스는 수집을 시작하지 않고 안내 메시지와 함께 종료된다. 첫 sync 정상 종료 후에는 lockfile이 해제되어 실행 가능하다

### AC-11. raw_snapshots retention (REQ-017)

- **Given**: parse_ok=0 스냅샷 250건(기본 보존 200건 초과)이 존재하는 DB
- **When**: retention 정리가 실행된다 (sync 종료 시)
- **Then**: 최신 200건만 남고 오래된 50건이 삭제된다

## 3. 품질 게이트

- [ ] fixture 테스트 전체 green (신건/유찰/변경/취하/파싱실패/차단 시나리오 포함)
- [ ] 테스트 커버리지: core 파싱·diff·정규화·store 모듈 **85% 이상**
- [ ] **CI에서 실서버(courtauction.go.kr) 호출 0건** — 네트워크 mock/fixture만 사용 (차단 방지 + 크롤링 윤리)
- [ ] 모든 SQL이 prepared statement로 실행됨을 정적 검사 또는 코드 리뷰로 확인 (REQ-011)
- [ ] fixtures/ 내 모든 스냅샷이 익명화 체크리스트 통과 (REQ-018)
- [ ] lint(ESLint) 0 error, TypeScript strict 0 error
- [ ] M0 DoD: 모노레포 빌드 + fixture 테스트 green (기획서 §12)
