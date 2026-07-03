import { withDisclaimer } from '../disclaimer.js';
import type { Output } from '../output.js';

/**
 * schedule install 명령 — OS 네이티브 스케줄러 안내. (CLI-REQ-013, AC-12)
 *
 * macOS(darwin): launchd plist(08:00/18:00) 생성·설치 안내.
 * Linux: 대응 crontab 라인 출력.
 * CLI 는 스케줄러를 직접 조작하지 않고 파일 내용·설치 안내만 제공한다(가정 A3).
 */

/** launchd Label(역DNS). */
export const LAUNCHD_LABEL = 'dev.coldbyte.auction-radar' as const;

/** 자동 실행 시각(시, 분). */
export type ScheduleTime = readonly [number, number];

/** 기본 실행 시각: 08:00, 18:00. */
export const DEFAULT_TIMES: readonly ScheduleTime[] = [
  [8, 0],
  [18, 0],
];

/** 스케줄 빌더 입력(절대경로 사용). */
export interface ScheduleTarget {
  /** node 실행 파일 절대경로. */
  readonly execPath: string;
  /** CLI 엔트리 스크립트 절대경로. */
  readonly scriptPath: string;
  /** 실행 시각(기본 08:00/18:00). */
  readonly times?: readonly ScheduleTime[];
}

/**
 * launchd plist XML 을 생성한다(StartCalendarInterval 08:00/18:00, 절대경로, sync 인자).
 */
export function buildLaunchdPlist(target: ScheduleTarget): string {
  const times = target.times ?? DEFAULT_TIMES;
  const intervals = times
    .map(
      ([h, m]) =>
        `    <dict>\n      <key>Hour</key>\n      <integer>${h}</integer>\n` +
        `      <key>Minute</key>\n      <integer>${m}</integer>\n    </dict>`,
    )
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    `  <string>${LAUNCHD_LABEL}</string>`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    `    <string>${target.execPath}</string>`,
    `    <string>${target.scriptPath}</string>`,
    '    <string>sync</string>',
    '  </array>',
    '  <key>StartCalendarInterval</key>',
    '  <array>',
    intervals,
    '  </array>',
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

/**
 * crontab 라인들을 생성한다(시각별 1줄, 절대경로, sync 인자).
 */
export function buildCrontabLines(target: ScheduleTarget): string[] {
  const times = target.times ?? DEFAULT_TIMES;
  return times.map(([h, m]) => `${m} ${h} * * * ${target.execPath} ${target.scriptPath} sync`);
}

/** schedule 컨텍스트. */
export interface ScheduleCtx {
  readonly platform: NodeJS.Platform;
  readonly execPath: string;
  readonly scriptPath: string;
  readonly out: Output;
  readonly times?: readonly ScheduleTime[];
}

/** schedule 결과. */
export interface ScheduleResult {
  readonly platform: NodeJS.Platform;
  readonly kind: 'launchd' | 'crontab' | 'unsupported';
  readonly content: string;
}

/**
 * schedule install 을 실행한다(플랫폼 분기).
 */
export function runScheduleCommand(ctx: ScheduleCtx): ScheduleResult {
  const target: ScheduleTarget = {
    execPath: ctx.execPath,
    scriptPath: ctx.scriptPath,
    ...(ctx.times !== undefined ? { times: ctx.times } : {}),
  };

  if (ctx.platform === 'darwin') {
    const plist = buildLaunchdPlist(target);
    const plistPath = `~/Library/LaunchAgents/${LAUNCHD_LABEL}.plist`;
    ctx.out.log(`macOS launchd plist (${plistPath}):`);
    ctx.out.log(plist);
    ctx.out.log(`설치: 위 내용을 ${plistPath} 에 저장 후 'launchctl load ${plistPath}' 를 실행하세요.`);
    ctx.out.log(withDisclaimer(''));
    return { platform: ctx.platform, kind: 'launchd', content: plist };
  }

  if (ctx.platform === 'linux') {
    const lines = buildCrontabLines(target);
    ctx.out.log('Linux crontab 라인 ( `crontab -e` 로 추가하세요 ):');
    for (const l of lines) ctx.out.log(l);
    ctx.out.log(withDisclaimer(''));
    return { platform: ctx.platform, kind: 'crontab', content: lines.join('\n') };
  }

  ctx.out.log(
    withDisclaimer(
      `플랫폼 ${ctx.platform} 는 스케줄 자동 안내를 지원하지 않습니다(best-effort). ` +
        `08:00/18:00 에 'auction-radar sync' 를 실행하도록 수동 등록하세요.`,
    ),
  );
  return { platform: ctx.platform, kind: 'unsupported', content: '' };
}
