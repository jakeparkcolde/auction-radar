import { describe, expect, it } from 'vitest';
import {
  buildCrontabLines,
  buildLaunchdPlist,
  LAUNCHD_LABEL,
  runScheduleCommand,
} from '../src/commands/schedule.js';
import { BufferOutput } from '../src/output.js';

const TARGET = { execPath: '/usr/local/bin/node', scriptPath: '/opt/auction-radar/dist/index.js' };

describe('AC-12: schedule install 플랫폼 분기', () => {
  it('macOS → 08:00/18:00 launchd plist + sync 인자', () => {
    const out = new BufferOutput();
    const result = runScheduleCommand({ platform: 'darwin', ...TARGET, out });

    expect(result.kind).toBe('launchd');
    expect(result.content).toContain(LAUNCHD_LABEL);
    expect(result.content).toContain('<integer>8</integer>');
    expect(result.content).toContain('<integer>18</integer>');
    expect(result.content).toContain('<string>sync</string>');
    expect(result.content).toContain(TARGET.scriptPath);
  });

  it('Linux → 2개의 crontab 라인(08:00/18:00 · sync)', () => {
    const out = new BufferOutput();
    const result = runScheduleCommand({ platform: 'linux', ...TARGET, out });

    expect(result.kind).toBe('crontab');
    const lines = result.content.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('0 8 * * * /usr/local/bin/node /opt/auction-radar/dist/index.js sync');
    expect(lines[1]).toBe('0 18 * * * /usr/local/bin/node /opt/auction-radar/dist/index.js sync');
  });

  it('기타 플랫폼은 best-effort 안내', () => {
    const out = new BufferOutput();
    const result = runScheduleCommand({ platform: 'win32', ...TARGET, out });
    expect(result.kind).toBe('unsupported');
    expect(out.stdout).toContain('best-effort');
  });
});

describe('빌더 순수 함수', () => {
  it('buildLaunchdPlist 는 커스텀 시각을 반영한다', () => {
    const plist = buildLaunchdPlist({ ...TARGET, times: [[9, 30]] });
    expect(plist).toContain('<integer>9</integer>');
    expect(plist).toContain('<integer>30</integer>');
  });

  it('buildCrontabLines 는 시각별 1줄을 만든다', () => {
    const lines = buildCrontabLines({ ...TARGET, times: [[6, 0], [12, 15], [22, 45]] });
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe('15 12 * * * /usr/local/bin/node /opt/auction-radar/dist/index.js sync');
  });
});
