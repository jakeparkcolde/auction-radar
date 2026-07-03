import { describe, expect, it } from 'vitest';
import { MolitClient } from '../src/molit/client.js';
import type { MolitFetchLike, MolitFetchResponse } from '../src/molit/client.js';
import { loadFixture } from './helpers.js';

/**
 * MOLIT 클라이언트 — 페이지네이션·serviceKey 단일 인코딩·주입 fetch(네트워크 0). (REQ-001, D3)
 */

function okResponse(text: string): MolitFetchResponse {
  return { ok: true, status: 200, text: () => Promise.resolve(text) };
}

describe('MolitClient (REQ-001)', () => {
  it('totalCount 기반으로 페이지를 순회해 전체 레코드를 모은다', async () => {
    const urls: string[] = [];
    const fetchFn: MolitFetchLike = (url) => {
      urls.push(url);
      const page = new URL(url).searchParams.get('pageNo');
      return Promise.resolve(okResponse(loadFixture(`apt-trade-page${page}.xml`)));
    };
    const client = new MolitClient('https://example.test/molit', 'DECODED KEY', fetchFn, 1);
    const records = await client.fetchMonth('28260', '202606');

    expect(records).toHaveLength(2); // page1 1건 + page2 1건
    expect(urls).toHaveLength(2);
    expect(records.map((r) => r.price).sort((a, b) => a - b)).toEqual([1_200_000_000, 1_250_000_000]);
  });

  it('serviceKey(Decoding) 를 URLSearchParams 로 단일 인코딩한다(이중 인코딩 방지)', async () => {
    let captured = '';
    const fetchFn: MolitFetchLike = (url) => {
      captured = url;
      return Promise.resolve(okResponse(loadFixture('apt-trade-empty.xml')));
    };
    // '+' 와 '=' 를 포함하는 Decoding 키.
    const client = new MolitClient('https://example.test/molit', 'ab+cd/ef=', fetchFn);
    await client.fetchMonth('28260', '202606');

    const raw = new URL(captured).searchParams.get('serviceKey');
    // URLSearchParams 로 파싱하면 원본 Decoding 키가 그대로 복원되어야 한다(단일 인코딩).
    expect(raw).toBe('ab+cd/ef=');
    // 이중 인코딩되었다면 리터럴 "%2B" 등이 남아 원본과 달라진다.
    expect(captured).not.toContain('%25'); // %25 = 이중 인코딩된 '%'
    expect(captured).toContain('LAWD_CD=28260');
    expect(captured).toContain('DEAL_YMD=202606');
  });

  it('HTTP 오류는 예외로 던진다(호출자가 캐시 폴백 판단)', async () => {
    const fetchFn: MolitFetchLike = () =>
      Promise.resolve({ ok: false, status: 429, text: () => Promise.resolve('quota exceeded') });
    const client = new MolitClient('https://example.test/molit', 'k', fetchFn);
    await expect(client.fetchMonth('28260', '202606')).rejects.toThrow(/MOLIT HTTP 429/);
  });
});
