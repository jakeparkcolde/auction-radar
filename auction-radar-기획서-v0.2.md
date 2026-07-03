# 경매레이더 (auction-radar) 기획서 v0.2

> 부동산 경매 셀프 리서치 오픈소스 툴킷 — 매물 조회 · 조건 알림 · 시세 비교
>
> 작성일: 2026-07-02 · 버전: **v0.2 (기술 명세 상세화)** · 작성: Jake / COLDBYTE

---

## 변경 이력

| 버전 | 내용 |
|---|---|
| v0.1 | 최초 기획 — 컨셉·기능·로드맵 골격 |
| v0.2 | 자체 검토 반영. ① 지역 매칭 계층 신설(법원→법정동코드→주소 정규화) ② 할인율 평균→**중위값+신뢰도 등급**으로 교체 ③ 알림 폭주 대응(digest 규칙·텔레그램 rate limit) ④ 이벤트/dedup 모델 명세화 ⑤ D-day 이벤트를 수집기에서 분리(수집 실패에도 리마인더 보장) ⑥ DB 스키마·설정 파일·CLI 명세·테스트 전략 추가 |

---

## 1. 개요

### 1.1 한 줄 정의

법원경매 매각공고를 자동 수집하고, 내가 정한 조건에 맞는 물건이 뜨면 텔레그램으로 알려주며, 인근 실거래가와 비교해 "얼마나 싼지"를 한 줄 지표로 보여주는 **셀프호스팅 오픈소스 툴킷**.

### 1.2 배경 & 문제 정의

공식 출처인 대법원 법원경매정보(courtauction.go.kr)는 ① 조건 저장·추적이 안 되고 ② 신건·유찰·기일임박·변경 알림이 없으며 ③ 시세 대비 할인율 판단을 사용자가 직접 해야 한다. 이 간극을 월 수만~수십만 원의 유료 서비스가 메우고 있으나, 핵심 3기능(검색·알림·시세 비교)은 공개 데이터만으로 재현 가능하다. **"유료 서비스는 부담스럽지만 터미널은 켤 줄 아는 사람"을 위한 오픈소스 대안**이 이 프로젝트의 자리다.

### 1.3 왜 오픈소스 + 셀프호스팅인가

- 법원경매정보는 공식 OPEN API가 없고 내부 XHR 엔드포인트 호출만 가능하며 IP 차단에 민감하다. 이 접근 노하우(엔드포인트·스로틀링·세션 관리) 자체가 커뮤니티 자산이 된다.
- 수집 데이터를 중앙 서버에서 재배포하는 SaaS 모델은 법적 회색지대 + 차단 리스크가 크다. **"코드만 배포, 데이터는 각자 자기 IP로 수집"** 원칙이 안전하며, 이는 오픈소스 배포 모델과 정확히 일치한다.

---

## 2. 목표 및 성공 지표

| 구분 | 목표 |
|---|---|
| 제품 | `npx auction-radar init` → 첫 텔레그램 알림 수신까지 **10분 이내** |
| 커뮤니티 | 공개 3개월 내 GitHub Star 300+ / 외부 컨트리뷰터 PR 3건+ |
| 품질 | 크롤링 차단 관련 이슈 비율 < 전체 이슈의 10% (스로틀링 설계 성공 지표) |
| 브랜드 | COLDBYTE 포트폴리오 — 빌딩 로그 콘텐츠 시리즈화 |

---

## 3. 타겟 사용자 & 사용자 스토리

| 페르소나 | 설명 | 핵심 니즈 |
|---|---|---|
| P1. 개발자 겸업 투자자 (주 타겟) | 경매 공부 중, 유료 결제 전 단계 | 조건 알림 자동화, 커스터마이징 |
| P2. 경매 스터디 | 물건 검색 과제 반복 | 지역·용도별 신건 리스트업, 엑셀 공유 |
| P3. 소규모 중개·컨설팅 | 특정 지역 상시 모니터링 | 유찰·변경 즉시 알림 |

