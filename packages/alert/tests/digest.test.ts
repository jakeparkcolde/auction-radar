import { describe, expect, it } from 'vitest';
import { buildDigest, decideDigest, splitMessage, TELEGRAM_MAX } from '../src/index.js';
import type { DigestItem } from '../src/index.js';

function items(n: number, type = 'price_drop'): DigestItem[] {
  return Array.from({ length: n }, (_, i) => ({ text: `메시지 ${i + 1}`, type }));
}

describe('decideDigest 경계 (REQ-012, AC-05)', () => {
  it('≤5 개별 / 6~30 요약+상위5 / 31+ digest-only', () => {
    expect(decideDigest(5, false).mode).toBe('individual');
    expect(decideDigest(6, false).mode).toBe('summary');
    expect(decideDigest(30, false).mode).toBe('summary');
    expect(decideDigest(31, false).mode).toBe('digest-only');
  });

  it('AC-06: firstRun 은 무조건 digest-only', () => {
    expect(decideDigest(1, true).mode).toBe('digest-only');
    expect(decideDigest(120, true).mode).toBe('digest-only');
  });
});

describe('buildDigest 발송 메시지 수 (AC-05)', () => {
  it('5건 → 개별 5건', () => {
    expect(buildDigest(items(5), false)).toHaveLength(5);
  });

  it('6건 → 요약 1 + 상위 5 상세 = 6건', () => {
    const msgs = buildDigest(items(6), false);
    expect(msgs).toHaveLength(6);
    expect(msgs[0]).toContain('알림 요약');
    expect(msgs[0]).toContain('총 6건');
  });

  it('30건 → 요약 1 + 상위 5 상세 = 6건', () => {
    expect(buildDigest(items(30), false)).toHaveLength(6);
  });

  it('31건 → digest-only 1건 + "조건이 넓습니다" 안내', () => {
    const msgs = buildDigest(items(31), false);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain('조건이 넓습니다');
  });

  it('AC-06: firstRun 120건 → digest-only 1건 (개별 0)', () => {
    const msgs = buildDigest(items(120), true);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).not.toContain('메시지 1\n메시지 2');
  });

  it('요약에 종류별 건수를 병기한다', () => {
    const mixed: DigestItem[] = [...items(4, 'new'), ...items(2, 'price_drop')];
    const msgs = buildDigest(mixed, false);
    expect(msgs[0]).toContain('신건 4');
    expect(msgs[0]).toContain('유찰 2');
  });
});

describe('splitMessage 4096 한도 (REQ-013, AC-11)', () => {
  it('4096 이하 텍스트는 분할하지 않는다', () => {
    expect(splitMessage('짧은 메시지')).toEqual(['짧은 메시지']);
  });

  it('AC-11: 여러 줄 긴 텍스트를 4096 이하 조각으로 분할한다', () => {
    const line = 'x'.repeat(200);
    const text = Array.from({ length: 40 }, () => line).join('\n'); // ~8040자
    const chunks = splitMessage(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(TELEGRAM_MAX);
    }
    // 손실 없이 모든 라인이 보존된다.
    expect(chunks.join('\n').split('\n')).toHaveLength(40);
  });

  it('단일 라인이 4096 초과 시 말줄임 + export 안내로 절단', () => {
    const chunks = splitMessage('y'.repeat(5000));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.length).toBeLessThanOrEqual(TELEGRAM_MAX);
    expect(chunks[0]).toContain('export');
  });

  it('buildDigest 개별 항목이 4096 초과여도 모든 조각이 한도 이하', () => {
    const big: DigestItem = { text: 'z'.repeat(9000), type: 'price_drop' };
    const msgs = buildDigest([big], false);
    for (const m of msgs) expect(m.length).toBeLessThanOrEqual(TELEGRAM_MAX);
  });
});
