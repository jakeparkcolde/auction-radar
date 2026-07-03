import { z } from 'zod';

/**
 * 설정 파일 스키마. (기획서 §6.7, CLI-REQ-004)
 *
 * `~/.auction-radar/config.json` 을 zod 로 검증한다.
 * `env:` 프리픽스 문자열은 로드 후 resolve 단계에서 환경변수로 해석된다(schema 는 문자열로 통과).
 */

/** 현재 지원하는 설정 스키마 버전. */
export const CURRENT_CONFIG_VERSION = 1 as const;

/** 워치리스트 조건(§6.4). ALERT WatchlistConfig 와 구조적으로 호환된다. */
export const watchlistSchema = z.object({
  name: z.string().optional(),
  courts: z.array(z.string()).optional(),
  regions: z.array(z.string()).optional(),
  usages: z.array(z.string()).optional(),
  appraisedMax: z.number().nullable().optional(),
  appraisedMin: z.number().nullable().optional(),
  minPriceRatioMax: z.number().nullable().optional(),
  failedCountMin: z.number().nullable().optional(),
  includeNew: z.boolean().optional(),
  keywords: z.array(z.string()).optional(),
  excludeKeywords: z.array(z.string()).optional(),
  notify: z.array(z.string()).optional(),
});

/** 텔레그램 설정. token/chatId 는 `env:` 참조 또는 평문. */
export const telegramSchema = z.object({
  token: z.string(),
  chatId: z.string(),
});

/** 스토어 설정. */
export const storeSchema = z.object({
  driver: z.enum(['sqlite', 'supabase']).default('sqlite'),
  path: z.string(),
});

/** 수집기 설정. */
export const collectorSchema = z.object({
  minDelayMs: z.number().default(2000),
  maxCallsPerSession: z.number().default(10),
  /** 자동 실행 시각(HH:MM, KST). schedule install 이 참조. */
  schedule: z.array(z.string()).default(['08:00', '18:00']),
});

/** enrich(실거래 결합) 설정. */
export const enrichSchema = z.object({
  molitKey: z.string().optional(),
  enabled: z.boolean().default(false),
});

/** 알림 설정. */
export const notifySchema = z.object({
  digestThreshold: z.number().default(6),
  quietHours: z.tuple([z.string(), z.string()]).default(['23:00', '07:00']),
});

/** 설정 파일 전체 스키마. */
export const configSchema = z.object({
  version: z.number(),
  telegram: telegramSchema,
  store: storeSchema,
  collector: collectorSchema,
  enrich: enrichSchema,
  notify: notifySchema,
  watchlists: z.array(watchlistSchema).default([]),
});

/** 검증·기본값 적용된 설정 타입. */
export type Config = z.infer<typeof configSchema>;
/** 워치리스트 조건 타입. */
export type WatchlistEntry = z.infer<typeof watchlistSchema>;
