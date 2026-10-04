/**
 * Session persistence for successful quota results.
 *
 * One sessionStorage item per API base, so two backends opened in the same tab
 * never read each other's quota. Only successful quota states are stored, as the
 * quota feature already holds them in memory: windows, plan, reset instants.
 * Those states carry no provider token or management key (the quota parsers
 * drop credential-bearing fields before building state), and errors are never
 * written.
 *
 * Everything read back is untrusted: malformed JSON, a wrong version, entries
 * with missing fields, or entries older than the TTL are dropped silently. The
 * caller supplies `isValidState` for the provider-specific shape check.
 */

import { getQuotaCacheFileName } from '@/utils/quota/identity';

export const QUOTA_CACHE_STORAGE_PREFIX = 'quotaCache.v1:';

const STORAGE_VERSION = 1;

/** A stored entry dated this far in the future is treated as corrupt. */
const MAX_CLOCK_SKEW_MS = 60_000;

export type QuotaCacheStorage = Pick<
  Storage,
  'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'
>;

export interface PersistedQuotaEntry {
  provider: string;
  cacheKey: string;
  fetchedAtMs: number;
  state: Record<string, unknown>;
}

interface PersistedQuotaPayload {
  v: number;
  entries: PersistedQuotaEntry[];
}

export const quotaCacheStorageKey = (apiBase: string) => `${QUOTA_CACHE_STORAGE_PREFIX}${apiBase}`;

export function getQuotaCacheStorage(): QuotaCacheStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    // Access throws when storage is disabled by the browser.
    return null;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isFreshInstant = (fetchedAtMs: unknown, nowMs: number, ttlMs: number): boolean =>
  typeof fetchedAtMs === 'number' &&
  Number.isFinite(fetchedAtMs) &&
  fetchedAtMs <= nowMs + MAX_CLOCK_SKEW_MS &&
  nowMs - fetchedAtMs < ttlMs;

const parseEntry = (
  value: unknown,
  nowMs: number,
  ttlMs: number,
  isValidState: (provider: string, state: Record<string, unknown>) => boolean
): PersistedQuotaEntry | null => {
  if (!isRecord(value)) return null;
  const { provider, cacheKey, fetchedAtMs, state } = value;
  if (typeof provider !== 'string' || typeof cacheKey !== 'string' || !cacheKey) return null;
  if (!isFreshInstant(fetchedAtMs, nowMs, ttlMs)) return null;
  if (!isRecord(state) || state.status !== 'success') return null;
  if (!isValidState(provider, state)) return null;
  return { provider, cacheKey, fetchedAtMs: fetchedAtMs as number, state };
};

/** Fresh, well-formed entries stored for `apiBase`. Never throws. */
export function readPersistedQuota(
  storage: QuotaCacheStorage | null,
  apiBase: string,
  nowMs: number,
  ttlMs: number,
  isValidState: (provider: string, state: Record<string, unknown>) => boolean
): PersistedQuotaEntry[] {
  if (!storage || !apiBase) return [];
  try {
    const raw = storage.getItem(quotaCacheStorageKey(apiBase));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || parsed.v !== STORAGE_VERSION || !Array.isArray(parsed.entries)) {
      return [];
    }
    return parsed.entries
      .map((entry) => parseEntry(entry, nowMs, ttlMs, isValidState))
      .filter((entry): entry is PersistedQuotaEntry => entry !== null);
  } catch {
    return [];
  }
}

/**
 * Store one entry, replacing any earlier one for the same credential and
 * dropping entries that have aged out. Storage errors (quota exceeded,
 * disabled storage) are swallowed: persistence is an optimization.
 */
export function writePersistedQuotaEntry(
  storage: QuotaCacheStorage | null,
  apiBase: string,
  entry: PersistedQuotaEntry,
  nowMs: number,
  ttlMs: number,
  isValidState: (provider: string, state: Record<string, unknown>) => boolean
): void {
  if (!storage || !apiBase) return;
  const kept = readPersistedQuota(storage, apiBase, nowMs, ttlMs, isValidState).filter(
    (existing) => existing.provider !== entry.provider || existing.cacheKey !== entry.cacheKey
  );
  const payload: PersistedQuotaPayload = { v: STORAGE_VERSION, entries: [...kept, entry] };
  try {
    storage.setItem(quotaCacheStorageKey(apiBase), JSON.stringify(payload));
  } catch {
    // ignore
  }
}

const quotaCacheKeys = (storage: QuotaCacheStorage): string[] => {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(QUOTA_CACHE_STORAGE_PREFIX)) keys.push(key);
  }
  return keys;
};

/**
 * Drop stored entries for these physical auth files under every API base.
 * Mirrors clearQuotaCache(names) after an auth-file mutation.
 */
export function removePersistedQuotaFiles(
  storage: QuotaCacheStorage | null,
  fileNames: readonly string[]
): void {
  if (!storage || fileNames.length === 0) return;
  const names = new Set(fileNames);
  try {
    for (const key of quotaCacheKeys(storage)) {
      const parsed = JSON.parse(storage.getItem(key) ?? 'null') as unknown;
      if (!isRecord(parsed) || !Array.isArray(parsed.entries)) {
        storage.removeItem(key);
        continue;
      }
      const entries = parsed.entries.filter(
        (entry) =>
          isRecord(entry) &&
          typeof entry.cacheKey === 'string' &&
          !names.has(getQuotaCacheFileName(entry.cacheKey))
      );
      if (entries.length !== parsed.entries.length) {
        storage.setItem(key, JSON.stringify({ ...parsed, entries }));
      }
    }
  } catch {
    // ignore
  }
}

/** Remove every stored quota result, for all API bases. Used on logout. */
export function clearPersistedQuota(storage: QuotaCacheStorage | null): void {
  if (!storage) return;
  try {
    quotaCacheKeys(storage).forEach((key) => storage.removeItem(key));
  } catch {
    // ignore
  }
}
