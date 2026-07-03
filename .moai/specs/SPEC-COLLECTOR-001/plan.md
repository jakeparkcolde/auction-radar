# SPEC-COLLECTOR-001 구현 계획

> Traceability: SPEC-COLLECTOR-001 (spec.md) · 기획서 v0.2 §5, §6.1~6.3, §11, §12 (M0~M1)

## 1. 마일스톤 (우선순위 기반 — 시간 예측 없음)

### Primary Goal — 모노레포 스캐폴딩 & 스토어 (기획서 M0)

1. pnpm workspace 모노레포 구성: `packages/core`, `packages/store`, `packages/enrich`(빈 패키지), `packages/alert`(빈 패키지), `apps/cli`(빈 패키지), `fixtures/`, `docs/`
2. TypeScript 공통 설정(tsconfig base, strict), vitest 테스트 러너, ESLint + Prettier
3. `packages/store`: 드라이버 인터페이스(`get/upsert/query/tx`) 정의 → SQLite 구현
4. `schema_migrations` 테이블 + forward-only 마이그레이션 러너 (REQ-010)
5. §6.1 전체 스키마 마이그레이션 001 작성 (prepared statement 전용 쿼리 레이어, REQ-011)
6. 사건번호 정규화 함수 + 테스트 벡터 (REQ-012)

### Secondary Goal — 수집 파이프라인 (기획서 M1 전반)

1. `packages/core/src/endpoints.ts` 버전 상수 (4개 엔드포인트)
2. `SourceClient` 인터페이스 정의 → `court-auction-notice-search` 래핑 구현체 (버전 고정)
3. Throttler(2,000ms 하한 하드코딩) + Budget guard(기본 10 / 상한 30)
4. 차단 감지(`data.ipcheck === false`) → 즉시 중단 + blocked 기록 (REQ-003, 자동 재시도 금지)
5. sync 절차 구현: warmup → 법원 집합 도출 → 목록 조회 → 신규/변경 의심만 상세 펼치기
6. sync lockfile (REQ-007)
7. 파싱 실패 graceful skip + raw_snapshots 저장 + retention 정리 (REQ-016, 017)

### Final Goal — diff 엔진 & 이벤트 (기획서 M1~M2 경계)

1. state_hash 정준 직렬화 모듈 + 포맷 고정 fixture 테스트 (REQ-013)
2. 이벤트 생성기: new / price_drop / changed / cancelled + dedup_key UNIQUE (REQ-014, 015)
3. 용도 매핑표 상수 + "기타" 폴백 (REQ-019)
4. 지역 정규화(region_norm) 유틸 — SPEC-ALERT-001 매칭에서 소비하지만 파싱 시점에 저장하므로 본 SPEC에 포함
5. fixture 익명화 체크리스트 문서 + 익명화된 응답 스냅샷 초기 세트 (REQ-018)

## 2. 기술 스택 (구체 버전 — /moai:2-run 단계에서 최신 안정판 최종 확인)

| 구성요소 | 선택 | 비고 |
|---|---|---|
| 런타임 | Node.js >= 20.11 LTS | 기획서 §8 |
| 언어 | TypeScript >= 5.5 (strict) | 모노레포 전체 공통 |
| 패키지 매니저 | pnpm >= 9 (workspace) | 모노레포 |
| SQLite 드라이버 | **better-sqlite3 >= 11** (1차 선택) | 결정 노트: `node:sqlite`는 Node 22+에서만 안정권이고 Node 20 타겟과 충돌. better-sqlite3는 동기 API·prepared statement·트랜잭션이 성숙. 단, 네이티브 빌드 부담이 있으므로 드라이버 인터페이스 뒤에 격리해 추후 `node:sqlite` 전환 여지 확보 |
| 수집 소스 | court-auction-notice-search (MIT) — **정확한 버전 고정(pin)** | 단일 메인테이너 리스크 → SourceClient 인터페이스로 격리, 필요 시 vendoring |
| 브라우저 폴백 | playwright-core (optionalDependencies) | 직접 HTTP 실패 시에만. 기본 설치 경량 유지 |
| 해시 | node:crypto (sha1) | 외부 의존성 불필요 |
| 테스트 | vitest >= 2 | fixture 기반, CI 실서버 호출 금지 |

## 3. 다른 SPEC과의 의존 관계

- **선행**: 없음 (전체 SPEC의 기반)
- **후행**: SPEC-ALERT-001(events/스토어 소비), SPEC-CLI-001(sync 명령 래핑), SPEC-ENRICH-001(items.lawd_cd·rt_trades), SPEC-UI-001(스토어 읽기)
- **인터페이스 계약**: 스토어 드라이버 인터페이스, events 테이블 스키마, region_norm/용도 매핑 결과가 하위 SPEC의 계약 표면

## 4. 리스크 분석 및 대응 (기획서 §14 연계)

| 리스크 | 영향 | 대응 |
|---|---|---|
| 사이트 구조/엔드포인트 변경 | 상 | endpoints.ts 버전 상수, raw 보존, 월 1회 수동 contract 테스트, 업스트림 패키지 기여 |
| IP 차단 | 중 | budget·딜레이 하한 하드코딩, 차단 시 자동 재시도 금지, lockfile로 동시 sync 차단, GH Actions 비권장 문서화 |
| better-sqlite3 네이티브 빌드 실패 (특정 플랫폼) | 중 | prebuild 바이너리 확인, 드라이버 인터페이스로 node:sqlite 전환 경로 유지 |
| state_hash 직렬화 변경으로 changed 이벤트 폭주 | 중 | 정준 직렬화 fixture 테스트로 포맷 고정 (REQ-013) |
| 업스트림 패키지 유기(abandon) | 중 | 버전 고정 + SourceClient 격리 + 필요 시 fork/vendoring |
| fixture에 PII 유입 | 상 (공개 레포) | 익명화 체크리스트 필수 통과 (REQ-018) |

## 5. 테스트 전략 (기획서 §9)

- fixture 기반 단위 테스트: 파서·diff·정규화를 네트워크 없이 검증. **CI에서 실서버 호출 금지**
- diff 시나리오 테스트: 신건→유찰→기일변경→취하 fixture 시퀀스 재생 + 2회 재실행 멱등성 검증
- contract 테스트: 월 1회 관리자 로컬 수동 트리거(1~2콜)로 스키마 drift 감지
- 커버리지 목표: core diff/파싱/정규화 모듈 85%+
