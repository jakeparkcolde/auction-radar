import type { Clock } from '@auction-radar/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildDigest,
  decideDelivery,
  matchEvents,
  recordHeld,
  recordSent,
  renderMessage,
  selectUndelivered,
  startMockTelegramServer,
  TelegramNotifier,
  TELEGRAM_MAX,
} from '../src/index.js';
import type { DigestItem, MockTelegramServer } from '../src/index.js';
import { addWatchlist, baseRecord, freshStore, ingest, NOW } from './helpers.js';

/** 실제 대기 없는 clock(테스트 속도 확보). */
const NO_WAIT_CLOCK: Clock = { now: () => 0, sleep: async () => undefined };

const CONFIG = {
  name: '인천 서구 아파트',
  courts: ['B000280'],
  regions: ['인천 서구'],
  usages: ['아파트'],
  appraisedMax: 500000000,
  failedCountMin: 1,
  notify: ['price_drop'],
};

let server: MockTelegramServer;

beforeEach(async () => {
  server = await startMockTelegramServer();
});

afterEach(async () => {
  await server.close();
});

function notifier(): TelegramNotifier {
  // baseUrl 을 로컬 mock 서버로 주입 → CI 에서 실제 텔레그램 실호출 0건 (D3).
  return new TelegramNotifier({
    token: 'CI-FAKE-TOKEN',
    chatId: '123',
    baseUrl: server.url,
    clock: NO_WAIT_CLOCK,
    interSendDelayMs: 0,
  });
}

describe('AC-01: 매칭 → 개별 발송 E2E (mock 텔레그램 서버)', () => {
  it('3건 price_drop → 3개 개별 HTML 메시지 발송 + notifications sent 3건', async () => {
    const store = freshStore();
    for (let n = 1; n <= 3; n += 1) {
      ingest(store, baseRecord(n));
      ingest(store, { ...baseRecord(n), failedCount: 1, minSalePrice: 256000000 });
    }
    addWatchlist(store, CONFIG);
    matchEvents(store);

    const undelivered = selectUndelivered(store, NOW);
    expect(undelivered).toHaveLength(3);

    const tg = notifier();
    for (const u of undelivered) {
      const text = renderMessage(u.render);
      const res = await tg.send({ eventId: u.eventId, text });
      expect(res.ok).toBe(true);
      recordSent(store, u.eventId, NOW);
    }

    // mock 서버가 3건을 캡처했는지.
    expect(server.sends).toHaveLength(3);
    for (const s of server.sends) {
      expect(s.parseMode).toBe('HTML');
      expect(s.disableWebPagePreview).toBe(true);
      expect(s.chatId).toBe('123');
      expect(s.text).toContain('3.2억 → <b>2.56억</b> (−20%)');
      expect(s.text).toContain('공고 시점 기준 · 입찰 전 원문/등기부 재확인');
      expect(s.token).toBe('CI-FAKE-TOKEN');
    }

    const sent = store.get<{ n: number }>(
      "SELECT count(*) AS n FROM notifications WHERE status = 'sent'",
    );
    expect(sent?.n).toBe(3);

    // 재실행 시 재발송 없음(중복 방어).
    expect(selectUndelivered(store, NOW)).toHaveLength(0);
    store.close();
  });
});

describe('AC-10: HTML injection 이스케이프 end-to-end', () => {
  it('스크랩 유래 문자열이 이스케이프되어 mock 서버로 전송된다', async () => {
    const tg = notifier();
    const text = renderMessage({
      eventType: 'price_drop',
      courtName: '인천지방법원',
      caseNumber: '2025타경12345',
      region: '인천 서구',
      addressDetail: '<b>주의</b> & "특약"',
      usage: '아파트',
      beforePrice: 320000000,
      afterPrice: 256000000,
      failedCount: 1,
    });
    const res = await tg.send({ text });
    expect(res.ok).toBe(true);

    const sent = server.sends[0];
    expect(sent?.text).toContain('&lt;b&gt;주의&lt;/b&gt; &amp; "특약"');
    expect(sent?.text).not.toContain('<b>주의</b>');
  });
});

describe('AC-11: 4096 초과 digest 분할 발송 end-to-end', () => {
  it('모든 전송 조각이 4096자 이하로 발송된다', async () => {
    // 여러 줄 긴 상세(≈8000자)는 4096 기준으로 다중 조각으로 분할된다.
    const longText = Array.from({ length: 40 }, () => 'z'.repeat(200)).join('\n');
    const big: DigestItem = { text: longText, type: 'price_drop' };
    const chunks = buildDigest([big], false);
    expect(chunks.length).toBeGreaterThan(1);

    const tg = notifier();
    await tg.sendDigest(chunks.map((text) => ({ text })));

    expect(server.sends).toHaveLength(chunks.length);
    for (const s of server.sends) {
      expect(s.text.length).toBeLessThanOrEqual(TELEGRAM_MAX);
    }
  });
});

describe('AC-07: quiet hours 보류 → 아침 합산 digest', () => {
  it('23:30 보류(deliver_after=07:00) → 07:00 이후 digest 합산 발송', async () => {
    const store = freshStore();
    // 매칭된 price_drop 2건 준비.
    for (let n = 1; n <= 2; n += 1) {
      ingest(store, baseRecord(n));
      ingest(store, { ...baseRecord(n), failedCount: 1, minSalePrice: 256000000 });
    }
    addWatchlist(store, CONFIG);
    matchEvents(store);

    // 23:30 KST 발송 시도 → 전부 보류.
    const at2330 = new Date(Date.UTC(2026, 6, 3, 23, 30, 0) - 9 * 60 * 60 * 1000);
    const pending = selectUndelivered(store, at2330.toISOString());
    expect(pending).toHaveLength(2);
    for (const u of pending) {
      const decision = decideDelivery(u.type, at2330);
      expect(decision.action).toBe('hold');
      if (decision.action === 'hold') recordHeld(store, u.eventId, decision.deliverAfter);
    }
    // 야간엔 미발송(보류) 상태.
    expect(selectUndelivered(store, at2330.toISOString())).toHaveLength(0);
    expect(server.sends).toHaveLength(0);

    // 07:00 KST(= UTC 22:00) 이후 첫 발송 → 합산 digest.
    const morning = '2026-07-03T22:30:00.000Z';
    const due = selectUndelivered(store, morning);
    expect(due).toHaveLength(2);

    const items: DigestItem[] = due.map((u) => ({ text: renderMessage(u.render), type: u.type }));
    const messages = buildDigest(items, false);
    const tg = notifier();
    await tg.sendDigest(messages.map((text) => ({ text })));
    for (const u of due) recordSent(store, u.eventId, morning);

    expect(server.sends.length).toBe(messages.length);
    expect(server.sends.length).toBeGreaterThan(0);
    // 최종적으로 미발송 0.
    expect(selectUndelivered(store, morning)).toHaveLength(0);
    store.close();
  });
});
