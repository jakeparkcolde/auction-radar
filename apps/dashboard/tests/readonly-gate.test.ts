import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 읽기 전용 음성 게이트. (SPEC-UI-001 REQ-001, AC-06)
 *
 * 대시보드 src 코드 경로에 쓰기 쿼리/API 가 존재하지 않음을 정적으로 강제한다.
 * (CLI 의 입찰 자동화 음성 게이트와 동일 패턴 — 기능 추가 시 쓰기 유입 차단.)
 * 조회는 store.query / store.get 만 허용한다.
 */

/** src 트리의 모든 .ts 파일 경로. */
function srcFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) files.push(...srcFiles(full));
    else if (e.name.endsWith('.ts')) files.push(full);
  }
  return files;
}

describe('REQ-001: 읽기 전용(쓰기 경로 부재) 음성 게이트', () => {
  const srcDir = fileURLToPath(new URL('../src', import.meta.url));

  /** 쓰기 SQL 키워드(대문자) — SELECT 쿼리에는 등장하지 않는다. */
  const WRITE_SQL = [/\bINSERT\b/, /\bUPDATE\b/, /\bDELETE\b/, /\bREPLACE\s+INTO\b/];
  /** 스토어 쓰기 API 호출/네트워크 캐시 갱신 (호출 형태만 — 규칙 설명 주석은 허용). */
  const WRITE_API = [
    /\.upsert\(/,
    /\.tx\(/,
    /\.execScript\(/,
    /\brefreshRtTradesCache\s*\(/,
    /\bwriteTrades\s*\(/,
  ];

  it('src 트리에 쓰기 SQL 키워드가 없다', () => {
    const files = srcFiles(srcDir);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const re of WRITE_SQL) {
        expect(re.test(text), `${file} 에 쓰기 SQL(${re}) 존재`).toBe(false);
      }
    }
  });

  it('src 트리에 스토어 쓰기 API/네트워크 캐시 갱신 호출이 없다', () => {
    for (const file of srcFiles(srcDir)) {
      const text = readFileSync(file, 'utf8');
      for (const re of WRITE_API) {
        expect(re.test(text), `${file} 에 쓰기 API(${re}) 존재`).toBe(false);
      }
    }
  });

  it('스토어 접근은 query/get 만 사용한다', () => {
    for (const file of srcFiles(srcDir)) {
      const text = readFileSync(file, 'utf8');
      // store.<method>( 형태에서 query/get 이외 메서드가 없어야 한다.
      const calls = text.match(/\bstore\.(\w+)\(/g) ?? [];
      for (const call of calls) {
        expect(['store.query(', 'store.get('], `${file}: ${call}`).toContain(call);
      }
    }
  });
});
