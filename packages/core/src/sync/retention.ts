import type { Store } from '@auction-radar/store';

/**
 * raw_snapshots 보존 정책. (REQ-017)
 *
 * - parse_ok=1 스냅샷: 30일 보존 후 정리
 * - parse_ok=0 스냅샷: 최근 N건(기본 200) 유지 후 정리
 *
 * 무한 증가를 방지하기 위해 sync 종료 시 실행한다.
 */

export interface RetentionOptions {
  /** parse_ok=1 보존 일수 (기본 30). */
  readonly parseOkDays?: number;
  /** parse_ok=0 보존 건수 (기본 200). */
  readonly parseFailKeep?: number;
  /** 기준 현재 시각 (기본 now). */
  readonly now?: Date;
}

export interface RetentionResult {
  readonly deletedParseOk: number;
  readonly deletedParseFail: number;
}

/**
 * 보존 정책을 적용해 오래된/초과 스냅샷을 삭제한다.
 */
export function applyRetention(store: Store, options: RetentionOptions = {}): RetentionResult {
  const parseOkDays = options.parseOkDays ?? 30;
  const parseFailKeep = options.parseFailKeep ?? 200;
  const now = options.now ?? new Date();

  const cutoff = new Date(now.getTime() - parseOkDays * 24 * 60 * 60 * 1000).toISOString();

  // parse_ok=1: 30일 초과분 삭제 (fetched_at 이 null 인 행은 보존).
  const okRes = store.upsert(
    'DELETE FROM raw_snapshots WHERE parse_ok = 1 AND fetched_at IS NOT NULL AND fetched_at < ?',
    [cutoff],
  );

  // parse_ok=0: 최신 parseFailKeep 건만 유지 (id 내림차순 기준).
  const failRes = store.upsert(
    `DELETE FROM raw_snapshots
       WHERE parse_ok = 0
         AND id NOT IN (
           SELECT id FROM raw_snapshots WHERE parse_ok = 0 ORDER BY id DESC LIMIT ?
         )`,
    [parseFailKeep],
  );

  return {
    deletedParseOk: okRes.changes,
    deletedParseFail: failRes.changes,
  };
}
