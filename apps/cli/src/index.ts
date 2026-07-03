/**
 * auction-radar CLI 진입점 (스텁). (기획서 §7)
 *
 * SPEC-CLI-001 범위. 현재는 빌드 가능한 스텁이며, 실제 명령
 * (init/sync/watch/case/export/doctor/schedule)은 후속 SPEC 에서 구현한다.
 */
import { ENDPOINTS_VERSION } from '@auction-radar/core';

/** CLI 버전 마커 (스텁). */
export const CLI_PACKAGE_VERSION = '0.1.0' as const;

/** 스텁 진입 함수. 코어가 링크되었음을 확인하는 최소 로직만 포함한다. */
export function main(): void {
  process.stdout.write(`auction-radar CLI (stub) — endpoints ${ENDPOINTS_VERSION}\n`);
}
