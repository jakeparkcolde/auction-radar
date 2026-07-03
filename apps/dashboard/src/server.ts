import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Store } from '@auction-radar/store';
import { openReadOnly } from './store/openReadOnly.js';
import { queryItems } from './query/items.js';
import { queryEvents } from './query/events.js';
import type { DashboardEventType } from './query/events.js';
import { queryWatchlistMatches } from './query/matches.js';
import { querySyncStatus } from './query/status.js';
import { enrichForItem } from './query/enrichJoin.js';
import { buildViewModel } from './render/viewModel.js';
import type { ItemWithEnrich, ViewModel } from './render/viewModel.js';

/**
 * 로컬 읽기 전용 대시보드 서버. (SPEC-UI-001 REQ-002/003, AC-04)
 *
 * - node:http 만 사용(프레임워크 없음).
 * - 바인딩 주소를 '127.0.0.1' 리터럴로 하드코딩해 외부 노출을 원천 차단한다. (REQ-002)
 * - 라우트: GET / (단일 HTML 셸), GET /api/data (요청마다 DB 를 즉시 재조회한 JSON).
 * - 스토어는 읽기 전용 — 모든 조회는 query 레이어(store.query/get)만 사용한다. (REQ-001)
 */

/** 외부 노출 방지를 위한 고정 바인딩 주소. 절대 변경 금지. (REQ-002, AC-04) */
export const DASHBOARD_HOST = '127.0.0.1' as const;

/** 기본 포트(로컬 전용). */
export const DEFAULT_PORT = 4173;

/** 유효한 이벤트 타입 집합(쿼리 파라미터 검증). */
const EVENT_TYPES: readonly DashboardEventType[] = [
  'new',
  'price_drop',
  'changed',
  'cancelled',
  'd7',
  'd1',
];

/** 서버 의존성. */
export interface DashboardDeps {
  /** 읽기 전용 스토어. */
  readonly store: Store;
  /** 스키마 존재 여부(false 면 초기 상태). */
  readonly schemaPresent: boolean;
  /** 단일 HTML 셸 문자열(에셋 인라인). */
  readonly html: string;
  /** 기준 시각 주입(테스트용). 기본 현재. */
  readonly now?: () => Date;
}

/** /api/data 쿼리 파라미터를 파싱한다(방어적). */
function parseParams(params: URLSearchParams): {
  watchlistId?: number;
  type?: DashboardEventType;
  periodDays: number | null;
} {
  const out: { watchlistId?: number; type?: DashboardEventType; periodDays: number | null } = {
    periodDays: 90,
  };
  const wl = params.get('watchlist');
  if (wl && /^\d+$/.test(wl)) out.watchlistId = Number(wl);

  const type = params.get('type');
  if (type && (EVENT_TYPES as readonly string[]).includes(type)) {
    out.type = type as DashboardEventType;
  }

  const period = params.get('period');
  if (period === 'all') out.periodDays = null;
  else if (period && /^\d+$/.test(period)) out.periodDays = Number(period);

  return out;
}

/**
 * /api/data 뷰 모델을 요청마다 즉시(fresh) 조립한다.
 *
 * @param deps   서버 의존성.
 * @param params 쿼리 파라미터.
 */
export function buildApiData(deps: DashboardDeps, params: URLSearchParams): ViewModel {
  const now = (deps.now ?? (() => new Date()))();

  // 스키마 부재 → 조회 없이 빈 상태(초기 상태). (결정 D1, AC-09)
  if (!deps.schemaPresent) {
    return buildViewModel({
      schemaPresent: false,
      now,
      items: [],
      events: [],
      watchlists: [],
      status: { latest: null, lastSuccessAt: null },
    });
  }

  const { watchlistId, type, periodDays } = parseParams(params);
  const sinceIso =
    periodDays === null ? undefined : new Date(now.getTime() - periodDays * 86_400_000).toISOString();

  const rows = queryItems(deps.store, watchlistId === undefined ? {} : { watchlistId });
  const items: ItemWithEnrich[] = rows.map((row) => ({
    row,
    enrich: enrichForItem(deps.store, row, now),
  }));

  const events = queryEvents(deps.store, {
    ...(watchlistId === undefined ? {} : { watchlistId }),
    ...(type === undefined ? {} : { type }),
    ...(sinceIso === undefined ? {} : { sinceIso }),
  });

  return buildViewModel({
    schemaPresent: true,
    now,
    items,
    events,
    watchlists: queryWatchlistMatches(deps.store),
    status: querySyncStatus(deps.store),
  });
}

/** 단일 요청을 처리한다. */
function handle(req: IncomingMessage, res: ServerResponse, deps: DashboardDeps): void {
  const url = new URL(req.url ?? '/', `http://${DASHBOARD_HOST}`);

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(deps.html);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/data') {
    const vm = buildApiData(deps, url.searchParams);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(vm));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
}

/**
 * 대시보드 HTTP 서버를 생성한다(listen 은 호출자 책임).
 *
 * @param deps 서버 의존성.
 */
export function createDashboardServer(deps: DashboardDeps): Server {
  return createServer((req, res) => handle(req, res, deps));
}

/** argv 에서 --db / --port 를 파싱한다. */
function parseArgs(argv: readonly string[]): { db: string | null; port: number } {
  let db: string | null = null;
  let port = DEFAULT_PORT;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--db') db = argv[i + 1] ?? null;
    else if (argv[i] === '--port') {
      const p = argv[i + 1];
      if (p && /^\d+$/.test(p)) port = Number(p);
    }
  }
  return { db, port };
}

/**
 * CLI 진입점: DB 를 읽기 전용으로 열고 127.0.0.1 에 바인딩한다.
 *
 * @param argv process.argv.slice(2).
 */
export function runServer(argv: readonly string[]): Server {
  const { db, port } = parseArgs(argv);
  if (!db) {
    throw new Error('사용법: node dist/server.js --db <path> [--port <port>]');
  }
  const { store, schemaPresent } = openReadOnly(db);
  const htmlPath = join(dirname(fileURLToPath(import.meta.url)), 'index.html');
  const html = readFileSync(htmlPath, 'utf8');

  const server = createDashboardServer({ store, schemaPresent, html });
  server.listen(port, DASHBOARD_HOST, () => {
    console.log(`대시보드: http://${DASHBOARD_HOST}:${port} (읽기 전용 · ${db})`);
  });
  return server;
}

// 엔트리로 직접 실행될 때만 서버를 기동한다(테스트 import 시 부작용 없음).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runServer(process.argv.slice(2));
}
