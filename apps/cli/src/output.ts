/**
 * 출력 포트. (테스트 주입 가능)
 *
 * 커맨드 로직은 process.stdout/stderr 를 직접 쓰지 않고 이 포트로 출력해
 * 테스트에서 출력 캡처가 가능하게 한다.
 */
export interface Output {
  /** 표준 출력(stdout) 한 줄. */
  log(message: string): void;
  /** 표준 에러(stderr) 한 줄. */
  error(message: string): void;
}

/** 라인 배열을 수집하는 인메모리 Output(테스트·버퍼링용). */
export class BufferOutput implements Output {
  readonly logs: string[] = [];
  readonly errors: string[] = [];

  log(message: string): void {
    this.logs.push(message);
  }

  error(message: string): void {
    this.errors.push(message);
  }

  /** stdout 로 수집된 전체 텍스트. */
  get stdout(): string {
    return this.logs.join('\n');
  }

  /** stderr 로 수집된 전체 텍스트. */
  get stderr(): string {
    return this.errors.join('\n');
  }
}
