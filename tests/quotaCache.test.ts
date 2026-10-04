/**
 * Quota cache: TTL, single-flight, explicit-refresh bypass, sessionStorage.
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import {
  QUOTA_CACHE_TTL_MS,
  fetchQuotaShared,
  inFlightQuotaCount,
  isQuotaFresh,
  needsAutoLoad,
  persistQuotaSuccess,
  restorePersistedQuota,
  selectQuotaLoadTargets,
  singleFlight,
  updatedAgoInstant,
} from '@/features/quota/quotaCache';
import type { QuotaProviderType } from '@/features/quota/providers/types';
import {
  QUOTA_CACHE_STORAGE_PREFIX,
  clearPersistedQuota,
  quotaCacheStorageKey,
  readPersistedQuota,
  removePersistedQuotaFiles,
  type QuotaCacheStorage,
} from '@/services/storage/quotaCacheStorage';
import { useQuotaStore } from '@/stores/useQuotaStore';
import type { AuthFileItem } from '@/types';

const NOW = Date.UTC(2026, 9, 4, 12, 0, 0);
const BASE = 'http://127.0.0.1:8317';

class MemoryStorage implements QuotaCacheStorage {
  private items = new Map<string, string>();
  get length() {
    return this.items.size;
  }
  key(index: number) {
    return Array.from(this.items.keys())[index] ?? null;
  }
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
}

const file = (name: string): AuthFileItem => ({ name, type: 'claude' }) as AuthFileItem;

const success = (fetchedAtMs?: number) => ({
  status: 'success' as const,
  windows: [{ id: 'seven-day', usedPercent: 96, resetAtMs: NOW + 86_400_000 }],
  ...(fetchedAtMs === undefined ? {} : { fetchedAtMs }),
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

beforeEach(() => {
  useQuotaStore.getState().clearQuotaCache();
});

describe('TTL', () => {
  test('a success younger than the TTL is a hit; at the TTL it is a miss', () => {
    expect(QUOTA_CACHE_TTL_MS).toBe(5 * 60_000);
    expect(isQuotaFresh(success(NOW - QUOTA_CACHE_TTL_MS + 1), NOW)).toBe(true);
    expect(isQuotaFresh(success(NOW - QUOTA_CACHE_TTL_MS), NOW)).toBe(false);
    expect(isQuotaFresh(success(), NOW)).toBe(false);
    expect(isQuotaFresh({ status: 'error', fetchedAtMs: NOW }, NOW)).toBe(false);
    expect(isQuotaFresh(success(NOW + 10 * 60_000), NOW)).toBe(false);
  });

  test('automatic loads fetch missing, idle, and stale results only', () => {
    expect(needsAutoLoad(undefined, NOW)).toBe(true);
    expect(needsAutoLoad({ status: 'idle' }, NOW)).toBe(true);
    expect(needsAutoLoad(success(NOW - QUOTA_CACHE_TTL_MS - 1), NOW)).toBe(true);
    expect(needsAutoLoad(success(NOW - 60_000), NOW)).toBe(false);
    expect(needsAutoLoad({ status: 'loading' }, NOW)).toBe(false);
    expect(needsAutoLoad({ status: 'error' }, NOW)).toBe(false);
  });

  test('an explicit refresh bypasses the TTL; an automatic load skips fresh results', () => {
    const states: Record<string, unknown> = {
      'fresh.json': success(NOW - 60_000),
      'stale.json': success(NOW - QUOTA_CACHE_TTL_MS - 1),
    };
    const targets = [
      { type: 'claude' as QuotaProviderType, file: file('fresh.json') },
      { type: 'claude' as QuotaProviderType, file: file('stale.json') },
      { type: 'claude' as QuotaProviderType, file: file('missing.json') },
    ];
    const readState = (_type: QuotaProviderType, key: string) => states[key];
    const pick = (force: boolean) =>
      selectQuotaLoadTargets(targets, readState, NOW, force).map((t) => t.file.name);

    expect(pick(false)).toEqual(['stale.json', 'missing.json']);
    expect(pick(true)).toEqual(['fresh.json', 'stale.json', 'missing.json']);
  });

  test('"updated X ago" never points into the future', () => {
    expect(updatedAgoInstant(NOW + 30_000, NOW)).toBe(NOW - 1);
    expect(updatedAgoInstant(NOW - 120_000, NOW)).toBe(NOW - 120_000);
  });
});

describe('single-flight', () => {
  test('concurrent calls for one key share one run and one result', async () => {
    const gate = deferred<string>();
    let runs = 0;
    const run = () => {
      runs += 1;
      return gate.promise;
    };
    const first = singleFlight('k', run);
    const second = singleFlight('k', run);
    const other = singleFlight('other', () => Promise.resolve('x'));
    expect(first).toBe(second);
    gate.resolve('done');
    expect(await Promise.all([first, second, other])).toEqual(['done', 'done', 'x']);
    expect(runs).toBe(1);
    expect(inFlightQuotaCount()).toBe(0);

    await singleFlight('k', run);
    expect(runs).toBe(2);
  });

  test('a failure reaches every joiner and does not stick', async () => {
    const gate = deferred<string>();
    const first = singleFlight('fail', () => gate.promise);
    const second = singleFlight('fail', () => Promise.resolve('never'));
    gate.reject(new Error('boom'));
    await expect(first).rejects.toThrow('boom');
    await expect(second).rejects.toThrow('boom');
    expect(await singleFlight('fail', () => Promise.resolve('retry'))).toBe('retry');
  });

  test('dashboard, quota page, and StrictMode callers share one upstream fetch', async () => {
    const gate = deferred<{ windows: [] }>();
    let fetches = 0;
    const fetch = () => {
      fetches += 1;
      return gate.promise;
    };
    const target = file('claude-a.json');
    const calls = [
      fetchQuotaShared('claude', target, fetch, () => NOW),
      fetchQuotaShared('claude', target, fetch, () => NOW + 1),
      fetchQuotaShared('claude', target, fetch, () => NOW + 2),
    ];
    gate.resolve({ windows: [] });
    const results = await Promise.all(calls);
    expect(fetches).toBe(1);
    expect(results.map((r) => r.fetchedAtMs)).toEqual([NOW, NOW, NOW]);
  });

  test('a reconnect or file mutation starts a new flight instead of joining the old one', async () => {
    const gate = deferred<number>();
    let fetches = 0;
    const fetch = () => {
      fetches += 1;
      return fetches === 1 ? gate.promise : Promise.resolve(2);
    };
    const target = file('claude-b.json');
    const old = fetchQuotaShared('claude', target, fetch);
    useQuotaStore.getState().clearQuotaCache(['claude-b.json']);
    const fresh = await fetchQuotaShared('claude', target, fetch);
    expect(fresh.data).toBe(2);
    expect(fetches).toBe(2);
    gate.resolve(1);
    expect((await old).data).toBe(1);
  });
});

describe('sessionStorage persistence', () => {
  const readState = (states: Record<string, unknown>) => (_type: QuotaProviderType, key: string) =>
    states[key];

  test('round-trips a success within the TTL, scoped by API base', () => {
    const storage = new MemoryStorage();
    const state = success(NOW - 60_000);
    persistQuotaSuccess('claude', 'claude-a.json', state, storage, BASE);
    expect(storage.length).toBe(1);
    expect(storage.key(0)).toBe(`${QUOTA_CACHE_STORAGE_PREFIX}${BASE}`);

    const committed: Record<string, unknown> = {};
    const restored = restorePersistedQuota(
      [{ type: 'claude', file: file('claude-a.json') }],
      readState({}),
      (_type, key, value) => {
        committed[key] = value;
      },
      NOW,
      storage,
      BASE
    );
    expect(restored).toBe(1);
    expect(committed['claude-a.json']).toEqual(state);

    // Another backend in the same tab sees nothing.
    expect(
      restorePersistedQuota(
        [{ type: 'claude', file: file('claude-a.json') }],
        readState({}),
        () => {},
        NOW,
        storage,
        'http://other:8317'
      )
    ).toBe(0);
  });

  test('stores only success states and never overwrites something already loaded', () => {
    const storage = new MemoryStorage();
    persistQuotaSuccess('claude', 'err.json', { status: 'error', error: 'x' }, storage, BASE);
    persistQuotaSuccess('claude', 'unstamped.json', success(), storage, BASE);
    expect(storage.length).toBe(0);

    persistQuotaSuccess('claude', 'a.json', success(NOW - 1000), storage, BASE);
    expect(
      restorePersistedQuota(
        [{ type: 'claude', file: file('a.json') }],
        readState({ 'a.json': { status: 'error' } }),
        () => {
          throw new Error('must not commit');
        },
        NOW,
        storage,
        BASE
      )
    ).toBe(0);
  });

  test('ignores stale entries after the TTL', () => {
    const storage = new MemoryStorage();
    persistQuotaSuccess('claude', 'a.json', success(NOW - QUOTA_CACHE_TTL_MS), storage, BASE);
    expect(
      restorePersistedQuota(
        [{ type: 'claude', file: file('a.json') }],
        readState({}),
        () => {},
        NOW,
        storage,
        BASE
      )
    ).toBe(0);
  });

  test('drops malformed JSON, wrong versions, and entries with a bad shape', () => {
    const storage = new MemoryStorage();
    const key = quotaCacheStorageKey(BASE);
    const valid = (p: string) => p === 'claude';
    const read = () => readPersistedQuota(storage, BASE, NOW, QUOTA_CACHE_TTL_MS, valid);

    storage.setItem(key, '{not json');
    expect(read()).toEqual([]);
    storage.setItem(key, JSON.stringify({ v: 99, entries: [] }));
    expect(read()).toEqual([]);
    storage.setItem(key, JSON.stringify({ v: 1, entries: 'nope' }));
    expect(read()).toEqual([]);

    const good = { provider: 'claude', cacheKey: 'a.json', fetchedAtMs: NOW - 1, state: success() };
    storage.setItem(
      key,
      JSON.stringify({
        v: 1,
        entries: [
          good,
          null,
          { ...good, cacheKey: 7 },
          { ...good, fetchedAtMs: 'yesterday' },
          { ...good, fetchedAtMs: NOW + 3_600_000 },
          { ...good, state: { status: 'error' } },
          { ...good, provider: 'unknown' },
        ],
      })
    );
    expect(read()).toEqual([good]);

    // The feature-level shape check rejects a success whose windows are not objects.
    storage.setItem(
      key,
      JSON.stringify({
        v: 1,
        entries: [{ ...good, state: { status: 'success', windows: [null] } }],
      })
    );
    expect(
      restorePersistedQuota(
        [{ type: 'claude', file: file('a.json') }],
        readState({}),
        () => {},
        NOW,
        storage,
        BASE
      )
    ).toBe(0);
  });

  test('file mutations and logout remove stored entries', () => {
    const storage = new MemoryStorage();
    persistQuotaSuccess('claude', 'a.json', success(NOW - 1000), storage, BASE);
    persistQuotaSuccess('claude', 'b.json', success(NOW - 1000), storage, BASE);
    removePersistedQuotaFiles(storage, ['a.json']);
    expect(
      readPersistedQuota(storage, BASE, NOW, QUOTA_CACHE_TTL_MS, () => true).map(
        (entry) => entry.cacheKey
      )
    ).toEqual(['b.json']);

    storage.setItem('unrelated', 'keep');
    clearPersistedQuota(storage);
    expect(storage.length).toBe(1);
    expect(storage.getItem('unrelated')).toBe('keep');
  });

  test('stored payload holds quota fields only', () => {
    const storage = new MemoryStorage();
    persistQuotaSuccess('claude', 'a.json', success(NOW - 1000), storage, BASE);
    const raw = storage.getItem(quotaCacheStorageKey(BASE)) ?? '';
    expect(JSON.parse(raw)).toEqual({
      v: 1,
      entries: [
        {
          provider: 'claude',
          cacheKey: 'a.json',
          fetchedAtMs: NOW - 1000,
          state: success(NOW - 1000),
        },
      ],
    });
  });
});
