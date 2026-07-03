import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Mock 텔레그램 서버. (SPEC-ALERT-001 결정 D3, AC 품질게이트)
 *
 * 로컬 HTTP 서버로 sendMessage 요청을 캡처한다. CI 에서 실제 텔레그램 API 를
 * 절대 호출하지 않고 발송 경로를 E2E 로 검증하기 위한 재사용 유틸이며,
 * v2 알림 채널 컨트리뷰터(F8)를 위해 index.ts 에서 export 한다.
 *
 * TelegramNotifier 의 baseUrl 을 이 서버 url 로 주입하면 실호출 없이 전 경로가 동작한다.
 */

/** 캡처된 sendMessage 요청. */
export interface CapturedSend {
  readonly chatId: string;
  readonly text: string;
  readonly parseMode: string;
  readonly disableWebPagePreview: boolean;
  /** 요청 경로에서 추출한 토큰. */
  readonly token: string;
}

/** 다음 응답을 제어하기 위한 스크립트 항목. */
export interface MockResponse {
  readonly status: number;
  /** 429 등에서 반환할 retry_after(초). */
  readonly retryAfter?: number;
}

/** 실행 중인 mock 서버 핸들. */
export interface MockTelegramServer {
  /** base URL (예: http://127.0.0.1:54321). */
  readonly url: string;
  /** 캡처된 발송 목록(발송 순서). */
  readonly sends: CapturedSend[];
  /**
   * 이후 응답을 큐에 넣는다(순서대로 소비, 소진 후 200 OK).
   * 429 재시도 시나리오 재현용.
   */
  enqueueResponse(res: MockResponse): void;
  /** 서버를 종료한다. */
  close(): Promise<void>;
}

/** POST 본문을 문자열로 수집한다. */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** 요청 경로 `/bot<token>/sendMessage` 에서 토큰을 추출한다. */
function extractToken(url: string | undefined): string {
  const m = /\/bot([^/]+)\/sendMessage/.exec(url ?? '');
  return m?.[1] ?? '';
}

/**
 * mock 텔레그램 서버를 시작한다(ephemeral 포트, 127.0.0.1 바인딩).
 */
export function startMockTelegramServer(): Promise<MockTelegramServer> {
  const sends: CapturedSend[] = [];
  const responseQueue: MockResponse[] = [];

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handle(req, res);
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readBody(req);
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(body) as Record<string, unknown>;
    } catch {
      parsed = {};
    }
    sends.push({
      chatId: String(parsed.chat_id ?? ''),
      text: String(parsed.text ?? ''),
      parseMode: String(parsed.parse_mode ?? ''),
      disableWebPagePreview: parsed.disable_web_page_preview === true,
      token: extractToken(req.url),
    });

    const scripted = responseQueue.shift();
    if (scripted && scripted.status !== 200) {
      res.writeHead(scripted.status, { 'content-type': 'application/json' });
      const payload =
        scripted.status === 429 && typeof scripted.retryAfter === 'number'
          ? { ok: false, error_code: 429, parameters: { retry_after: scripted.retryAfter } }
          : { ok: false, error_code: scripted.status };
      res.end(JSON.stringify(payload));
      return;
    }

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, result: { message_id: sends.length } }));
  }

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        sends,
        enqueueResponse(r: MockResponse): void {
          responseQueue.push(r);
        },
        close(): Promise<void> {
          return new Promise((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
          });
        },
      });
    });
  });
}
