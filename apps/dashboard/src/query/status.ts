import type { Store } from '@auction-radar/store';

/**
 * sync 운영 상태 조회. (SPEC-UI-001 REQ-008)
 *
 * sync_runs 최신 실행 + 마지막 성공 sync 시각. 차단/실패 배너 판정에 사용. 읽기 전용.
 */

/** sync_runs 원시 행. */
export interface SyncRunRow {
  readonly id: number;
  readonly started_at: string | null;
  readonly finished_at: string | null;
  readonly blocked: number;
  readonly error: string | null;
}

/** sync 상태 요약. */
export interface SyncStatus {
  /** 가장 최근 sync 실행(없으면 null). */
  readonly latest: SyncRunRow | null;
  /** 마지막으로 성공한 sync 의 완료 시각(ISO). 없으면 null. */
  readonly lastSuccessAt: string | null;
}

/**
 * 최신 sync 실행과 마지막 성공 시각을 조회한다.
 *
 * 성공 판정: blocked=0 AND error IS NULL AND finished_at IS NOT NULL.
 *
 * @param store 읽기 전용 스토어.
 */
export function querySyncStatus(store: Store): SyncStatus {
  const latest =
    store.get<SyncRunRow>(
      'SELECT id, started_at, finished_at, blocked, error FROM sync_runs ORDER BY id DESC LIMIT 1',
    ) ?? null;

  const success = store.get<{ finished_at: string | null }>(
    `SELECT finished_at FROM sync_runs
     WHERE blocked = 0 AND error IS NULL AND finished_at IS NOT NULL
     ORDER BY finished_at DESC, id DESC LIMIT 1`,
  );

  return { latest, lastSuccessAt: success?.finished_at ?? null };
}
