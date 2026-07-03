import { describe, expect, it } from 'vitest';
import type { Store } from '@auction-radar/store';
import { runDoctorCommand } from '../src/commands/doctor.js';
import { BufferOutput } from '../src/output.js';
import { cannedTgVerify, makeConfig, makeStore, NOW } from './helpers.js';

const FULL_TOKEN = '123456:ABCdefGHI';

function insertSyncRun(store: Store, blocked: number): void {
  store.upsert(
    'INSERT INTO sync_runs (started_at, finished_at, calls_used, items_upserted, events_created, blocked, error) VALUES (?, ?, 0, 0, 0, ?, NULL)',
    [NOW, NOW, blocked],
  );
}

describe('AC-04: doctor 5개 항목 진단', () => {
  it('정상 환경에서 5개 항목 모두 pass · 토큰은 마지막 4자만', async () => {
    const store = makeStore();
    insertSyncRun(store, 0);
    const out = new BufferOutput();

    const result = await runDoctorCommand({
      store,
      tgVerify: cannedTgVerify({ me: { ok: true, username: 'ar_bot' } }),
      config: makeConfig({ telegram: { token: FULL_TOKEN, chatId: '1' } }),
      out,
    });

    expect(result.checks).toHaveLength(5);
    expect(result.overall).toBe('pass');
    expect(result.checks.every((c) => c.status === 'pass')).toBe(true);

    // 토큰 전문 미노출 · 마스킹 형태만.
    expect(out.stdout).not.toContain(FULL_TOKEN);
    expect(out.stdout).toContain(`…${FULL_TOKEN.slice(-4)}`);
    store.close();
  });

  it('getMe 실패 시 토큰 항목 fail', async () => {
    const store = makeStore();
    insertSyncRun(store, 0);
    const out = new BufferOutput();
    const result = await runDoctorCommand({
      store,
      tgVerify: cannedTgVerify({ me: { ok: false, error: 'HTTP 401' } }),
      config: makeConfig({ telegram: { token: FULL_TOKEN, chatId: '1' } }),
      out,
    });
    const tokenCheck = result.checks[0];
    expect(tokenCheck?.status).toBe('fail');
    expect(result.overall).toBe('fail');
    expect(out.stdout).not.toContain(FULL_TOKEN);
    store.close();
  });
});

describe('doctor 추가 진단 상태', () => {
  it('sync 이력이 없으면 마지막 sync 항목 warn', async () => {
    const store = makeStore();
    const out = new BufferOutput();
    const result = await runDoctorCommand({
      store,
      tgVerify: cannedTgVerify({}),
      config: makeConfig({ telegram: { token: FULL_TOKEN, chatId: '1' } }),
      out,
    });
    const lastSync = result.checks.find((c) => c.name === '마지막 sync');
    expect(lastSync?.status).toBe('warn');
    expect(lastSync?.detail).toContain('이력이 없습니다');
    expect(result.overall).toBe('warn');
    store.close();
  });

  it('마지막 sync 에 오류가 있으면 warn', async () => {
    const store = makeStore();
    store.upsert(
      'INSERT INTO sync_runs (started_at, finished_at, calls_used, items_upserted, events_created, blocked, error) VALUES (?, ?, 0, 0, 0, 0, ?)',
      [NOW, NOW, '수집 실패'],
    );
    const out = new BufferOutput();
    const result = await runDoctorCommand({
      store,
      tgVerify: cannedTgVerify({}),
      config: makeConfig({ telegram: { token: FULL_TOKEN, chatId: '1' } }),
      out,
    });
    const lastSync = result.checks.find((c) => c.name === '마지막 sync');
    expect(lastSync?.status).toBe('warn');
    expect(lastSync?.detail).toContain('수집 실패');
    store.close();
  });

  it('parse_ok 비율이 낮으면 스키마 drift warn, 높으면 pass', async () => {
    // drift 의심: 10건 중 5건만 parse_ok(50% < 90%).
    const driftStore = makeStore();
    insertSyncRun(driftStore, 0);
    for (let i = 0; i < 10; i += 1) {
      driftStore.upsert(
        'INSERT INTO raw_snapshots (endpoint, request, response, parse_ok, fetched_at) VALUES (?, ?, ?, ?, ?)',
        ['list', '{}', '{}', i < 5 ? 1 : 0, NOW],
      );
    }
    const driftOut = new BufferOutput();
    const driftResult = await runDoctorCommand({
      store: driftStore,
      tgVerify: cannedTgVerify({}),
      config: makeConfig({ telegram: { token: FULL_TOKEN, chatId: '1' } }),
      out: driftOut,
    });
    const drift = driftResult.checks.find((c) => c.name === '스키마 drift');
    expect(drift?.status).toBe('warn');
    expect(drift?.detail).toContain('drift');
    driftStore.close();

    // 정상: 10건 모두 parse_ok(100% >= 90%).
    const okStore = makeStore();
    insertSyncRun(okStore, 0);
    for (let i = 0; i < 10; i += 1) {
      okStore.upsert(
        'INSERT INTO raw_snapshots (endpoint, request, response, parse_ok, fetched_at) VALUES (?, ?, ?, ?, ?)',
        ['list', '{}', '{}', 1, NOW],
      );
    }
    const okResult = await runDoctorCommand({
      store: okStore,
      tgVerify: cannedTgVerify({}),
      config: makeConfig({ telegram: { token: FULL_TOKEN, chatId: '1' } }),
      out: new BufferOutput(),
    });
    const okDrift = okResult.checks.find((c) => c.name === '스키마 drift');
    expect(okDrift?.status).toBe('pass');
    okStore.close();
  });
});

describe('AC-09: 차단 상태 doctor 경고', () => {
  it('마지막 sync_runs.blocked=1 → 차단 항목 warn + 복구 안내', async () => {
    const store = makeStore();
    insertSyncRun(store, 1);
    const out = new BufferOutput();

    const result = await runDoctorCommand({
      store,
      tgVerify: cannedTgVerify({}),
      config: makeConfig({ telegram: { token: FULL_TOKEN, chatId: '1' } }),
      out,
    });

    const blocked = result.checks.find((c) => c.name === '차단 상태');
    expect(blocked?.status).toBe('warn');
    expect(out.stdout).toContain('약 1시간');
    expect(result.overall).toBe('warn');
    store.close();
  });
});