- 나는 투자자로서, **인천 서구 아파트 · 감정가 5억 이하 · 1회 이상 유찰** 물건이 뜨면 즉시 알고 싶다.
- 나는 투자자로서, 관심 물건의 **매각기일 D-7과 D-1에 리마인더**를 받고 싶다.
- 나는 투자자로서, 최저매각가가 **인근 실거래 중위값 대비 몇 % 할인**인지 숫자 하나로 보고 싶다.
- 나는 스터디원으로서, 이번 주 매칭 물건을 **엑셀로 내보내** 공유하고 싶다.

---

## 4. 기능 요구사항 (MoSCoW)

### 4.1 Must — MVP

- **F1. 수집기(collector)**: 매각공고 목록·상세 수집, diff 기반 이벤트 생성 → §6.2
- **F2. 워치리스트 + 알림(alert)**: 조건 매칭 → 텔레그램 발송 → §6.4~6.5
- **F3. CLI**: init / sync / watch / export / doctor → §7

### 4.2 Should — v1.x

- **F4. 실거래가 결합(enrich)**: 할인율 지표 → §6.6
- **F5. 로컬 대시보드**: 단일 HTML (DB 읽기 전용)

### 4.3 Could — v2

- **F6. 권리분석 체크리스트**: 말소기준권리 판단 *보조* 문답 + IROS 확인 절차 안내 (자동 판정 아님)
- **F7. AI 사건 요약**: Claude API BYOK — 비고·사건정보 3줄 요약
- **F8. 알림 채널 확장**: 디스코드·Slack·이메일 (notifier 인터페이스로 추상화, §6.5)

### 4.4 Won't — 명시적 비지원 (레포 철학)

- **입찰서 자동 작성·자동 제출 — 절대 미지원**
- 수집 데이터 중앙 재배포(SaaS 모드), 동산 경매, 공매(온비드, 추후 별도 모듈 후보), 명세서·감정평가서 PDF 일괄 다운로드

---

## 5. 시스템 아키텍처 (전체 그림)

```
┌─────────────┐  1일 2회      ┌──────────────┐
│ Scheduler    │ ───────────▶ │ Collector     │──▶ courtauction.go.kr
│ launchd/cron │              │ (throttled)   │    (2s+ delay, budget)
│ /Inngest     │              └──────┬───────┘
└──────┬──────┘                      ▼ upsert + diff
       │                      ┌──────────────┐     ┌──────────────┐
       │  매일 07:50          │ Store (SQLite │◀────│ Enricher      │──▶ 국토부 실거래가 API
       ├────────────────────▶ │  기본/Supabase│     │ 중위값·할인율 │    (공공데이터포털)
       │  D-day Generator     │  어댑터)      │     └──────────────┘
       │  (수집과 독립 동작)   └──────┬───────┘
       ▼                             ▼ events
┌──────────────┐              ┌──────────────┐     ┌──────────────┐
│ Matcher       │◀─────────── │ Event Queue   │────▶│ Notifier      │──▶ Telegram
│ (워치리스트)  │              │ (dedup)      │     │ digest/retry  │
└──────────────┘              └──────────────┘     └──────────────┘
```

설계 원칙 3가지:

1. **수집과 리마인더의 분리** — D-7/D-1 이벤트는 수집기가 아니라 로컬 D-day Generator가 DB의 기존 기일 데이터로 생성한다. 사이트가 차단돼도 리마인더는 나간다.
2. **모든 상태 변화는 이벤트로** — 신건·유찰·변경·D-day 전부 `events` 테이블을 거친다. 알림·대시보드·export가 같은 이벤트 스트림을 소비한다.
3. **raw 보존** — 파싱 실패는 skip하되 원본 응답을 스냅샷으로 남겨 사후 파서 수정이 가능하게 한다.

---

## 6. 기술 명세

### 6.1 데이터 모델 (SQLite 기본)

