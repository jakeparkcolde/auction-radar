#!/usr/bin/env node
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { HttpSourceClient, systemClock } from '@auction-radar/core';
import { TelegramNotifier } from '@auction-radar/alert';
import { runCli } from './program.js';
import { loadConfig } from './config/resolve.js';
import { openStore } from './store/open.js';
import { TgVerifyClient } from './telegram/verify.js';
import { inquirerPrompts } from './wizard/prompts.js';
import type { CliDeps } from './deps.js';
import type { Output } from './output.js';

/**
 * auction-radar CLI 진입점(bin). (SPEC-CLI-001)
 *
 * 실 의존성(네트워크·파일시스템·터미널)을 배선해 runCli 에 주입한다.
 * 순수 로직이 없는 배선 전용 파일이므로 커버리지에서 제외한다(vitest.config.ts).
 */

const out: Output = {
  log: (message) => process.stdout.write(`${message}\n`),
  error: (message) => process.stderr.write(`${message}\n`),
};

const deps: CliDeps = {
  out,
  clock: systemClock,
  now: () => new Date().toISOString(),
  env: process.env,
  platform: process.platform,
  homeDir: homedir(),
  execPath: process.execPath,
  scriptPath: fileURLToPath(import.meta.url),
  prompts: inquirerPrompts,
  openStore,
  createSource: () => new HttpSourceClient(),
  createNotifier: (token, chatId) => new TelegramNotifier({ token, chatId }),
  createTgVerify: (token) => new TgVerifyClient({ token }),
  loadConfig,
};

void runCli(deps, process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
