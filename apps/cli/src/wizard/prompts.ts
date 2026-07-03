import { confirm, input } from '@inquirer/prompts';
import type { WatchlistEntry } from '../config/schema.js';
import type { Prompts } from './port.js';

/**
 * @inquirer/prompts 어댑터. (SPEC-CLI-001 결정 D3 — 비-로직 어댑터, 커버리지 제외)
 *
 * Prompts 포트를 실제 터미널 프롬프트로 구현한다. 순수 로직이 없고 라이브러리 호출만
 * 위임하므로 커버리지 대상에서 제외한다(vitest.config.ts 참조).
 */

/** 콤마로 구분된 입력을 트림된 비어있지 않은 토큰 배열로 변환한다. */
function csv(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** 실제 터미널 기반 Prompts 구현. */
export const inquirerPrompts: Prompts = {
  async inputToken(): Promise<string> {
    return input({
      message: '텔레그램 봇 토큰 (권장: env:TG_TOKEN 형태의 환경변수 참조):',
    });
  },

  async knowsChatId(): Promise<boolean> {
    return confirm({ message: 'chat_id 를 알고 있나요?', default: false });
  },

  async inputChatId(): Promise<string> {
    return input({ message: 'chat_id:' });
  },

  async waitForBotMessage(): Promise<void> {
    await input({
      message: '봇에게 아무 메시지나 보낸 뒤 Enter 를 누르세요.',
    });
  },

  async confirmChatId(detected: string): Promise<boolean> {
    return confirm({ message: `감지된 chat_id 가 "${detected}" 가 맞나요?`, default: true });
  },

  async inputWatchlist(): Promise<WatchlistEntry> {
    const name = await input({ message: '워치리스트 이름:', default: '내 조건' });
    const courts = csv(await input({ message: '법원 코드(콤마 구분, 비우면 전체):', default: '' }));
    const regions = csv(await input({ message: '지역 prefix(콤마 구분):', default: '' }));
    const usages = csv(await input({ message: '용도(콤마 구분, 예: 아파트):', default: '' }));
    const appraisedMaxRaw = await input({ message: '감정가 상한(원, 비우면 없음):', default: '' });
    const appraisedMax = appraisedMaxRaw.trim().length > 0 ? Number(appraisedMaxRaw) : null;

    return {
      name,
      courts,
      regions,
      usages,
      appraisedMax,
      notify: ['new', 'price_drop'],
    };
  },
};