```sql
-- 사건 (법원 + 사건번호 단위)
CREATE TABLE cases (
  id            INTEGER PRIMARY KEY,
  court_code    TEXT NOT NULL,          -- 예: B000210 (서울중앙지법)
  case_number   TEXT NOT NULL,          -- 예: 2025타경12345 (정규화 저장)
  case_name     TEXT,
  status        TEXT,                   -- 진행중/변경/취하 등 원문 상태
  updated_at    TEXT NOT NULL,
  UNIQUE (court_code, case_number)
);

-- 물건 (사건 내 물건번호 단위 = 추적의 기본 키)
CREATE TABLE items (
  id                 INTEGER PRIMARY KEY,
  case_id            INTEGER NOT NULL REFERENCES cases(id),
  item_no            INTEGER NOT NULL DEFAULT 1,
  usage              TEXT,               -- 아파트/연립다세대/토지... (원문 용도)
  address_raw        TEXT,               -- 원문 소재지
  region_norm        TEXT,               -- 정규화 지역 "인천 서구" (§6.4)
  lawd_cd            TEXT,               -- 법정동코드 5자리 (매칭 성공 시)
  appraised_price    INTEGER,            -- 감정평가액 (원)
  min_sale_price     INTEGER,            -- 현재 최저매각가 (원)
  failed_count       INTEGER DEFAULT 0,  -- 유찰 횟수
  correction_count   INTEGER DEFAULT 0,
  cancellation_count INTEGER DEFAULT 0,
  remarks            TEXT,
  state_hash         TEXT,               -- 변화 감지용 (§6.3)
  first_seen_at      TEXT NOT NULL,
  last_seen_at       TEXT NOT NULL,
  UNIQUE (case_id, item_no)
);

-- 매각기일 이력 (기일별 최저가·결과 추적)
CREATE TABLE schedules (
  id          INTEGER PRIMARY KEY,
  item_id     INTEGER NOT NULL REFERENCES items(id),
  sale_date   TEXT NOT NULL,             -- YYYY-MM-DD
  sale_place  TEXT,
  min_price   INTEGER,
  result      TEXT,                      -- 예정/유찰/매각/변경/취하
  UNIQUE (item_id, sale_date)
);

-- 이벤트 (모든 상태 변화의 단일 통로)
CREATE TABLE events (
  id          INTEGER PRIMARY KEY,
  item_id     INTEGER NOT NULL REFERENCES items(id),
  type        TEXT NOT NULL,             -- new | price_drop | changed | cancelled | d7 | d1
  payload     TEXT NOT NULL,             -- JSON (변화 전/후 값)
  dedup_key   TEXT NOT NULL UNIQUE,      -- §6.3 규칙
  created_at  TEXT NOT NULL
);

-- 워치리스트 / 매칭 / 발송 로그
CREATE TABLE watchlists (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL,
  config TEXT NOT NULL,                  -- JSON (§6.4 스키마)
  enabled INTEGER DEFAULT 1, created_at TEXT NOT NULL
);
CREATE TABLE matches ( event_id INTEGER, watchlist_id INTEGER, PRIMARY KEY (event_id, watchlist_id) );
CREATE TABLE notifications (
  id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL,
  channel TEXT NOT NULL DEFAULT 'telegram',
  status TEXT NOT NULL,                  -- sent | failed | skipped_digest
  sent_at TEXT, error TEXT
);

-- 실거래가 캐시 (§6.6)
CREATE TABLE rt_trades (
  id INTEGER PRIMARY KEY,
  lawd_cd TEXT NOT NULL, deal_ym TEXT NOT NULL,   -- 202606
  apt_name_norm TEXT, area REAL, floor INTEGER,
  price INTEGER NOT NULL,                          -- 만원 → 원 환산 저장
  deal_date TEXT, fetched_at TEXT NOT NULL
);
CREATE INDEX idx_rt ON rt_trades (lawd_cd, apt_name_norm, area);

-- 운영 로그
CREATE TABLE sync_runs (
  id INTEGER PRIMARY KEY, started_at TEXT, finished_at TEXT,
  calls_used INTEGER, items_upserted INTEGER, events_created INTEGER,
  blocked INTEGER DEFAULT 0, error TEXT
);
CREATE TABLE raw_snapshots (
  id INTEGER PRIMARY KEY, endpoint TEXT, request TEXT, response TEXT,
  parse_ok INTEGER, fetched_at TEXT
);
```

