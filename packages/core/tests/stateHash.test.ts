import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { serializeState, stateHash } from '../src/diff/index.js';
import type { ItemState } from '../src/types.js';

interface HashVector {
  note: string;
  state: ItemState;
  expectedSerialized: string;
  expectedHash: string;
}
interface HashFixture {
  vectors: HashVector[];
}

const fixturePath = fileURLToPath(new URL('../../../fixtures/state-hash.fixture.json', import.meta.url));
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as HashFixture;

describe('state_hash 정준 직렬화 고정 (AC-08, REQ-013)', () => {
  it.each(fixture.vectors)('$note — 직렬화 포맷이 fixture 와 일치한다', (vector) => {
    expect(serializeState(vector.state)).toBe(vector.expectedSerialized);
  });

  it.each(fixture.vectors)('$note — 해시가 fixture 의 동결 값과 일치한다', (vector) => {
    expect(stateHash(vector.state)).toBe(vector.expectedHash);
  });

  it('null 필드는 리터럴 "null" 로 직렬화된다', () => {
    const s: ItemState = {
      itemId: 9,
      minSalePrice: null,
      failedCount: 0,
      nextSaleDate: null,
      correctionCount: 0,
      cancellationCount: 0,
      status: null,
    };
    expect(serializeState(s)).toBe('null|0|null|0|0|null');
  });

  it('필드 순서가 고정되어 있어 값 위치가 바뀌면 해시가 달라진다', () => {
    const base: ItemState = {
      itemId: 1,
      minSalePrice: 100,
      failedCount: 2,
      nextSaleDate: '2026-01-01',
      correctionCount: 0,
      cancellationCount: 0,
      status: '진행중',
    };
    const swapped: ItemState = { ...base, minSalePrice: 2, failedCount: 100 };
    expect(stateHash(base)).not.toBe(stateHash(swapped));
  });
});
