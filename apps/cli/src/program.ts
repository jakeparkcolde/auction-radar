import { join } from 'node:path';
import { Command, CommanderError } from 'commander';
import { CliError, ExitCode } from './exit.js';
import { defaultConfigPath } from './config/resolve.js';
import { runInitWizard } from './commands/init.js';
import { runSyncCommand } from './commands/sync.js';
import { watchAdd, watchList, watchRemove, watchTest } from './commands/watch.js';
import { runCaseCommand } from './commands/case.js';
import { runDoctorCommand } from './commands/doctor.js';
import { runExportCommand } from './commands/export.js';
import { runScheduleCommand } from './commands/schedule.js';
import type { CliDeps } from './deps.js';

/**
 * CLI 프로그램 구성 + 실행. (SPEC-CLI-001 §4)
 *
 * buildProgram: 7개 서브커맨드(init/sync/watch/case/doctor/export/schedule)를 구성한다.
 * runCli: exitOverride 로 파싱 오류=usage(2), 커맨드 런타임 오류=1, 성공=0 을 매핑한다.
 *
 * 입찰 자동화 기능(작성/전송)은 어떤 형태로도 제공하지 않는다. (CLI-REQ-010)
 */

/** CLI 버전. */
export const CLI_PACKAGE_VERSION = '0.1.0' as const;

/** exitOverride + 출력 라우팅을 커맨드에 적용한다. */
function configure(cmd: Command, deps: CliDeps): Command {
  cmd.exitOverride();
  cmd.configureOutput({
    writeOut: (str) => deps.out.log(str.replace(/\n+$/, '')),
    writeErr: (str) => deps.out.error(str.replace(/\n+$/, '')),
  });
  return cmd;
}

/**
 * CLI 프로그램을 구성한다.
 */