Supabase 어댑터: 동일 스키마를 Postgres로 마이그레이션(`store` 패키지의 드라이버 인터페이스 `get/upsert/query/tx`만 구현). MVP는 SQLite만 지원, Supabase는 v1.x.

### 6.2 수집 파이프라인 (collector)

**데이터 소스**: courtauction.go.kr 내부 WebSquare XHR (공식 API 없음)

| 엔드포인트 | 용도 |
|---|---|
| `POST /pgj/pgj143/selectRletDspslPbanc.on` | 매각공고 목록 (월/일 + 법원 + 입찰구분) |
| `POST /pgj/pgj143/selectRletDspslPbancDtl.on` | 공고 상세 — 사건/물건 펼치기 |
| `POST /pgj/pgj15A/selectAuctnCsSrchRslt.on` | 사건 단건 조회 (기일 이력·이해관계인) |
| `POST /pgj/pgjComm/selectCortOfcCdLst.on` | 법원사무소 코드표 |

구현은 npm `court-auction-notice-search`(MIT) 래핑. transport는 1차 직접 HTTP, 차단·5xx 시에만 playwright-core fallback.

**수집 절차 (1회 sync)**

```
1. warmup: 세션 쿠키 확보
2. 워치리스트에서 대상 법원 집합 도출 (조건에 법원 없으면 전체 — 경고 출력)
3. 법원별 selectRletDspslPbanc (당월 + 익월) → 공고 카드 목록
4. 신규/변경 의심 공고만 selectRletDspslPbancDtl 로 펼치기 (전체 재조회 금지)
5. items upsert → state_hash 비교 → events 생성 (§6.3)
6. sync_runs 기록, budget 잔량 출력
```

**스로틀링 정책 (하한 하드코딩 — 설정으로 완화만 가능)**

| 항목 | 기본값 | 비고 |
|---|---|---|
| 호출 간 지연 | 2,000ms | `minDelayMs`는 2000 미만 설정 시 무시하고 2000 적용 |
| 세션 budget | 10회 | 초과 필요 시 `--max-calls` 명시. 상한 30 |
| 차단 감지 | `data.ipcheck === false` → 즉시 중단 | **자동 재시도 금지** (차단 연장 방지). sync_runs.blocked=1 기록, 복구(약 1시간) 안내 출력 |
| 수집 주기 | 1일 2회 (08:00 / 18:00) | 증분 수집. GitHub Actions 사용은 문서에서 비권장 명시 (공유 IP 차단 리스크) |
| 우선순위 | 워치리스트 대상 법원만 | budget 안에서 끝나도록 조회 범위를 조건이 결정 |

**파싱 실패 처리**: 필드 누락·형변환 실패 시 해당 레코드 skip + `raw_snapshots(parse_ok=0)` 저장 + 경고 카운트. sync 전체를 실패시키지 않는다.

### 6.3 이벤트 & 변화 감지 (diff)

**state_hash** = `sha1(min_sale_price | failed_count | 다음 sale_date | correction_count | cancellation_count | status)`

| 이벤트 | 생성 조건 | dedup_key |
|---|---|---|
| `new` | item 최초 upsert | `{item_id}:new` |
| `price_drop` | failed_count 증가 **또는** min_sale_price 감소 | `{item_id}:drop:{failed_count}` |
| `changed` | sale_date 변경 / correction·cancellation 증가 / status 변경 | `{item_id}:chg:{state_hash}` |
| `cancelled` | status가 취하·정지 계열로 전이 | `{item_id}:cancel` |
| `d7` / `d1` | **D-day Generator**(매일 07:50, 수집과 독립)가 schedules 스캔 | `{item_id}:d7:{sale_date}` |

- dedup_key는 UNIQUE 제약으로 DB 레벨에서 중복 삽입을 차단 → 재실행·중복 sync에 안전(멱등).
- payload에는 변화 전/후 값을 저장해 알림 메시지가 "3.2억 → 2.56억 (−20%)"을 재계산 없이 렌더링.

