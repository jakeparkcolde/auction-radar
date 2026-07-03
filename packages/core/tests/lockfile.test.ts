import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SyncLock } from '../src/sync/lockfile.js';

describe('SyncLock 동시 sync 차단 (REQ-007, AC-10)', () => {
  let dir: string;
  let lockPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ar-lock-'));
    lockPath = join(dir, 'sync.lock');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('첫 락은 획득, 락 보유 중 두 번째 획득은 거부된다', () => {
    const first = new SyncLock(lockPath);
    const second = new SyncLock(lockPath);

    expect(first.acquire()).toBe(true);
    expect(first.isHeld).toBe(true);
    // 이미 실행 중 → 거부
    expect(second.acquire()).toBe(false);
    expect(second.isHeld).toBe(false);
  });

  it('첫 sync 정상 종료(release) 후에는 다시 획득 가능하다', () => {
    const first = new SyncLock(lockPath);
    expect(first.acquire()).toBe(true);
    first.release();
    expect(first.isHeld).toBe(false);

    const second = new SyncLock(lockPath);
    expect(second.acquire()).toBe(true);
    second.release();
  });

  it('보유하지 않은 락의 release 는 안전하다', () => {
    const lock = new SyncLock(lockPath);
    expect(() => lock.release()).not.toThrow();
  });
});