export function buildProgram(deps: CliDeps): Command {
  const program = new Command();
  configure(program, deps)
    .name('auction-radar')
    .description('법원경매 매각공고 셀프호스팅 리서치 CLI')
    .version(CLI_PACKAGE_VERSION);

  const configPath = (): string => defaultConfigPath(deps.homeDir);
  const lockPath = (): string => join(deps.homeDir, '.auction-radar', 'sync.lock');

  /** 설정 로드 + 스토어 개방(단일 배선). */
  const openCtx = (): { config: ReturnType<CliDeps['loadConfig']>['config']; store: ReturnType<CliDeps['openStore']> } => {
    const loaded = deps.loadConfig(configPath(), deps.env);
    const store = deps.openStore(loaded.config.store.path);
    return { config: loaded.config, store };
  };

  // init ---------------------------------------------------------------
  configure(program.command('init'), deps)
    .description('대화형 초기 설정 마법사(토큰→chat_id→워치리스트→테스트 발송)')
    .action(async () => {
      await runInitWizard({
        prompts: deps.prompts,
        createTgVerify: (t) => deps.createTgVerify(t),
        createNotifier: (t, c) => deps.createNotifier(t, c),
        configPath: configPath(),
        env: deps.env,
        clock: deps.clock,
        now: deps.now,
        out: deps.out,
      });
    });

  // sync ---------------------------------------------------------------
  configure(program.command('sync'), deps)
    .description('수집→매칭→발송 파이프라인')
    .option('--dry-run', '발송 없이 매칭 결과만 출력')
    .option('--first-run', '최초 실행(과거 물건 대량 유입 방지)')
    .option('--max-calls <n>', '세션 호출 상한(최대 30)', (v) => Number.parseInt(v, 10))
    .action(async (opts: { dryRun?: boolean; firstRun?: boolean; maxCalls?: number }) => {
      const { config, store } = openCtx();
      const notifier = deps.createNotifier(config.telegram.token, config.telegram.chatId);
      await runSyncCommand({
        store,
        source: deps.createSource(),
        notifier,
        config,
        flags: {
          ...(opts.dryRun !== undefined ? { dryRun: opts.dryRun } : {}),
          ...(opts.firstRun !== undefined ? { firstRun: opts.firstRun } : {}),
          ...(opts.maxCalls !== undefined ? { maxCalls: opts.maxCalls } : {}),
        },
        lockPath: lockPath(),
        clock: deps.clock,
        now: deps.now,
        out: deps.out,
      });
    });

  // watch --------------------------------------------------------------
  const watch = configure(program.command('watch'), deps).description('워치리스트 관리(add|list|rm|test)');

  configure(watch.command('add'), deps)
    .description('워치리스트 추가(대화형 조건 입력)')
    .action(async () => {
      const { store } = openCtx();
      const entry = await deps.prompts.inputWatchlist();
      watchAdd({ store, out: deps.out, now: deps.now }, entry);
    });

  configure(watch.command('list'), deps)
    .description('워치리스트 목록')
    .action(() => {
      const { store } = openCtx();
      watchList({ store, out: deps.out, now: deps.now });
    });

  configure(watch.command('rm'), deps)
    .description('워치리스트 삭제')
    .argument('<name>', '삭제할 워치리스트 이름')
    .action((name: string) => {
      const { store } = openCtx();
      watchRemove({ store, out: deps.out, now: deps.now }, name);
    });

  configure(watch.command('test'), deps)
    .description('매칭 미리보기(발송 없음)')
    .argument('<name>', '미리볼 워치리스트 이름')
    .action((name: string) => {
      const { store } = openCtx();
      watchTest({ store, out: deps.out, now: deps.now }, name);
    });

  // case ---------------------------------------------------------------
  configure(program.command('case'), deps)
    .description('사건 단건 조회(기일 이력 포함)')
    .argument('<court>', '법원 코드')
    .argument('<caseNumber>', '사건번호')
    .action((court: string, caseNumber: string) => {
      const { store } = openCtx();
      runCaseCommand({ store, out: deps.out }, court, caseNumber);
    });

  // doctor -------------------------------------------------------------
  configure(program.command('doctor'), deps)
    .description('환경 진단(5개 항목)')
    .action(async () => {
      const { config, store } = openCtx();
      await runDoctorCommand({
        store,
        tgVerify: deps.createTgVerify(config.telegram.token),
        config,
        out: deps.out,
      });
    });

  // export -------------------------------------------------------------
  configure(program.command('export'), deps)
    .description('매칭 물건 xlsx 내보내기')
    .option('--xlsx', 'xlsx 형식으로 내보내기(기본)', true)
    .option('--watch <name>', '특정 워치리스트로 필터')
    .option('--out <path>', '출력 파일 경로', 'auction-radar-export.xlsx')
    .action(async (opts: { watch?: string; out: string }) => {
      const { store } = openCtx();
      await runExportCommand(
        { store, out: deps.out },
        { filePath: opts.out, ...(opts.watch !== undefined ? { watchlist: opts.watch } : {}) },
      );
    });

  // schedule -----------------------------------------------------------
  const schedule = configure(program.command('schedule'), deps).description('OS 스케줄러 설치 안내');
  configure(schedule.command('install'), deps)
    .description('launchd(macOS) plist / crontab(Linux) 라인 생성')
    .action(() => {
      runScheduleCommand({
        platform: deps.platform,
        execPath: deps.execPath,
        scriptPath: deps.scriptPath,
        out: deps.out,
      });
    });

  return program;
}

/**
 * argv 로 CLI 를 실행하고 종료 코드를 반환한다.
 *
 * @param deps 주입 의존성.
 * @param argv 사용자 인자(node·스크립트 경로 제외).
 * @returns 종료 코드(0 성공 / 1 런타임 오류 / 2 사용자 입력 오류).
 */
export async function runCli(deps: CliDeps, argv: readonly string[]): Promise<number> {
  const program = buildProgram(deps);
  try {
    await program.parseAsync([...argv], { from: 'user' });
    return ExitCode.OK;
  } catch (err) {
    if (err instanceof CommanderError) {
      // help/version 표시는 정상 종료(0), 그 외 파싱 오류는 usage(2).
      if (
        err.code === 'commander.helpDisplayed' ||
        err.code === 'commander.help' ||
        err.code === 'commander.version'
      ) {
        return ExitCode.OK;
      }
      return ExitCode.USAGE;
    }
    if (err instanceof CliError) {
      deps.out.error(err.message);
      return err.exitCode;
    }
    deps.out.error(err instanceof Error ? err.message : String(err));
    return ExitCode.RUNTIME;
  }
}