### 6.4 매칭 엔진 (watchlist)

**워치리스트 스키마 (config JSON)**

```jsonc
{
  "name": "인천 서구 아파트",
  "courts": ["B000280"],           // 법원사무소 코드 (1차 필터, 수집 범위도 결정)
  "regions": ["인천 서구"],         // 정규화 지역 문자열 (2차 필터)
  "usages": ["아파트"],             // 원문 용도 매핑표 기준
  "appraisedMax": 500000000,        // 감정가 상한 (원). null=무제한
  "appraisedMin": null,
  "minPriceRatioMax": 0.8,          // 최저가/감정가 ≤ 80%
  "failedCountMin": 1,              // 유찰 1회 이상. 0이면 신건 포함
  "includeNew": true,               // 신건은 ratio·유찰 조건 무시하고 알림
  "keywords": [],                   // remarks/주소 포함 검색 (선택)
  "excludeKeywords": ["지분", "유치권"],  // 리스크 키워드 제외 (선택)
  "notify": ["new", "price_drop", "d7", "d1", "changed"]
}
```

**지역 매칭 3계층** (v0.1의 가장 큰 허점 보완)

1. **법원 코드** — 수집 범위 자체를 줄이는 1차 필터 (budget 절약과 직결)
2. **주소 정규화** — 원문 소재지는 자유 문자열("인천광역시 서구 청라동 …"). `인천광역시→인천`, `서울특별시→서울` 등 시도 축약 + 시군구 추출 → `region_norm="인천 서구"` 저장. `regions` 조건은 region_norm prefix 매칭
3. **법정동코드(lawd_cd)** — 주소에서 읍면동까지 추출해 행정표준코드 테이블(docs에 CSV 동봉)과 매핑. 실패해도 매칭은 2계층까지로 동작하고, lawd_cd는 실거래가 결합(§6.6)에만 필수

**용도 매핑표**: 원문 usage(예: "아파트", "연립주택", "다세대주택", "근린생활시설")를 표준 카테고리(아파트/빌라/오피스텔/상가/토지/기타)로 접는 테이블을 core에 상수로 두고 docs에 공개. 미매핑 용도는 "기타"로 흘리고 경고 로그.

### 6.5 알림 (notifier)

**채널 인터페이스** (v2 확장 대비)

```ts
interface Notifier {
  send(msg: RenderedMessage): Promise<SendResult>;
  sendDigest(msgs: RenderedMessage[]): Promise<SendResult>;
}
// MVP 구현체: TelegramNotifier (Bot API sendMessage, parse_mode=HTML)
```

- MarkdownV2는 이스케이프 지뢰가 많아 **HTML parse_mode 고정**.
- 텔레그램 rate limit(같은 chat 초당 1건 수준)에 맞춰 발송 간 1.1s 지연 + 실패 시 지수 백오프 2회 재시도. 최종 실패는 notifications.status=failed로 남기고 다음 sync에서 미발송분 재시도.

**digest 규칙 (알림 폭주 방지 — v0.2 신설)**

| 상황 | 동작 |
|---|---|
| 1회 sync 매칭 ≤ 5건 | 개별 메시지 발송 |
| 6~30건 | 요약 1건("신건 12 · 유찰 3") + 상위 5건 상세 + "나머지는 export로 확인" |
| 31건+ (주로 첫 sync) | digest만 발송 + "조건이 넓습니다. watch 조건을 좁혀보세요" 안내 |
| 첫 sync (`--first-run`) | 기본 digest 강제. 과거 물건 전체가 '신건'으로 쏟아지는 것 방지 |

**메시지 포맷 (HTML)**

```
🔔 <b>[유찰]</b> 인천지방법원 2025타경12345
📍 인천 서구 가정동 ○○ 74㎡ (아파트)
💰 최저가 3.2억 → <b>2.56억</b> (−20%) · 유찰 1회
📊 인근 실거래 중위값 대비 <b>−32%</b> (표본 14건 · 신뢰도 높음)   ← v1.x
📅 매각기일 2026-07-28 (D-26)
🔗 법원 원문 보기
⚠️ 공고 시점 기준 · 입찰 전 원문/등기부 재확인
```

