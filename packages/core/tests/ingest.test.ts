import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runMigrations, SqliteStore } from '@auction-radar/store';
import { describe, expect, it } from 'vitest';
import { ingestParsed, insertEvents, parseRecord } from '../src/sync/ingest.js';
import type { ItemState, SourceRecord } from '../src/types.js';

const NOW = '2026-07-03T00:00:00Z';

function freshStore(): SqliteStore {
  const store = new SqliteStore(':memory:');
  runMigrations(store);
  return store;
}

function ingest(store: SqliteStore, rec: SourceRecord): { itemId: number; eventsCreated: number } {
  const parsed = parseRecord(rec);
  if (!parsed.ok || parsed.parsed === undefined) throw new Error(`parse fail: ${parsed.warning}`);
  const res = ingestParsed(store, parsed.parsed, NOW);
  return { itemId: res.itemId, eventsCreated: res.eventsCreated };
}

const baseRecord: SourceRecord = {
  court: 'B000280',
  caseNumber: '2025타경300001',
  itemNo: 1,
  usage: '아파트',
  addressRaw: '인천광역시 서구 청라동',
  appraisedPrice: 400000000,
  minSalePrice: 320000000,
  failedCount: 0,
  status: '진행중',
  nextSaleDate: '2026-07-28',
};

describe('ingestParsed — 신건/유찰 (AC-02, AC-03)', () => {
  it('AC-02: 신규 물건 upsert 시 new 이벤트 정확히 1건 + payload 에 감정가·최저가·기일', () => {
    const store = freshStore();
    const { itemId, eventsCreated } = ingest(store, baseRecord);
    expect(eventsCreated).toBe(1);

    const events = store.query<{ type: string; dedup_key: string; payload: string }>(
      'SELECT type, dedup_key, payload FROM events WHERE item_id = ?',
      [itemId],
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('new');
    expect(events[0]?.dedup_key).toBe(`${itemId}:new`);
    const payload = JSON.parse(events[0]?.payload ?? '{}');
    expect(payload).toMatchObject({
      appraisedPrice: 400000000,
      minSalePrice: 320000000,
      saleDate: '2026-07-28',
    });

    // 물건이 실제로 저장되었는지
    const item = store.get<{ min_sale_price: number }>('SELECT min_sale_price FROM items WHERE id = ?', [
      itemId,
    ]);
    expect(item?.min_sale_price).toBe(320000000);
    store.close();
  });

  it('AC-03: 유찰 시 price_drop(dedup :drop:1) + payload 에 변경 전/후 가격', () => {
    const store = freshStore();
    const { itemId } = ingest(store, baseRecord); // 신건
    const drop = ingest(store, { ...baseRecord, failedCount: 1, minSalePrice: 256000000 });
    expect(drop.eventsCreated).toBe(1);

    const ev = store.get<{ type: string; dedup_key: string; payload: string }>(
      'SELECT type, dedup_key, payload FROM events WHERE item_id = ? AND type = ?',
      [itemId, 'price_drop'],
    );
    expect(ev?.dedup_key).toBe(`${itemId}:drop:1`);
    const payload = JSON.parse(ev?.payload ?? '{}');
    expect(payload.before.minSalePrice).toBe(320000000);
    expect(payload.after.minSalePrice).toBe(256000000);
    store.close();
  });

  it('사건번호가 정규화되어 저장된다 (REQ-012)', () => {
    const store = freshStore();
    const { itemId } = ingest(store, { ...baseRecord, caseNumber: '2025 타경 300099' });
    const row = store.get<{ case_number: string }>(
      'SELECT c.case_number FROM cases c JOIN items i ON i.case_id = c.id WHERE i.id = ?',
      [itemId],
    );
    expect(row?.case_number).toBe('2025타경300099');
    store.close();
  });
});

describe('parseRecord — 파싱 실패 처리 (AC-06, REQ-016)', () => {
  it('필수 필드(caseNumber) 누락 시 ok=false', () => {
    const res = parseRecord({ court: 'B000280', itemNo: 1 });
    expect(res.ok).toBe(false);
    expect(res.warning).toContain('caseNumber');
  });

  it('court 누락 시 ok=false', () => {
    const res = parseRecord({ caseNumber: '2025타경1', itemNo: 1 });
    expect(res.ok).toBe(false);
  });

  it('숫자 필드 형변환 실패 시 ok=false', () => {
    const res = parseRecord({
      court: 'B000280',
      caseNumber: '2025타경1',
      minSalePrice: 'not-a-number' as unknown as number,
    });
    expect(res.ok).toBe(false);
  });

  it('정상 레코드는 정규화된 지역·용도를 포함한다', () => {
    const res = parseRecord(baseRecord);
    expect(res.ok).toBe(true);
    expect(res.parsed?.regionNorm).toBe('인천 서구');
    expect(res.parsed?.usageCategory).toBe('아파트');
  });
});

describe('AC-07: 신건→유찰→기일변경→취하 시퀀스 멱등 재생 (REQ-015)', () => {
  interface SeqFixture {
    court: string;
    records: SourceRecord[];
  }
  const path = fileURLToPath(new URL('../../../fixtures/diff-sequence.fixture.json', import.meta.url));
  const seq = JSON.parse(readFileSync(path, 'utf8')) as SeqFixture;

  function stateOf(rec: SourceRecord, itemId: number): ItemState {
    return {
      itemId,
      minSalePrice: rec.minSalePrice ?? null,
      failedCount: rec.failedCount ?? 0,
      nextSaleDate: rec.nextSaleDate ?? null,
      correctionCount: rec.correctionCount ?? 0,
      cancellationCount: rec.cancellationCount ?? 0,
      status: rec.status ?? null,
    };
  }

  function playthrough(store: SqliteStore): number {
    const records = seq.records;
    // 신건: item 생성 + new 이벤트
    const first = ingest(store, records[0] as SourceRecord);
    let created = first.eventsCreated;
    const itemId = first.itemId;
    // 이후 전이는 시퀀스 상대 이전 상태로 이벤트 생성 (dedup 으로 멱등)
    for (let i = 1; i < records.length; i += 1) {
      const prev = stateOf(records[i - 1] as SourceRecord, itemId);
      const next = stateOf(records[i] as SourceRecord, itemId);
      created += insertEvents(store, prev, next, NOW);
    }
    return created;
  }

  it('1회차는 new/price_drop/changed/cancelled 4건, 2회차는 0건, 총계 동일', () => {
    const store = freshStore();
    const first = playthrough(store);
    expect(first).toBe(4);

    const typesAfterFirst = store
      .query<{ type: string }>('SELECT type FROM events ORDER BY id')
      .map((r) => r.type);
    expect(typesAfterFirst.sort()).toEqual(['cancelled', 'changed', 'new', 'price_drop']);

    // 2회차 재생 → 신규 이벤트 0건
    const second = playthrough(store);
    expect(second).toBe(0);

    const totalEvents = store.get<{ n: number }>('SELECT count(*) AS n FROM events');
    expect(totalEvents?.n).toBe(4);
    store.close();
  });
});
