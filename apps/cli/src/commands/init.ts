import { dirname, join } from 'node:path';
import { renderMessage } from '@auction-radar/alert';
import type { Notifier } from '@auction-radar/alert';
import type { Clock } from '@auction-radar/core';
import { CliError, ExitCode } from '../exit.js';
import { withDisclaimer } from '../disclaimer.js';
import { isEnvRef, ENV_PREFIX } from '../config/resolve.js';
import { writeConfig } from '../config/io.js';
import { CURRENT_CONFIG_VERSION, type Config } from '../config/schema.js';
import type { Output } from '../output.js';
import type { Prompts } from '../wizard/port.js';
import type { GetUpdatesResult } from '../telegram/verify.js';

/**
 * init 마법사 — 순수 로직. (CLI-REQ-001/002/003, AC-01/06)
 *
 * 주입된 Prompts 포트로 대화 흐름을 구동한다:
 *  토큰(env: 권장) → getUpdates chat_id 자동 감지+확인 → 워치리스트 1건 →
 *  config 저장(600, 평문 경고) → 테스트 발송 1건(면책 고지 포함).
 *
 * 실제 터미널 I/O·네트워크는 주입 의존성이 담당하므로 이 함수는 결정론적으로 시험된다.
 */

/** chat_id 자동 감지 폴링 횟수. */
const MAX_POLLS = 5;
/** 폴링 간 대기(ms). */
const POLL_DELAY_MS = 1500;

/** getUpdates 만 필요로 하는 최소 검증 클라이언트. */
export interface TgUpdatesClient {
  getUpdates(): Promise<GetUpdatesResult>;
}

/** runInitWizard 의존성. */
export interface InitDeps {
  readonly prompts: Prompts;
  readonly createTgVerify: (token: string) => TgUpdatesClient;
  readonly createNotifier: (token: string, chatId: string) => Notifier;
  readonly configPath: string;
  readonly env: NodeJS.ProcessEnv;
  readonly clock: Clock;
  readonly now: () => string;
  readonly out: Output;
}

/** init 결과(테스트 검증용). */
export interface InitResult {
  readonly chatId: string;
  readonly configPath: string;
  readonly warnings: string[];
  readonly testSendOk: boolean;
  readonly chatIdAutoDetected: boolean;
}

/** env: 참조면 환경변수 값으로, 아니면 평문 그대로 실사용 토큰을 구한다. */
function resolveTokenValue(raw: string, env: NodeJS.ProcessEnv): string {
  if (isEnvRef(raw)) {
    const name = raw.slice(ENV_PREFIX.length);
    const value = env[name];
    if (value === undefined || value.length === 0) {
      throw new CliError(
        `환경변수 ${name} 이(가) 설정되지 않았습니다. 토큰을 해당 환경변수에 지정한 뒤 다시 실행하세요.`,
        ExitCode.RUNTIME,
      );
    }
    return value;
  }
  return raw;
}

/** getUpdates 를 폴링해 첫 chat_id 를 감지한다(없으면 null). */
async function detectChatId(client: TgUpdatesClient, clock: Clock): Promise<string | null> {
  for (let i = 0; i < MAX_POLLS; i += 1) {
    const res = await client.getUpdates();
    const first = res.chatIds[0];
    if (res.ok && first !== undefined) return first;
    if (i < MAX_POLLS - 1) await clock.sleep(POLL_DELAY_MS);
  }
  return null;
}

/**
 * init 마법사를 실행한다.
 */
export async function runInitWizard(deps: InitDeps): Promise<InitResult> {
  const { prompts, out, env, clock } = deps;

  // ① 토큰 입력(env: 참조 권장).
  const rawToken = await prompts.inputToken();
  if (rawToken.trim().length === 0) {
    throw new CliError('봇 토큰이 비어 있습니다.', ExitCode.RUNTIME);
  }
  if (!isEnvRef(rawToken)) {
    out.log('안내: 토큰은 env:TG_TOKEN 형태의 환경변수 참조를 권장합니다(평문 저장 시 경고).');
  }
  const liveToken = resolveTokenValue(rawToken, env);

  // ② chat_id 확보(자동 감지 우선).
  let chatId: string;
  let autoDetected = false;
  if (await prompts.knowsChatId()) {
    chatId = (await prompts.inputChatId()).trim();
    if (chatId.length === 0) throw new CliError('chat_id 가 비어 있습니다.', ExitCode.RUNTIME);
  } else {
    out.log('봇에게 아무 메시지나 보낸 뒤 계속하세요. 최근 업데이트에서 chat_id 를 감지합니다.');
    await prompts.waitForBotMessage();
    const detected = await detectChatId(deps.createTgVerify(liveToken), clock);
    if (detected === null) {
      throw new CliError(
        'chat_id 를 감지하지 못했습니다. 봇에게 메시지를 보냈는지 확인하고 다시 시도하세요.',
        ExitCode.RUNTIME,
      );
    }
    if (await prompts.confirmChatId(detected)) {
      chatId = detected;
      autoDetected = true;
    } else {
      chatId = (await prompts.inputChatId()).trim();
      if (chatId.length === 0) throw new CliError('chat_id 가 비어 있습니다.', ExitCode.RUNTIME);
    }
  }

  // ③ 첫 워치리스트 조건.
  const watchlist = await prompts.inputWatchlist();

  // ④ 설정 저장(600, 평문 경고). 토큰은 원문(env: 참조 보존)으로 저장한다.
  const storePath = join(dirname(deps.configPath), 'auction-radar.db');
  const config: Config = {
    version: CURRENT_CONFIG_VERSION,
    telegram: { token: rawToken, chatId },
    store: { driver: 'sqlite', path: storePath },
    collector: { minDelayMs: 2000, maxCallsPerSession: 10, schedule: ['08:00', '18:00'] },
    enrich: { enabled: false },
    notify: { digestThreshold: 6, quietHours: ['23:00', '07:00'] },
    watchlists: [watchlist],
  };
  const { warnings } = writeConfig(deps.configPath, config, out);
  out.log(`설정을 저장했습니다: ${deps.configPath} (권한 600)`);

  // ⑤ 테스트 발송 1건(면책 고지 포함).
  const notifier = deps.createNotifier(liveToken, chatId);
  const text = renderMessage({
    eventType: 'new',
    courtName: '설정 확인',
    caseNumber: 'auction-radar-init',
    region: '테스트 발송',
    usage: '설정 완료',
    afterPrice: null,
  });
  const sendRes = await notifier.send({ text });

  if (sendRes.ok) {
    out.log(withDisclaimer('테스트 발송에 성공했습니다. 초기 설정이 완료되었습니다.'));
  } else {
    out.error(`테스트 발송 실패: ${sendRes.error ?? 'unknown'}`);
  }

  return {
    chatId,
    configPath: deps.configPath,
    warnings,
    testSendOk: sendRes.ok,
    chatIdAutoDetected: autoDetected,
  };
}