가격 표기 규칙: 원 단위 정수 저장 → 렌더링 시 억/만 환산(소수 둘째 자리 반올림), 1억 미만은 "8,450만" 형식.

### 6.6 실거래가 결합 & 할인율 (enrich, v1.x)

- **소스**: 국토부 실거래가 OPEN API (공공데이터포털, 무료 개인 인증키). 아파트 매매 상세 조회 기준 파라미터: `LAWD_CD`(법정동 5자리) + `DEAL_YMD`(YYYYMM). ⚠️ 엔드포인트가 apis.data.go.kr 체계로 개편 이력이 있어 구현 시 최신 명세를 확인하고 base URL을 설정값으로 분리한다.
- **캐시 전략**: 워치리스트에 등장하는 lawd_cd × 최근 12개월만 월 1회 갱신. 쿼터 절약 + 오프라인 재계산 가능.
- **매칭 알고리즘 (아파트 우선)**
  1. 단지명 정규화: 공백·괄호·"아파트" 접미 제거, 숫자 단지 통일 → `apt_name_norm`
  2. 후보 = 같은 lawd_cd + 단지명 포함 매칭 + **전용면적 ±10%**
  3. 후보 0건이면 같은 lawd_cd + 면적 밴드 전체로 폴백 (신뢰도 강등)
- **지표**: `할인율 = 1 − (최저매각가 / 실거래 중위값)` — **평균이 아닌 중위값** (저층·특수거래 outlier 방어)
- **신뢰도 등급** (알림·대시보드에 항상 병기)

| 등급 | 조건 | 표기 |
|---|---|---|
| 높음 | 동일 단지 표본 ≥ 5건 (12개월) | "표본 n건 · 신뢰도 높음" |
| 보통 | 동일 단지 3~4건 또는 동일 법정동 폴백 ≥ 10건 | "신뢰도 보통" |
| 낮음 | 그 외 | "참고치 (표본 부족)" — 할인율을 굵게 표시하지 않음 |

- 빌라·토지는 v1.x 범위에서 "참고치" 고정 (실거래 매칭 정확도가 구조적으로 낮음).

### 6.7 설정 파일 (`~/.auction-radar/config.json`)

```jsonc
{
  "version": 1,
  "telegram": { "token": "env:TG_TOKEN", "chatId": "12345678" },  // "env:" 프리픽스로 환경변수 참조 지원
  "store": { "driver": "sqlite", "path": "~/.auction-radar/data.db" },
  "collector": {
    "minDelayMs": 2000,          // 2000 미만 입력은 무시됨
    "maxCallsPerSession": 10,
    "schedule": ["08:00", "18:00"]
  },
  "enrich": { "molitKey": "env:MOLIT_KEY", "enabled": false },
  "notify": { "digestThreshold": 6, "quietHours": ["23:00", "07:00"] },  // 야간 발송 보류 → 아침에 합산
  "watchlists": [ /* §6.4 스키마 배열 */ ]
}
```

- 파일 권한 600 강제(생성 시 chmod). 토큰 평문 저장 대신 `env:` 참조 권장을 init 마법사가 안내.
- `quietHours`: 야간 이벤트는 보류 후 아침 첫 발송에 digest로 합산 (D-1 리마인더는 예외적으로 즉시).

---

## 7. CLI 명세

| 명령 | 동작 |
|---|---|
| `npx auction-radar init` | 대화형 설정 (토큰 → 조건 → 테스트 발송 1건) |
| `auction-radar sync [--first-run] [--dry-run] [--max-calls N]` | 수집 + 매칭 + 발송. `--dry-run`은 발송 없이 매칭 결과만 출력 |
| `auction-radar watch add\|list\|rm\|test <name>` | 조건 관리. `test`는 현재 DB 기준 매칭 건수 미리보기 |
| `auction-radar case <법원코드> <사건번호>` | 사건 단건 조회 (기일 이력 포함) |
| `auction-radar export --xlsx [--watch <name>]` | 매칭 물건 엑셀 내보내기 |
| `auction-radar doctor` | 환경 진단: 토큰 유효성, DB 무결성, 마지막 sync 상태, 차단 여부 |
| `auction-radar schedule install` | macOS launchd plist / crontab 라인 생성·설치 안내 |

