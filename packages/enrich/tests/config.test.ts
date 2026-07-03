import { describe, expect, it } from 'vitest';
import { DEFAULT_MOLIT_BASE_URL, resolveEnrichConfig } from '../src/config.js';

/**
 * enrich 설정 해석. (REQ-001)
 */
describe('resolveEnrichConfig (REQ-001)', () => {
  it('기본값: enabled=false, baseUrl=Dev 엔드포인트, molitKey 미설정', () => {
    const c = resolveEnrichConfig();
    expect(c.enabled).toBe(false);
    expect(c.baseUrl).toBe(DEFAULT_MOLIT_BASE_URL);
    expect(c.molitKey).toBeUndefined();
  });

  it('base URL 은 코드 변경 없이 설정으로 교체된다(엔드포인트 개편 대응)', () => {
    const custom = 'https://example.test/relocated/endpoint';
    const c = resolveEnrichConfig({ baseUrl: custom });
    expect(c.baseUrl).toBe(custom);
  });

  it('빈 문자열 baseUrl 은 기본값으로 폴백한다', () => {
    expect(resolveEnrichConfig({ baseUrl: '' }).baseUrl).toBe(DEFAULT_MOLIT_BASE_URL);
  });

  it('빈/공백 molitKey 는 미설정으로 간주한다', () => {
    expect(resolveEnrichConfig({ molitKey: '   ' }).molitKey).toBeUndefined();
    expect(resolveEnrichConfig({ molitKey: 'DECODED_KEY' }).molitKey).toBe('DECODED_KEY');
  });

  it('enabled=true 를 보존한다', () => {
    expect(resolveEnrichConfig({ enabled: true, molitKey: 'k' }).enabled).toBe(true);
  });
});
