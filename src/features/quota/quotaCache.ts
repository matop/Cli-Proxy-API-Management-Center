/**
 * Quota freshness, request sharing, and session persistence.
 *
 * Quota loads call /v0/management/api-call, which hits provider status
 * endpoints. They cost no model tokens but should not repeat needlessly, and the
 * dashboard and the Quota page load the same credentials.
 *
 * - TTL: an automatic load reuses a successful result younger than
 *   QUOTA_CACHE_TTL_MS. Explicit refreshes ignore the TTL.
 * - Single-flight: concurrent fetches for one credential share one promise,
 *   whoever starts them (dashboard, Quota page, StrictMode double effects,
 *   explicit refresh). The key includes the store's session and file
 *   generations, so a request started before a reconnect or an auth-file
 *   mutation is never handed to a caller after it.
 * - Persistence: successful results are written to sessionStorage per API base
 *   (services/storage/quotaCacheStorage.ts) and restored after a reload while
 *   still inside the TTL.
 *
 * Imports no provider adapters, so it stays testable without SCSS modules.
 */

import type { AuthFileItem } from '@/types';
import { useAuthStore } from '@/stores/useAuthStore';
import { useQuotaStore } from '@/stores/useQuotaStore';
import {
  getQuotaCacheStorage,
  readPersistedQuota,
  writePersistedQuotaEntry,
  type QuotaCacheStorage,
} from '@/services/storage/quotaCacheStorage';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import { MINUTE_MS } from '@/utils/time/durations';
import type { QuotaProviderType } from './providers/types';

/** Automatic loads reuse a successful result younger than this. */
export const QUOTA_CACHE_TTL_MS = 5 * MINUTE_MS;

type QuotaStateLike = { status?: string; fetchedAtMs?: unknown } | undefined;

/** True for a successful result fetched less than `ttlMs` ago. */
export function isQuotaFresh(state: unknown, nowMs: number, ttlMs = QUOTA_CACHE_TTL_MS): boolean {
  const quota = state as QuotaStateLike;
  if (!quota || quota.status !== 'success') return false;
  const fetchedAtMs = quota.fetchedAtMs;
  return (
    typeof fetchedAtMs === 'number' &&
    Number.isFinite(fetchedAtMs) &&
    fetchedAtMs <= nowMs + MINUTE_MS &&
    nowMs - fetchedAtMs < ttlMs
  );
}

/**
 * Whether an automatic load should fetch this credential: nothing loaded yet,
 * or a success that has aged past the TTL. Loading and failed states are left
 * alone; a failure is retried by the user, not by opening a page.
 */
export function needsAutoLoad(state: unknown, nowMs: number): boolean {
  const quota = state as QuotaStateLike;
  if (!quota || quota.status === 'idle') return true;
  return quota.status === 'success' && !isQuotaFresh(quota, nowMs);
}

/**
 * Credentials a batch load should fetch. An explicit load (`force`) fetches all
 * of them; an automatic one skips results still inside the TTL.
 */
export function selectQuotaLoadTargets<T extends { type: QuotaProviderType; file: AuthFileItem }>(
  targets: readonly T[],
  readState: (type: QuotaProviderType, cacheKey: string) => unknown,
  nowMs: number,
  force: boolean
): T[] {
  if (force) return [...targets];
  return targets.filter(
    ({ type, file }) => !isQuotaFresh(readState(type, getQuotaCacheKey(file)), nowMs)
  );
}

/** Instant for "updated X ago": never in the future, so it always reads as past. */
export const updatedAgoInstant = (fetchedAtMs: number, nowMs: number) =>
  Math.min(fetchedAtMs, nowMs - 1);

/* ---------- single-flight ---------- */

const inFlight = new Map<string, Promise<unknown>>();

/** Run `run` once per key at a time; callers arriving meanwhile get the same promise. */
export function singleFlight<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;
  const promise = Promise.resolve()
    .then(run)
    .finally(() => {
      if (inFlight.get(key) === promise) inFlight.delete(key);
    });
  inFlight.set(key, promise);
  return promise;
}

/** Number of fetches currently shared. Exposed for tests. */
export const inFlightQuotaCount = () => inFlight.size;

