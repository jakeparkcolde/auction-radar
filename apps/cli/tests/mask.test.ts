import { describe, expect, it } from 'vitest';
import { maskToken, maskSecrets } from '../src/util/mask.js';

/** AC-07: 토큰 마스킹 — 전문 미노출, 마지막 4자만. */
describe('AC-07: maskToken', () => {
  const TOKEN = '123456:ABCdefGHI';

  it('마지막 4자만 남기고 앞부분을 가린다', () => {
    const masked = maskToken(TOKEN);
    expect(masked).toBe(`…${TOKEN.slice(-4)}`);
    // 토큰 전문·비밀 중간부가 노출되지 않는다.
    expect(masked).not.toContain(TOKEN);
    expect(masked).not.toContain('ABCdef');
    expect(masked).not.toContain('123456');
  });

  it('4자 이하 토큰은 전부 가린다', () => {
    expect(maskToken('abcd')).toBe('…');
    expect(maskToken('ab')).toBe('…');
  });

  it('빈 문자열은 그대로 반환한다', () => {
    expect(maskToken('')).toBe('');
  });
});

describe('maskSecrets', () => {
  it('로그 텍스트에서 알려진 비밀값을 마스킹한다', () => {
    const token = '123456:ABCdefGHI';
    const molit = 'MOLITSECRETKEY';
    const line = `sync 오류: token=${token} molit=${molit} 실패`;
    const masked = maskSecrets(line, [token, molit, undefined, '']);
    expect(masked).not.toContain(token);
    expect(masked).not.toContain(molit);
    expect(masked).toContain('…fGHI');
    expect(masked).toContain('…TKEY');
  });

  it('비밀값이 없으면 원문을 유지한다', () => {
    expect(maskSecrets('hello', [])).toBe('hello');
  });
});
