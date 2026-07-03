import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILTIN_MIGRATIONS, runMigrations, SqliteStore } from '@auction-radar/store';
import type { Store } from '@auction-radar/store';
import type { RtTradeRecord } from '../src/types.js';

const here = dirname(fileURLToPath(import.meta.url));

/** 마이그레이션 적용된 인메모리 스토어를 만든다. */
export function makeStore(): Store {
  const store = new SqliteStore(':memory:');
  runMigrations(store, BUILTIN_MIGRATIONS);
  return store;
}

/** MOLIT XML fixture 를 읽는다. */
export function loadFixture(name: string): string {
  return readFileSync(join(here, 'fixtures', 'molit', name), 'utf8');
}

/** 테스트용 RtTradeRecord 를 만든다(기본값 채움). */
export function trade(over: Partial<RtTradeRecord> & { price: number }): RtTradeRecord {
  return {
    lawdCd: '28260',
    dealYm: '202606',
    aptNameNorm: '청라한양수자인',
    area: 84.99,
    floor: 10,
    dealDate: '2026-06-15',
    ...over,
  };
}

/** rt_trades 에 레코드를 직접 삽입한다(캐시 프리로드). */
export function seedTrades(store: Store, records: readonly RtTradeRecord[], fetchedAt: string): void {
  const sql =
    'INSERT INTO rt_trades (lawd_cd, deal_ym, apt_name_norm, area, floor, price, deal_date, fetched_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
  for (const r of records) {
    store.upsert(sql, [r.lawdCd, r.dealYm, r.aptNameNorm, r.area, r.floor, r.price, r.dealDate, fetchedAt]);
  }
}
