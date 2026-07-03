import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { matchEvents } from '@auction-radar/alert';
import type { SourceRecord } from '@auction-radar/core';
import type { Store } from '@auction-radar/store';
import {
  buildExportRows,
  runExportCommand,
  toSheetData,
  writeExportFile,
  EXPORT_HEADER,
} from '../src/commands/export.js';
import { BufferOutput } from '../src/output.js';
import { ingest, makeHomeDir, makeStore, addWatchlistDb } from './helpers.js';

const homes: string[] = [];
afterEach(() => {
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});
function tmpFile(name: string): string {
  const h = makeHomeDir();
  homes.push(h);
  return join(h, name);
}

function record(n: number): SourceRecord {
  return {
    court: 'B000280',
    caseNumber: `2025타경7${String(n).padStart(4, '0')}`,
    itemNo: 1,
    usage: '아파트',
    addressRaw: '인천광역시 서구 청라동',
    appraisedPrice: 400000000,
    minSalePrice: 320000000,
    failedCount: 0,
    status: '진행중',
    nextSaleDate: '2026-07-28',
    announcementId: `A-7${n}`,
  };
}

/** 12건 매칭이 있는 스토어. */
function storeWith12Matches(): Store {
  const store = makeStore();
  for (let n = 1; n <= 12; n += 1) ingest(store, record(n));
  addWatchlistDb(store, { name: '인천 서구 아파트', courts: ['B000280'], usages: ['아파트'], notify: ['new'] });
  matchEvents(store);
  return store;
}

describe('AC-05: export xlsx', () => {
  it('12행 + 헤더(감정가·최저가·기일·주소 포함)를 만든다', () => {
    const store = storeWith12Matches();
    const data = buildExportRows(store, '인천 서구 아파트');

    expect(data.rows).toHaveLength(12);
    for (const col of ['감정가', '최저가', '기일', '주소', '법원', '사건번호', '용도']) {
      expect(data.header).toContain(col);
    }
    // 첫 행 데이터 검증.
    expect(data.rows[0]?.appraised).toBe(400000000);
    expect(data.rows[0]?.address).toContain('인천');
    store.close();
  });

  it('워치리스트 미지정 시에도 전체 매칭 물건을 내보낸다', () => {
    const store = storeWith12Matches();
    expect(buildExportRows(store).rows).toHaveLength(12);
    store.close();
  });

  it('실제 .xlsx 파일을 기록하고 바이트를 되읽어 검증한다', async () => {
    const store = storeWith12Matches();
    const path = tmpFile('export.xlsx');

    const count = await writeExportFile(store, path, '인천 서구 아파트');
    expect(count).toBe(12);

    // 파일 바이트 되읽기: .xlsx = ZIP(PK) 시그니처 + 비어있지 않음.
    const bytes = readFileSync(path);
    expect(bytes.length).toBeGreaterThan(0);
    expect(bytes[0]).toBe(0x50); // 'P'
    expect(bytes[1]).toBe(0x4b); // 'K'
    store.close();
  });

  it('헤더 상수는 7개 컬럼을 가진다', () => {
    expect(EXPORT_HEADER).toHaveLength(7);
  });

  it('toSheetData 는 null 값을 빈칸/누락 셀로 처리한다', () => {
    const sheet = toSheetData({
      header: [...EXPORT_HEADER],
      rows: [
        {
          court: 'B000280',
          caseNumber: '2025타경1',
          usage: null,
          appraised: null,
          minSale: null,
          saleDate: null,
          address: null,
        },
      ],
    });
    // 헤더 + 1 데이터 행.
    expect(sheet).toHaveLength(2);
    const dataRow = sheet[1];
    // 감정가·최저가(null) 셀은 null, 나머지는 빈 문자열.
    expect(dataRow?.[3]).toBeNull();
    expect(dataRow?.[4]).toBeNull();
    expect(dataRow?.[2]).toEqual({ value: '', type: String });
  });

  it('runExportCommand 는 워치리스트 유무 양쪽 경로로 파일을 쓴다', async () => {
    const store = storeWith12Matches();
    const scoped = await runExportCommand(
      { store, out: new BufferOutput() },
      { filePath: tmpFile('scoped.xlsx'), watchlist: '인천 서구 아파트' },
    );
    expect(scoped).toBe(12);

    const out = new BufferOutput();
    const all = await runExportCommand({ store, out }, { filePath: tmpFile('all.xlsx') });
    expect(all).toBe(12);
    expect(out.stdout).toContain('내보냈습니다');
    store.close();
  });
});
