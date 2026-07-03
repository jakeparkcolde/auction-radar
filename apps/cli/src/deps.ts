import type { Clock, SourceClient } from '@auction-radar/core';
import type { Store } from '@auction-radar/store';
import type { Notifier } from '@auction-radar/alert';
import type { Output } from './output.js';
import type { Prompts } from './wizard/port.js';
import type { TgVerifyClient } from './telegram/verify.js';
import type { LoadedConfig } from './config/resolve.js';

/**
 * CLI 의존성 번들. (buildProgram 에 주입)
 *
 * 실 구현(index.ts, 커버리지 제외)은 네트워크·파일시스템·터미널 실 어댑터를,
 * 테스트는 fake/mock 을 주입한다. 각 커맨드 액션 핸들러는 이 번들에서 필요한
 * 인스턴스를 구성해 순수 커맨드 로직 함수에 전달한다.
 */
export interface CliDeps {
  /** 출력 포트. */
  readonly out: Output;
  /** 시간 소스(throttle·폴링). */
  readonly clock: Clock;
  /** ISO 시각 소스. */
  readonly now: () => string;
  /** 환경변수(env: 참조 해석). */
  readonly env: NodeJS.ProcessEnv;
  /** 플랫폼(schedule 분기). */
  readonly platform: NodeJS.Platform;
  /** 홈 디렉터리(설정·DB·lock 경로 도출). */
  readonly homeDir: string;
  /** node 실행 파일 절대경로(schedule). */
  readonly execPath: string;
  /** CLI 엔트리 스크립트 절대경로(schedule). */
  readonly scriptPath: string;
  /** 대화형 프롬프트(init·watch add). */
  readonly prompts: Prompts;

  /** 스토어 개방+마이그레이션(단일 조합 지점). */
  readonly openStore: (path: string) => Store;
  /** 소스 클라이언트 생성(실=HttpSourceClient, 테스트=FixtureSourceClient). */
  readonly createSource: () => SourceClient;
  /** 발송기 생성(ALERT TelegramNotifier). */
  readonly createNotifier: (token: string, chatId: string) => Notifier;
  /** 텔레그램 검증 클라이언트 생성. */
  readonly createTgVerify: (token: string) => TgVerifyClient;
  /** 설정 로드(read→migrate→zod→env). */
  readonly loadConfig: (path: string, env: NodeJS.ProcessEnv) => LoadedConfig;
}
