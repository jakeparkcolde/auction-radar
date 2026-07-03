/**
 * CLI 종료 코드 규약. (SPEC-CLI-001 §4)
 *
 * - OK      = 0 : 성공
 * - RUNTIME = 1 : 실행 실패(런타임 오류)
 * - USAGE   = 2 : 사용자 입력 오류(잘못된 명령/플래그)
 */
export enum ExitCode {
  OK = 0,
  RUNTIME = 1,
  USAGE = 2,
}

/**
 * 명령 실행 중 발생하는, 종료 코드가 결정된 오류.
 *
 * 커맨드 로직은 이 오류를 던져 program 래퍼가 적절한 종료 코드로
 * 변환하도록 한다(런타임=1). 사용자 입력 오류(usage=2)는 commander 가 처리한다.
 */
export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode: ExitCode = ExitCode.RUNTIME,
  ) {
    super(message);
    this.name = 'CliError';
  }
}