**launchd 예시 (docs 동봉)**

```xml
<key>Label</key><string>dev.coldbyte.auction-radar</string>
<key>ProgramArguments</key>
<array><string>/usr/local/bin/auction-radar</string><string>sync</string></array>
<key>StartCalendarInterval</key>
<array>
  <dict><key>Hour</key><integer>8</integer><key>Minute</key><integer>0</integer></dict>
  <dict><key>Hour</key><integer>18</integer><key>Minute</key><integer>0</integer></dict>
</array>
```

---

## 8. 비기능 요구사항

| 항목 | 기준 |
|---|---|
| 수집 안정성 | 엔드포인트·파라미터를 `core/endpoints.ts` 버전 상수로 분리. 파싱 실패 시 raw 보존 + graceful skip. 응답 스키마 변경 감지 시 doctor가 경고 |
| 크롤링 윤리 | 딜레이·budget **하한 하드코딩**. "차단 우회"가 아닌 "서버 부담 최소화" 프레이밍. docs/crawling-ethics.md 필수 |
| 프라이버시 | 수집 데이터 전부 로컬. 외부 전송은 사용자 본인의 텔레그램 봇·MOLIT API뿐. 텔레메트리 없음 |
| 이식성 | Node 20+, 네이티브 의존성 최소화(SQLite는 better-sqlite3 또는 node:sqlite). macOS/Linux 우선, Windows는 best-effort |
| 신뢰성 | 모든 사용자 노출 출력에 "공고 시점 기준 · 입찰 전 원문 재확인" 고지 자동 포함. 멱등 sync (dedup_key) |
| 성능 | 워치리스트 3개·법원 2곳 기준 1회 sync ≤ budget 10회 / 60초 내 완료 목표 |

---

## 9. 테스트 & 품질 전략

- **fixture 기반 단위 테스트**: 실제 응답 JSON을 익명화해 `fixtures/`에 스냅샷으로 저장 → 파서·diff·매칭을 네트워크 없이 검증. CI에서 실서버 호출 금지(차단 방지 + 윤리).
- **contract 테스트 (수동 트리거)**: 월 1회 관리자 로컬에서 실서버 1~2콜로 응답 스키마 drift 감지 → 변경 시 endpoints 상수 버전 업.
- **diff 시나리오 테스트**: 신건→유찰→기일변경→취하 상태 전이를 fixture 시퀀스로 재생, dedup 멱등성 검증.
- **E2E smoke**: `--dry-run` + 로컬 mock 텔레그램 서버로 init→sync→발송 경로 검증.

---

## 10. 데이터 소스 및 제약 요약

| 소스 | 성격 | 제약 |
|---|---|---|
| 법원경매정보 | 비공식 내부 XHR | 공식 API 없음. 연속 호출 시 IP 약 1시간 차단 → 2s+ 딜레이·budget 필수 |
| 국토부 실거래가 | 공식 OPEN API | 개인 인증키(무료)·쿼터 존재. 엔드포인트 개편 이력 → base URL 설정화 |
| 인터넷등기소(IROS) | 유료·인증 필요 | 자동화 비권장 — 확인 절차 문서 안내만 |

법적 포지션: 공개 공고의 **개인적 조회·이용**은 리스크가 낮으나 대량 재배포는 회색지대 → "코드만 배포, 데이터는 각자 수집" 원칙 고수.

---

## 11. 레포 구조

