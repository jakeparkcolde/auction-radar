import type { Store } from '@auction-radar/store';
import { ENDPOINTS_VERSION } from '@auction-radar/core';
import type { Config } from '../config/schema.js';
import { withDisclaimer } from '../disclaimer.js';
import { maskToken } from '../util/mask.js';
import type { Output } from '../output.js';
import type { GetMeResult } from '../telegram/verify.js';

/**
 * doctor 명령 — 5개 진단 항목. (CLI-REQ-011, AC-04/09)
 *
 * ① 토큰 유효성(getMe) ② DB 무결성·스키마 버전 ③ 마지막 sync 상태
 * ④ 차단 여부(blocked) ⑤ 응답 스키마 drift(ENDPOINTS_VERSION · parse_ok 비율).
 * 토큰은 항상 마지막 4자만 노출한다(평문 금지).
 */

/** 진단 상태. */
export type DoctorStatus = 'pass' | 'warn' | 'fail';

/** 단일 진단 항목. */
export interface DoctorCheck {
  readonly name: string;
  readonly status: DoctorStatus;
  readonly detail: string;
}

/** getMe 만 필요로 하는 최소 검증 클라이언트. */
export interface TgMeClient {
  getMe(): Promise<GetMeResult>;
}

/** doctor 컨텍스트. */
export interface DoctorCtx {
  readonly store: Store;
  readonly tgVerify: TgMeClient;
  readonly config: Config;
  readonly out: Output;
}

/** doctor 결과. */
export interface DoctorResult {
  readonly checks: DoctorCheck[];
  readonly overall: DoctorStatus;
}

/** parse_ok 비율 경고 임계값. */
const PARSE_OK_WARN_RATIO = 0.9;

/** ① 텔레그램 토큰 유효성. */
async function checkToken(ctx: DoctorCtx): Promise<DoctorCheck> {
  const masked = maskToken(ctx.config.telegram.token);
  const res = await ctx.tgVerify.getMe();
  if (res.ok) {
    const who = res.username ? ` (@${res.username})` : '';
    return { name: '텔레그램 토큰', status: 'pass', detail: `토큰 ${masked} 유효${who}` };
  }
  return {
    name: '텔레그램 토큰',
    status: 'fail',
    detail: `토큰 ${masked} 검증 실패: ${res.error ?? 'unknown'}`,
  };
}

/** ② DB 무결성 + 스키마 버전. */
function checkDatabase(ctx: DoctorCtx): DoctorCheck {
  const integrity = ctx.store.get<{ integrity_check: string }>('PRAGMA integrity_check');
  const version = ctx.store.get<{ v: number | null }>(
    'SELECT MAX(version) AS v FROM schema_migrations',
  );
  const schemaVersion = version?.v ?? 0;
  if (integrity?.integrity_check === 'ok') {
    return {
      name: 'DB 무결성·스키마',
      status: 'pass',
      detail: `무결성 ok · 스키마 버전 ${schemaVersion}`,
    };
  }
  return {
    name: 'DB 무결성·스키마',
    status: 'fail',
    detail: `무결성 검사 실패: ${integrity?.integrity_check ?? 'unknown'}`,
  };
}

/** ③ 마지막 sync 상태. */
function checkLastSync(ctx: DoctorCtx): DoctorCheck {
  const run = ctx.store.get<{ finished_at: string | null; error: string | null }>(
    'SELECT finished_at, error FROM sync_runs ORDER BY id DESC LIMIT 1',
  );
  if (run === undefined) {
    return { name: '마지막 sync', status: 'warn', detail: 'sync 이력이 없습니다. 먼저 sync 를 실행하세요.' };
  }
  if (run.error !== null) {
    return { name: '마지막 sync', status: 'warn', detail: `마지막 sync 오류: ${run.error}` };
  }
  return { name: '마지막 sync', status: 'pass', detail: `완료 ${run.finished_at ?? '-'}` };
}

/** ④ 차단 여부. */
function checkBlocked(ctx: DoctorCtx): DoctorCheck {
  const run = ctx.store.get<{ blocked: number }>(
    'SELECT blocked FROM sync_runs ORDER BY id DESC LIMIT 1',
  );
  if (run !== undefined && run.blocked === 1) {
    return {
      name: '차단 상태',
      status: 'warn',
      detail: '차단(blocked)이 감지되었습니다. 약 1시간 후 재시도하세요(자동 재시도 없음).',
    };
  }
  return { name: '차단 상태', status: 'pass', detail: '차단 없음' };
}

/** ⑤ 응답 스키마 drift(ENDPOINTS_VERSION · parse_ok 비율). */
function checkSchemaDrift(ctx: DoctorCtx): DoctorCheck {
  const total = ctx.store.get<{ n: number }>('SELECT count(*) AS n FROM raw_snapshots')?.n ?? 0;
  if (total === 0) {
    return {
      name: '스키마 drift',
      status: 'pass',
      detail: `엔드포인트 ${ENDPOINTS_VERSION} · 수집 이력 없음`,
    };
  }
  const okCount = ctx.store.get<{ n: number }>(
    'SELECT count(*) AS n FROM raw_snapshots WHERE parse_ok = 1',
  )?.n ?? 0;
  const ratio = okCount / total;
  if (ratio < PARSE_OK_WARN_RATIO) {
    return {
      name: '스키마 drift',
      status: 'warn',
      detail: `엔드포인트 ${ENDPOINTS_VERSION} · parse_ok 비율 ${(ratio * 100).toFixed(0)}% — drift 의심`,
    };
  }
  return {
    name: '스키마 drift',
    status: 'pass',
    detail: `엔드포인트 ${ENDPOINTS_VERSION} · parse_ok 비율 ${(ratio * 100).toFixed(0)}%`,
  };
}

/** 상태 우선순위: fail > warn > pass. */
function worst(a: DoctorStatus, b: DoctorStatus): DoctorStatus {
  const rank: Record<DoctorStatus, number> = { pass: 0, warn: 1, fail: 2 };
  return rank[a] >= rank[b] ? a : b;
}

/** 상태 라벨. */
function label(status: DoctorStatus): string {
  return status.toUpperCase();
}

/**
 * doctor 진단을 실행한다.
 */
export async function runDoctorCommand(ctx: DoctorCtx): Promise<DoctorResult> {
  const checks: DoctorCheck[] = [
    await checkToken(ctx),
    checkDatabase(ctx),
    checkLastSync(ctx),
    checkBlocked(ctx),
    checkSchemaDrift(ctx),
  ];

  let overall: DoctorStatus = 'pass';
  for (const c of checks) {
    ctx.out.log(`[${label(c.status)}] ${c.name}: ${c.detail}`);
    overall = worst(overall, c.status);
  }
  ctx.out.log(withDisclaimer(`진단 결과: ${label(overall)}`));

  return { checks, overall };
}