/** Single-flight key: getQuotaCacheKey plus provider and the session/file generations. */
export function quotaFlightKey(type: QuotaProviderType, file: AuthFileItem): string {
  const { cacheGeneration, fileGenerations } = useQuotaStore.getState();
  return JSON.stringify([
    cacheGeneration,
    fileGenerations[file.name] ?? 0,
    type,
    getQuotaCacheKey(file),
  ]);
}

export interface FetchedQuota<T> {
  data: T;
  /** When the shared fetch resolved; every caller that joined it commits this same instant. */
  fetchedAtMs: number;
}

/** Fetch one credential's quota, joining an identical fetch already in flight. */
export function fetchQuotaShared<T>(
  type: QuotaProviderType,
  file: AuthFileItem,
  fetch: () => Promise<T>,
  now: () => number = Date.now
): Promise<FetchedQuota<T>> {
  return singleFlight(quotaFlightKey(type, file), async () => {
    const data = await fetch();
    return { data, fetchedAtMs: now() };
  });
}

/* ---------- session persistence ---------- */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isRecordArray = (value: unknown): boolean => Array.isArray(value) && value.every(isRecord);

/**
 * Shape check for a stored success state: the array or object each provider's
 * renderer walks must be there, so a tampered entry cannot crash a card.
 */
export function isPersistableQuotaState(provider: string, state: Record<string, unknown>): boolean {
  switch (provider) {
    case 'claude':
    case 'codex':
    case 'devin':
      return isRecordArray(state.windows);
    case 'kimi':
      return isRecordArray(state.rows);
    case 'antigravity':
      return isRecordArray(state.groups);
    case 'meta':
      return isRecord(state.data) && isRecordArray(state.data.windows);
    case 'xai':
      return state.billing === null || isRecord(state.billing);
    default:
      return false;
  }
}

const currentApiBase = () => useAuthStore.getState().apiBase;

/** Persist one successful, stamped state. Errors and unstamped states are ignored. */
export function persistQuotaSuccess(
  provider: QuotaProviderType,
  cacheKey: string,
  state: unknown,
  storage: QuotaCacheStorage | null = getQuotaCacheStorage(),
  apiBase: string = currentApiBase()
): void {
  if (!isRecord(state) || state.status !== 'success') return;
  const fetchedAtMs = state.fetchedAtMs;
  if (typeof fetchedAtMs !== 'number' || !Number.isFinite(fetchedAtMs)) return;
  writePersistedQuotaEntry(
    storage,
    apiBase,
    { provider, cacheKey, fetchedAtMs, state },
    fetchedAtMs,
    QUOTA_CACHE_TTL_MS,
    isPersistableQuotaState
  );
}

export interface QuotaRestoreTarget {
  type: QuotaProviderType;
  file: AuthFileItem;
}

/**
 * Put persisted, still-fresh results back into memory for targets that have
 * nothing loaded (missing or idle). Returns how many were restored.
 */
export function restorePersistedQuota(
  targets: readonly QuotaRestoreTarget[],
  readState: (type: QuotaProviderType, cacheKey: string) => unknown,
  commit: (type: QuotaProviderType, cacheKey: string, state: Record<string, unknown>) => void,
  nowMs: number,
  storage: QuotaCacheStorage | null = getQuotaCacheStorage(),
  apiBase: string = currentApiBase()
): number {
  if (targets.length === 0) return 0;
  const stored = readPersistedQuota(
    storage,
    apiBase,
    nowMs,
    QUOTA_CACHE_TTL_MS,
    isPersistableQuotaState
  );
  if (stored.length === 0) return 0;
  const byKey = new Map(
    stored.map((entry) => [JSON.stringify([entry.provider, entry.cacheKey]), entry])
  );
  let restored = 0;
  for (const { type, file } of targets) {
    const cacheKey = getQuotaCacheKey(file);
    const current = readState(type, cacheKey) as QuotaStateLike;
    if (current && current.status !== 'idle') continue;
    const entry = byKey.get(JSON.stringify([type, cacheKey]));
    if (!entry) continue;
    commit(type, cacheKey, { ...entry.state, fetchedAtMs: entry.fetchedAtMs });
    restored += 1;
  }
  return restored;
}
