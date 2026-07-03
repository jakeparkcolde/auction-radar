-- 마이그레이션 001: 초기 스키마 (기획서 v0.2 §6.1)
-- 모든 테이블/인덱스는 forward-only 러너로 순차 적용된다. (REQ-009, REQ-010)

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
  usage_category     TEXT,               -- 표준 카테고리 (아파트/빌라/오피스텔/상가/토지/기타)
  address_raw        TEXT,               -- 원문 소재지
  region_norm        TEXT,               -- 정규화 지역 "인천 서구" (§6.4)
  lawd_cd            TEXT,               -- 법정동코드 5자리 (매칭 성공 시)
  appraised_price    INTEGER,            -- 감정평가액 (원)
  min_sale_price     INTEGER,            -- 현재 최저매각가 (원)
  failed_count       INTEGER NOT NULL DEFAULT 0,  -- 유찰 횟수
  correction_count   INTEGER NOT NULL DEFAULT 0,
  cancellation_count INTEGER NOT NULL DEFAULT 0,
  next_sale_date     TEXT,               -- 다음 매각기일 (§6.3 state_hash 입력, diff 복원용)
  status             TEXT,               -- 물건 상태 원문 (§6.3 state_hash 입력)
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
  dedup_key   TEXT NOT NULL UNIQUE,      -- §6.3 규칙 — DB 레벨 멱등 보장 (REQ-015)
  created_at  TEXT NOT NULL
);

-- 워치리스트 / 매칭 / 발송 로그
CREATE TABLE watchlists (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  config     TEXT NOT NULL,              -- JSON (§6.4 스키마)
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE matches (
  event_id     INTEGER NOT NULL,
  watchlist_id INTEGER NOT NULL,
  PRIMARY KEY (event_id, watchlist_id)
);

CREATE TABLE notifications (
  id         INTEGER PRIMARY KEY,
  event_id   INTEGER NOT NULL,
  channel    TEXT NOT NULL DEFAULT 'telegram',
  status     TEXT NOT NULL,              -- sent | failed | skipped_digest
  sent_at    TEXT,
  error      TEXT
);

-- 실거래가 캐시 (§6.6)
CREATE TABLE rt_trades (
  id            INTEGER PRIMARY KEY,
  lawd_cd       TEXT NOT NULL,
  deal_ym       TEXT NOT NULL,           -- 202606
  apt_name_norm TEXT,
  area          REAL,
  floor         INTEGER,
  price         INTEGER NOT NULL,        -- 만원 → 원 환산 저장
  deal_date     TEXT,
  fetched_at    TEXT NOT NULL
);
CREATE INDEX idx_rt ON rt_trades (lawd_cd, apt_name_norm, area);

-- 운영 로그
CREATE TABLE sync_runs (
  id             INTEGER PRIMARY KEY,
  started_at     TEXT,
  finished_at    TEXT,
  calls_used     INTEGER,
  items_upserted INTEGER,
  events_created INTEGER,
  blocked        INTEGER NOT NULL DEFAULT 0,
  error          TEXT
);

CREATE TABLE raw_snapshots (
  id         INTEGER PRIMARY KEY,
  endpoint   TEXT,
  request    TEXT,
  response   TEXT,
  parse_ok   INTEGER NOT NULL DEFAULT 1,
  fetched_at TEXT
);
CREATE INDEX idx_raw_parse_ok ON raw_snapshots (parse_ok, id);
