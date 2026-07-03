/**
 * KST(Asia/Seoul) 시간 유틸. (SPEC-ALERT-001 REQ-008, AC-09, 결정 D1)
 *
 * D-day 계산·quiet hours 판정·발송 시각 등 모든 시간 연산을 Asia/Seoul 로 고정한다.
 * 셀프호스팅 머신의 시스템 타임존(UTC 등)과 무관하게 동작해야 한다.
 *
 * 구현: Intl.DateTimeFormat(timeZone:'Asia/Seoul') 로 벽시계 구성요소를 추출한다(zero-dep).
 * KST 는 DST 가 없어 항상 UTC+9 이므로, 벽시계 → instant 역변환은 정확한 오프셋 산술로 처리한다.
 */

/** KST 고정 타임존. */
const KST_TZ = 'Asia/Seoul';
/** KST UTC 오프셋(ms) — DST 없음(항상 +9h). */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** KST 벽시계 구성요소. */
export interface KstParts {
  readonly year: number;
  readonly month: number; // 1-12
  readonly day: number; // 1-31
  readonly hour: number; // 0-23
  readonly minute: number; // 0-59
  readonly second: number; // 0-59
}

const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: KST_TZ,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** instant(Date|epoch ms)를 KST 벽시계 구성요소로 변환한다. */
export function kstParts(instant: Date | number): KstParts {
  const date = typeof instant === 'number' ? new Date(instant) : instant;
  const map: Record<string, string> = {};
  for (const part of partsFmt.formatToParts(date)) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  // Intl 은 자정을 '24' 로 반환하는 환경이 있어 0 으로 정규화한다.
  let hour = Number(map.hour);
  if (hour === 24) hour = 0;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour,
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

/** 2자리 zero-pad. */
function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** instant 의 KST 기준 날짜 문자열(YYYY-MM-DD). */
export function todayKST(instant: Date | number): string {
  const p = kstParts(instant);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/**
 * YYYY-MM-DD 문자열에 days 를 더한 날짜 문자열을 반환한다.
 *
 * 순수 달력 산술(UTC 기준)로 계산해 타임존 영향이 없다.
 */
export function addDaysKST(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  const base = new Date(Date.UTC(y, m - 1, d));
  base.setUTCDate(base.getUTCDate() + days);
  return `${base.getUTCFullYear()}-${pad2(base.getUTCMonth() + 1)}-${pad2(base.getUTCDate())}`;
}

/**
 * 기준 시각(now)의 KST 오늘 날짜로부터 대상 날짜(YYYY-MM-DD)까지 남은 일수를 반환한다. (결정 D2)
 *
 * D-day 계산의 단일 소스. 양수면 미래(예: 3 → "D-3"), 0 이면 당일, 음수면 과거.
 * 순수 달력 산술(자정 기준 일수 차)로 계산해 시·분·타임존 영향이 없다.
 * 대시보드와 알림(텔레그램)이 동일 유틸을 재사용해 표기 불일치를 방지한다.
 *
 * @param dateStr 대상 날짜 YYYY-MM-DD.
 * @param now 기준 시각(Date 또는 epoch ms).
 */
export function daysUntilKST(dateStr: string, now: Date | number): number {
  const today = todayKST(now);
  const [ty, tm, td] = today.split('-').map(Number) as [number, number, number];
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  const base = Date.UTC(ty, tm - 1, td);
  const target = Date.UTC(y, m - 1, d);
  return Math.round((target - base) / 86_400_000);
}

/** "HH:MM" 을 자정 기준 분(minute-of-day)으로 변환한다. */
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

/**
 * instant 가 quietHours 창(KST) 내부인지 판정한다.
 *
 * 경계 규칙(AC-08): 시작 시각은 포함(>=), 종료 시각은 미포함(<).
 * 예: ["23:00","07:00"] → 23:00 보류, 07:00 발송, 22:59 발송, 06:59 보류.
 */
export function isWithinQuietHours(instant: Date | number, quietHours: readonly [string, string]): boolean {
  const [startStr, endStr] = quietHours;
  const start = toMinutes(startStr);
  const end = toMinutes(endStr);
  const p = kstParts(instant);
  const cur = p.hour * 60 + p.minute;

  if (start === end) return false; // 빈 창
  if (start < end) return cur >= start && cur < end; // 자정 미포함
  return cur >= start || cur < end; // 자정 포함(래핑)
}

/**
 * quietHours 종료 시각(예: 다음 07:00 KST)의 instant 를 ISO(UTC) 문자열로 반환한다.
 *
 * 현재 KST 분이 종료 분보다 작으면 오늘, 크거나 같으면 내일의 종료 시각을 택한다.
 * deliver_after 저장·비교(ISO UTC 사전식 비교)에 사용한다.
 */
export function nextWindowEndISO(instant: Date | number, quietHours: readonly [string, string]): string {
  const endStr = quietHours[1];
  const [endH, endM] = endStr.split(':').map(Number) as [number, number];
  const endMin = endH * 60 + endM;

  const p = kstParts(instant);
  const cur = p.hour * 60 + p.minute;

  // 종료 시각의 KST 날짜 결정.
  let dateStr = `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
  if (cur >= endMin) {
    dateStr = addDaysKST(dateStr, 1);
  }
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  // KST 벽시계 → UTC instant: Date.UTC(KST벽시계) - 9h.
  const utcMs = Date.UTC(y, m - 1, d, endH, endM, 0) - KST_OFFSET_MS;
  return new Date(utcMs).toISOString();
}