```
auction-radar/
├── packages/
│   ├── core/          # endpoints 상수, 수집·스로틀링·파싱·diff, 용도 매핑표
│   ├── store/         # 드라이버 인터페이스 + sqlite (v1.x: supabase)
│   ├── enrich/        # 법정동코드 매핑, MOLIT 클라이언트, 중위값·신뢰도
│   └── alert/         # matcher + notifier(telegram), digest, quiet hours
├── apps/
│   ├── cli/           # init/sync/watch/case/export/doctor/schedule
│   └── dashboard/     # (v1.x) 단일 HTML → Next.js
├── fixtures/          # 익명화 응답 스냅샷
├── docs/
│   ├── setup-10min.md / crawling-ethics.md / court-codes.md
│   ├── lawd-codes.csv          # 법정동코드 테이블
│   ├── rights-checklist.md     # (v2)
│   └── disclaimer.md
├── README.md          # 한국어 우선 + 영문 요약, 텔레그램 알림 GIF
└── LICENSE            # MIT
```

---

## 12. 로드맵

| 마일스톤 | 기간 | 산출물 | 완료 기준 (DoD) |
|---|---|---|---|
| M0. 스캐폴딩 | 3일 | 모노레포, core 래핑, 스키마 마이그레이션 | fixture 테스트 green |
| M1. MVP 공개 | 1주 | 수집기 + 신건 알림 + init/sync/doctor | 신규 사용자 10분 셋업 재현. **1차 공개** |
| M2. 알림 완성 | 1주 | 유찰·changed·D-day, digest, quiet hours, export | 상태 전이 시나리오 테스트 통과 |
| M3. 시세 결합 | 1~2주 | enrich + 신뢰도 등급 + 단일 HTML 대시보드 | 아파트 할인율 표본 검증 20건 수동 대조 |
| M4. 커뮤니티 | 상시 | 권리분석 체크리스트, 채널 확장, 이슈 대응 | good-first-issue 운영 |

---

## 13. 오픈소스 & 배포 전략

- 라이선스 MIT. README 킬러 샷 = 텔레그램 유찰 알림 도착 GIF.
- 배포 채널: GeekNews, 재테크 커뮤니티, 부동산 스터디 카페, 빌딩 로그(블로그·스레드), 깃밥 트렌드.
- 기술 콘텐츠 퍼널: "공식 API 없는 법원경매 사이트를 예의 바르게 다루는 법" — 스로틀링 설계 글이 메인 유입.
- good-first-issue: 법원 코드표 검증, 용도 매핑 케이스 추가, 알림 채널 구현, 지역 정규화 예외 등록.

---

## 14. 리스크 및 대응

| 리스크 | 가능성 | 영향 | 대응 |
|---|---|---|---|
| 사이트 구조/엔드포인트 변경 | 중 | 상 | endpoints 상수화, raw 보존, 월 1회 contract 테스트, 업스트림 패키지 기여 |
| IP 차단으로 UX 악화 | 중 | 중 | budget 하한 하드코딩, 차단 시 자동 재시도 금지 + 복구 안내, GH Actions 비권장 명시 |
| 알림 폭주로 이탈 | 중 | 중 | first-run digest 강제, digest 임계값, quiet hours |
| 실거래 매칭 오류 → 잘못된 할인율 | 중 | 상 | 중위값 + 신뢰도 등급 병기, 표본 부족 시 강조 억제, M3 수동 대조 20건 |
| 권리분석 오인 → 사용자 손실 | 저 | 상 | 자동 판정 미제공, 체크리스트+면책 반복 명시 |
| 재배포 법적 이슈 | 저 | 상 | 셀프호스팅 고수, 중앙 데이터 서버 미운영, 텔레메트리 없음 |
| 유료 서비스 대비 기능 격차 | 상 | 저 | 보완 포지션 명시: "모니터링은 오픈소스, 심층 분석은 유료 서비스" |

---

## 15. 면책 고지 (README 상단 고정)

> 본 도구는 대법원 법원경매정보의 공개 공고를 개인 참고용으로 조회·정리하는 도구입니다.
> 모든 정보는 공고 시점 기준이며 정정·변경·취하될 수 있으므로, **실제 입찰 전 반드시 법원 원문과 등기부등본을 직접 확인**해야 합니다.
> 본 도구는 권리분석·법률 자문을 제공하지 않으며, 입찰 자동화를 지원하지 않습니다.
> 사용으로 인한 투자 손실에 대해 제작자는 책임지지 않습니다.
