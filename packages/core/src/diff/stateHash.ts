import { createHash } from 'node:crypto';
import type { ItemState } from '../types.js';

/**
 * state_hash 정준 직렬화 + 계산. (REQ-013)
 *
 * state_hash = sha1( min_sale_price | failed_count | 다음 sale_date
 *                    | correction_count | cancellation_count | status )
 *
 * 정준 직렬화 규칙 (리팩토링 시 해시 변동 방지를 위해 고정):
 * - 구분자는 '|' 고정
 * - 필드 순서 고정 (위 순서)
 * - null 은 리터럴 문자열 "null"
 * - 숫자는 십진 문자열 (String(n))
 * - 포맷은 fixture 테스트로 동결된다
 */

const DELIMITER = '|' as const;
const NULL_LITERAL = 'null' as const;

/** 단일 필드를 정준 문자열로 직렬화한다. */
function field(value: number | string | null): string {
  if (value === null) return NULL_LITERAL;
  if (typeof value === 'number') return String(value);
  return value;
}

/**
 * ItemState 를 정준 직렬화 문자열로 변환한다.
 *
 * 필드 순서는 절대 변경하면 안 된다. (해시 안정성)
 */
export function serializeState(state: ItemState): string {
  return [
    field(state.minSalePrice),
    field(state.failedCount),
    field(state.nextSaleDate),
    field(state.correctionCount),
    field(state.cancellationCount),
    field(state.status),
  ].join(DELIMITER);
}

/** ItemState 로부터 state_hash(sha1 hex)를 계산한다. */
export function stateHash(state: ItemState): string {
  return createHash('sha1').update(serializeState(state), 'utf8').digest('hex');
}
