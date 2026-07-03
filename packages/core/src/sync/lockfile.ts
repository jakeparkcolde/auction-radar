import { openSync, closeSync, rmSync, writeSync } from 'node:fs';

/**
 * sync lockfile. (REQ-007)
 *
 * cron/launchd 자동 실행과 수동 실행이 겹치면 요청 속도가 2배가 되어 차단 리스크가
 * 커진다. 파일 기반 배타 락으로 동시 sync 를 차단한다.
 */
export class SyncLock {
  private held = false;

  constructor(private readonly lockPath: string) {}

  /**
   * 락을 획득한다.
   *
   * @returns 획득 성공 여부. 이미 존재하면 false.
   */
  acquire(): boolean {
    try {
      // 'wx': 배타 생성. 파일이 이미 있으면 EEXIST 로 실패.
      const fd = openSync(this.lockPath, 'wx');
      try {
        writeSync(fd, JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }));
      } finally {
        closeSync(fd);
      }
      this.held = true;
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
        return false;
      }
      throw err;
    }
  }

  /** 락 보유 여부. */
  get isHeld(): boolean {
    return this.held;
  }

  /** 락을 해제한다 (파일 삭제). 보유 중이 아니어도 안전. */
  release(): void {
    if (!this.held) return;
    rmSync(this.lockPath, { force: true });
    this.held = false;
  }
}
