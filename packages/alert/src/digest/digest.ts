/**
 * digest 규칙 + 4,096자 분할. (SPEC-ALERT-001 REQ-012/013, AC-05/06/11, 기획서 §6.5)
 *
 * 규칙:
 * - firstRun 이면 무조건 digest 강제(과거 물건 대량 유입 방지).
 * - 매칭 ≤ 5건: 개별 발송.
 * - 6~30건: 요약 1건 + 상위 5건 상세 + "나머지는 export로 확인".
 * - 31건+: digest 1건만 + "조건이 넓습니다" 안내.
 */

/** 텔레그램 단일 메시지 최대 길이. */
export const TELEGRAM_MAX = 4096;

/** digest 모드. */
export type DigestMode = 'individual' | 'summary' | 'digest-only';

/** digest 결정. */
export interface DigestDecision {
  readonly mode: DigestMode;
  /** 개별 상세로 렌더링할 건수(individual=전체, summary=최대 5, digest-only=0). */
  readonly detailCount: number;
  /** 사용자 안내 문구(있으면). */
  readonly note?: string;
}

/** 요약 하단 안내: 6~30건. */
export const NOTE_SUMMARY = '나머지는 export로 확인' as const;
/** 안내: 31건+. */
export const NOTE_TOO_MANY = '조건이 넓습니다. watch 조건을 좁혀보세요' as const;
/** 절단 안내(4096 초과 라인). */
export const NOTE_TRUNCATED = '(전체는 export로 확인)' as const;

/** 매칭 건수와 firstRun 여부로 digest 모드를 결정한다. */
export function decideDigest(count: number, firstRun: boolean): DigestDecision {
  if (firstRun) {
    return { mode: 'digest-only', detailCount: 0, note: NOTE_TOO_MANY };
  }
  if (count <= 5) {
    return { mode: 'individual', detailCount: count };
  }
  if (count <= 30) {
    return { mode: 'summary', detailCount: 5, note: NOTE_SUMMARY };
  }
  return { mode: 'digest-only', detailCount: 0, note: NOTE_TOO_MANY };
}

/** digest 대상 항목(렌더링된 개별 메시지 + 종류). */
export interface DigestItem {
  readonly text: string;
  readonly type: string;
}

/** 종류별 건수 요약 문자열(예: "신건 12 · 유찰 3"). */
function summarizeCounts(items: readonly DigestItem[]): string {
  const labels: Record<string, string> = {
    new: '신건',
    price_drop: '유찰',
    changed: '변경',
    cancelled: '취하',
    d7: 'D-7',
    d1: 'D-1',
  };
  const counts = new Map<string, number>();
  for (const it of items) counts.set(it.type, (counts.get(it.type) ?? 0) + 1);
  const parts: string[] = [];
  for (const [type, n] of counts) parts.push(`${labels[type] ?? type} ${n}`);
  return parts.join(' · ');
}

/** 요약 헤더 메시지를 만든다. */
function renderSummary(items: readonly DigestItem[], note: string | undefined): string {
  const head = `🔔 <b>알림 요약</b> — 총 ${items.length}건 (${summarizeCounts(items)})`;
  return note ? `${head}\n${note}` : head;
}

/**
 * digest 결정에 따라 실제 발송할 메시지 텍스트 배열을 만든다.
 *
 * - individual: 개별 메시지 그대로.
 * - summary: [요약, 상위 5건 상세...].
 * - digest-only: 요약 1건(+안내). 길면 4096 기준 분할.
 *
 * 각 결과 조각은 splitMessage 로 4096 이하가 보장된다.
 */
export function buildDigest(items: readonly DigestItem[], firstRun: boolean): string[] {
  const decision = decideDigest(items.length, firstRun);

  if (decision.mode === 'individual') {
    return items.flatMap((it) => splitMessage(it.text));
  }

  const summary = renderSummary(items, decision.note);

  if (decision.mode === 'digest-only') {
    return splitMessage(summary);
  }

  // summary 모드: 요약 + 상위 detailCount 건 상세.
  const details = items.slice(0, decision.detailCount).flatMap((it) => splitMessage(it.text));
  return [...splitMessage(summary), ...details];
}

/** 단일 라인이 max 를 넘으면 말줄임 + export 안내로 절단한다. */
function truncateLine(line: string, max: number): string {
  const suffix = `… ${NOTE_TRUNCATED}`;
  if (suffix.length >= max) return suffix.slice(0, max);
  return line.slice(0, max - suffix.length) + suffix;
}

/**
 * 텍스트를 max(기본 4096) 이하 조각으로 분할한다. (REQ-013)
 *
 * 줄 단위로 채우되, 단일 라인이 max 를 넘으면 절단한다.
 * 반환 조각은 모두 length <= max 를 만족한다.
 */
export function splitMessage(text: string, max: number = TELEGRAM_MAX): string[] {
  if (text.length <= max) return [text];

  const chunks: string[] = [];
  let cur = '';
  for (const rawLine of text.split('\n')) {
    const line = rawLine.length > max ? truncateLine(rawLine, max) : rawLine;
    if (cur.length === 0) {
      cur = line;
    } else if (cur.length + 1 + line.length > max) {
      chunks.push(cur);
      cur = line;
    } else {
      cur = `${cur}\n${line}`;
    }
  }
  if (cur.length > 0) chunks.push(cur);
  return chunks;
}
