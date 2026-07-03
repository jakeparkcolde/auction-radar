import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { connect } from 'node:net';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteStore } from '@auction-radar/store';
import {
  buildApiData,
  createDashboardServer,
  DASHBOARD_HOST,
  DEFAULT_PORT,
} from '../src/server.js';
import { openReadOnly } from '../src/store/openReadOnly.js';
import type { ViewModel } from '../src/render/viewModel.js';
import { makeTempDb, NOW, seedBlocked, seedFull } from './helpers.js';

const HTML_SHELL = '<!DOCTYPE html><html lang="ko"><body><div id="app"></div></body></html>';

interface Running {
  server: Server;
  port: number;
  store: SqliteStore;
}

/** 서버를 127.0.0.1 임의 포트(0)로 기동한다. */
function start(dbPath: string): Promise<Running> {
  const { store, schemaPresent } = openReadOnly(dbPath);
  const server = createDashboardServer({
    store,
    schemaPresent,
    html: HTML_SHELL,
    now: () => NOW,
  });
  return new Promise((resolve) => {
    server.listen(0, DASHBOARD_HOST, () => {
      const addr = server.address() as AddressInfo;
      resolve({ server, port: addr.port, store: store as SqliteStore });
    });
  });
}

function stop(r: Running): Promise<void> {
  return new Promise((resolve) => {
    r.store.close();
    r.server.close(() => resolve());
  });
}

describe('대시보드 서버 통합 (REQ-002/003, AC-04/05/06)', () => {
  const dbs: { cleanup(): void }[] = [];
  const running: Running[] = [];
  afterEach(async () => {
    for (const r of running) await stop(r);
    running.length = 0;
    for (const d of dbs) d.cleanup();
    dbs.length = 0;
  });

  it('AC-04: 서버는 127.0.0.1 에만 바인딩된다', async () => {
    const db = makeTempDb(seedFull);
    dbs.push(db);
    const r = await start(db.path);
    running.push(r);
    const addr = r.server.address() as AddressInfo;
    expect(addr.address).toBe('127.0.0.1');
    expect(DASHBOARD_HOST).toBe('127.0.0.1');
    expect(DEFAULT_PORT).toBeTypeOf('number');
  });

  it('AC-04: 비-loopback 인터페이스 접속은 거부된다', async () => {
    const db = makeTempDb(seedFull);
    dbs.push(db);
    const r = await start(db.path);
    running.push(r);

    // 머신의 외부(비-loopback) IPv4 를 찾는다.
    let external: string | null = null;
    for (const list of Object.values(networkInterfaces())) {
      for (const ni of list ?? []) {
        if (ni.family === 'IPv4' && !ni.internal) external = ni.address;
      }
    }
    if (!external) {
      // 외부 인터페이스가 없으면(순수 로컬 CI) 스킵 — 127.0.0.1 전용 바인딩은 위에서 검증됨.
      expect(external).toBeNull();
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const sock = connect({ host: external!, port: r.port });
      const timer = setTimeout(() => {
        sock.destroy();
        resolve(); // 필터링(무응답)도 외부 미노출로 간주.
      }, 1500);
      sock.on('connect', () => {
        clearTimeout(timer);
        sock.destroy();
        reject(new Error(`외부 인터페이스 ${external} 로 연결됨 — 외부 노출!`));
      });
      sock.on('error', () => {
        clearTimeout(timer);
        resolve(); // ECONNREFUSED = 정상(외부 미노출).
      });
    });
  });

  it('AC-01: GET / 는 단일 HTML 셸을 반환한다', async () => {
    const db = makeTempDb(seedFull);
    dbs.push(db);
    const r = await start(db.path);
    running.push(r);
    const res = await fetch(`http://127.0.0.1:${r.port}/`);
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('id="app"');
    expect(body).not.toMatch(/https?:\/\//); // 셸에 외부 URL 없음(AC-05)
  });

  it('AC-01: /api/data 는 물건·이벤트·법원 링크를 반환한다', async () => {
    const db = makeTempDb(seedFull);
    dbs.push(db);
    const r = await start(db.path);
    running.push(r);
    const data = (await (await fetch(`http://127.0.0.1:${r.port}/api/data`)).json()) as ViewModel;
    expect(data.items.length).toBe(3);
    expect(data.events.length).toBe(4);
    expect(data.disclaimer).toContain('입찰 전 원문');
    const a = data.items.find((i) => i.id === 100)!;
    expect(a.minSalePriceText).toBe('2.56억');
    expect(a.courtUrl).toContain('courtauction.go.kr');
    expect(a.enrich?.emphasize).toBe(true);
  });

  it('AC-03: watchlist + price_drop 필터가 좁힌다', async () => {
    const db = makeTempDb(seedFull);
    dbs.push(db);
    const r = await start(db.path);
    running.push(r);
    const data = (await (
      await fetch(`http://127.0.0.1:${r.port}/api/data?watchlist=1&type=price_drop`)
    ).json()) as ViewModel;
    expect(data.items.map((i) => i.id).sort()).toEqual([100, 101]); // 워치리스트 매칭 물건
    expect(data.events).toHaveLength(1);
    expect(data.events[0]?.type).toBe('price_drop');
  });

  it('AC-08: 차단 배너용 상태(warn + 마지막 성공)를 반환한다', async () => {
    const db = makeTempDb(seedBlocked);
    dbs.push(db);
    const r = await start(db.path);
    running.push(r);
    const data = (await (await fetch(`http://127.0.0.1:${r.port}/api/data`)).json()) as ViewModel;
    expect(data.status.warn).toBe(true);
    expect(data.status.blocked).toBe(true);
    expect(data.status.lastSuccessAt).not.toBeNull();
  });

  it('AC-06: N회 요청 후 DB 파일 체크섬 불변(읽기 전용)', async () => {
    const db = makeTempDb(seedFull);
    dbs.push(db);
    const before = createHash('sha256').update(readFileSync(db.path)).digest('hex');
    const r = await start(db.path);
    running.push(r);
    for (let i = 0; i < 5; i += 1) {
      await fetch(`http://127.0.0.1:${r.port}/api/data?period=all`);
    }
    await stop(r);
    running.length = 0;
    const after = createHash('sha256').update(readFileSync(db.path)).digest('hex');
    expect(after).toBe(before);
  });

  it('AC-09: 빈(마이그레이션만) DB 는 empty 상태', async () => {
    const db = makeTempDb(); // 시드 없음
    dbs.push(db);
    const r = await start(db.path);
    running.push(r);
    const data = (await (await fetch(`http://127.0.0.1:${r.port}/api/data`)).json()) as ViewModel;
    expect(data.schemaPresent).toBe(true);
    expect(data.empty).toBe(true);
    expect(data.items).toHaveLength(0);
  });

  it('AC-09: 스키마 없는 빈 파일도 오류 없이 empty 상태', async () => {
    const db = makeTempDb();
    dbs.push(db);
    // 스키마 없는 별도 파일.
    const blank = `${db.path}.blank`;
    new SqliteStore(blank).close();
    const data = buildApiData(
      { store: openReadOnly(blank).store, schemaPresent: openReadOnly(blank).schemaPresent, html: HTML_SHELL, now: () => NOW },
      new URLSearchParams(),
    );
    expect(data.schemaPresent).toBe(false);
    expect(data.empty).toBe(true);
  });

  it('알 수 없는 경로는 404', async () => {
    const db = makeTempDb(seedFull);
    dbs.push(db);
    const r = await start(db.path);
    running.push(r);
    const res = await fetch(`http://127.0.0.1:${r.port}/nope`);
    expect(res.status).toBe(404);
  });
});
