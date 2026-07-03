import { describe, expect, it } from 'vitest';
import type { SourceRecord } from '@auction-radar/core';
import { watchAdd, watchList, watchRemove, watchTest } from '../src/commands/watch.js';
import { CliError } from '../src/exit.js';
import { BufferOutput } from '../src/output.js';
import { addWatchlistDb, ingest, makeStore, NOW } from './helpers.js';

/** n번째 물건 — 절반 이하 감정가만 조건에 맞도록 구성. */
function record(n: number, cheap: boolean): SourceRecord {
  return {
    court: 'B000280',
    caseNumber: `2025타경5${String(n).padStart(4, '0')}`,
    itemNo: 1,
    usage: '아파트',
    addressRaw: '인천광역시 서구 청라동',
    appraisedPrice: cheap ? 400000000 : 900000000,
    minSalePrice: cheap ? 320000000 : 800000000,
    failedCount: 0,
    status: '진행중',
    nextSaleDate: '2026-07-28',
    announcementId: `A-5${n}`,
  };
}

describe('AC-03: watch test 미리보기', () => {
  it('50건 중 조건 일치 7건을 발송 없이 미리 본다', () => {
    const store = makeStore();
    // 7건은 감정가 4억(조건 통과), 43건은 9억(탈락).
    for (let n = 1; n <= 50; n += 1) ingest(store, record(n, n <= 7));
    addWatchlistDb(store, {
      name: '테스트',
      courts: ['B000280'],
      usages: ['아파트'],
      appraisedMax: 500000000,
      notify: ['new'],
    });

    const out = new BufferOutput();
    const matched = watchTest({ store, out, now: () => NOW }, '테스트');

    expect(matched).toBe(7);
    expect(out.stdout).toContain('7건');

    // 발송·기록 없음(미리보기): matches·notifications 미기록.
    expect(store.get<{ n: number }>('SELECT count(*) AS n FROM matches')?.n).toBe(0);
    expect(store.get<{ n: number }>('SELECT count(*) AS n FROM notifications')?.n).toBe(0);
    store.close();
  });

  it('없는 워치리스트는 CliError', () => {
    const store = makeStore();
    expect(() => watchTest({ store, out: new BufferOutput(), now: () => NOW }, '없음')).toThrow(CliError);
    store.close();
  });
});

describe('watch add/list/rm', () => {
  it('추가→목록→삭제 CRUD', () => {
    const store = makeStore();
    const out = new BufferOutput();
    const c = { store, out, now: () => NOW };

    const id = watchAdd(c, { name: '내 조건', courts: ['B000280'], notify: ['new'] });
    expect(id).toBeGreaterThan(0);

    const count = watchList(c);
    expect(count).toBe(1);
    expect(out.stdout).toContain('내 조건');

    const removed = watchRemove(c, '내 조건');
    expect(removed).toBe(1);
    expect(watchList(c)).toBe(0);
    store.close();
  });

  it('없는 이름 삭제는 CliError', () => {
    const store = makeStore();
    expect(() => watchRemove({ store, out: new BufferOutput(), now: () => NOW }, '없음')).toThrow(CliError);
    store.close();
  });

  it('빈 목록도 안내한다', () => {
    const store = makeStore();
    const out = new BufferOutput();
    expect(watchList({ store, out, now: () => NOW })).toBe(0);
    expect(out.stdout).toContain('없습니다');
    store.close();
  });
});
