import { describe, expect, it } from 'vitest';
import { runCaseCommand } from '../src/commands/case.js';
import { BufferOutput } from '../src/output.js';
import { baseRecord, ingest, makeStore } from './helpers.js';

describe('CLI-REQ-009: case 단건 조회', () => {
  it('존재하는 사건은 물건·기일 이력을 출력한다', () => {
    const store = makeStore();
    ingest(store, baseRecord(1));
    const out = new BufferOutput();

    const result = runCaseCommand({ store, out }, 'B000280', '2025타경30001');

    expect(result.found).toBe(true);
    expect(result.itemCount).toBe(1);
    expect(out.stdout).toContain('2025타경30001');
    expect(out.stdout).toContain('물건 1');
    // 기일 이력(schedules) 라인.
    expect(out.stdout).toContain('2026-07-28');
    store.close();
  });

  it('null 필드(용도·주소·가격·기일·결과)는 하이픈으로 표기한다', () => {
    const store = makeStore();
    const caseId = store.upsert(
      'INSERT INTO cases (court_code, case_number, status, updated_at) VALUES (?, ?, NULL, ?)',
      ['B000280', '2025타경40001', '2026-07-03'],
    ).lastInsertRowid;
    const itemId = store.upsert(
      `INSERT INTO items (case_id, item_no, usage, address_raw, appraised_price, min_sale_price, next_sale_date, status, first_seen_at, last_seen_at)
       VALUES (?, 1, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)`,
      [caseId, '2026-07-03', '2026-07-03'],
    ).lastInsertRowid;
    store.upsert(
      'INSERT INTO schedules (item_id, sale_date, min_price, result) VALUES (?, ?, NULL, NULL)',
      [itemId, '2026-08-01'],
    );

    const out = new BufferOutput();
    const result = runCaseCommand({ store, out }, 'B000280', '2025타경40001');

    expect(result.found).toBe(true);
    expect(result.itemCount).toBe(1);
    // 감정가/최저가/용도/주소가 '-' 로 표기된다.
    expect(out.stdout).toContain('감정가 -');
    expect(out.stdout).toContain('최저가 -');
    store.close();
  });

  it('없는 사건은 sync 안내를 출력한다', () => {
    const store = makeStore();
    const out = new BufferOutput();

    const result = runCaseCommand({ store, out }, 'B000280', '2025타경99999');

    expect(result.found).toBe(false);
    expect(result.itemCount).toBe(0);
    expect(out.stdout).toContain('sync');
    store.close();
  });
});
