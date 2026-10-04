/**
 * Auth Files quota section on the shared quota cache.
 *
 * AuthFileQuotaSection refreshes through useQuotaActions (refreshQuotaEntry)
 * and restores persisted results with restoreQuotaFromSession on mount. There
 * is no DOM harness, so the component is pinned to those two entry points by a
 * source check and the entry points are exercised directly.
 */

import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, test } from 'bun:test';
import type { TFunction } from 'i18next';
import i18n from '@/i18n';
import { refreshQuotaEntry } from '@/features/quota/hooks/useQuotaActions';
import { restoreQuotaFromSession } from '@/features/quota/hooks/useQuotaBatchLoader';
import { QUOTA_ADAPTERS, type QuotaAdapter } from '@/features/quota/providers';
import {
  QUOTA_CACHE_TTL_MS,
  fetchQuotaShared,
  inFlightQuotaCount,
  persistQuotaSuccess,
} from '@/features/quota/quotaCache';
import type { QuotaCacheStorage } from '@/services/storage/quotaCacheStorage';
import { useQuotaStore } from '@/stores/useQuotaStore';
import type { AuthFileItem, ClaudeQuotaState } from '@/types';
import { getQuotaCacheKey } from '@/utils/quota/identity';

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

const file = { name: 'claude-auth.json', type: 'claude' } as AuthFileItem;
const cacheKey = getQuotaCacheKey(file);
const t = i18n.t.bind(i18n) as TFunction;
const data = {
  windows: [
    {
      id: 'seven-day',
      label: '7-day limit',
      usedPercent: 40,
      resetLabel: '',
      resetAtMs: Date.now() + 86_400_000,
      periodHours: 168,
    },
  ],
  extraUsage: null,
  planType: null,
};

/** The Claude adapter with a counted fetch, as the Auth Files card would use it. */
const countingAdapter = () => {
  const calls = { count: 0 };
  const adapter: QuotaAdapter = {
    ...QUOTA_ADAPTERS.claude,
    fetchQuota: async () => {
      calls.count += 1;
      return data;
    },
  };
  return { adapter, calls };
};

const claudeState = () =>
  useQuotaStore.getState().claudeQuota[cacheKey] as ClaudeQuotaState | undefined;

beforeEach(() => {
  useQuotaStore.getState().clearQuotaCache();
});

describe('AuthFileQuotaSection wiring', () => {
  const source = readFileSync('src/features/authFiles/components/AuthFileQuotaSection.tsx', 'utf8');

  test('refreshes through the shared actions and restores from the session cache', () => {
    expect(source).toContain('useQuotaActions(disableControls)');
    expect(source).toContain('restoreQuotaFromSession([{ type: quotaType, file }])');
    expect(source).toContain('<QuotaUpdatedHint');
    expect(source).not.toContain('.fetchQuota(');
  });
});

describe('Auth Files refresh shares requests with other callers', () => {
  test('joins a fetch the dashboard or Quota page already has in flight', async () => {
    let release!: (value: typeof data) => void;
    let dashboardCalls = 0;
    const dashboard = fetchQuotaShared('claude', file, () => {
      dashboardCalls += 1;
      return new Promise<typeof data>((resolve) => {
        release = resolve;
      });
    });
    const { adapter, calls } = countingAdapter();
    const notices: string[] = [];

    const refresh = refreshQuotaEntry(file, adapter, t, (_message, type) => notices.push(type));
    expect(claudeState()?.status).toBe('loading');
    expect(inFlightQuotaCount()).toBe(1);

    await Promise.resolve();
    release(data);
    const shared = await dashboard;
    await refresh;

    expect(dashboardCalls).toBe(1);
    expect(calls.count).toBe(0);
    expect(claudeState()?.status).toBe('success');
    expect(claudeState()?.fetchedAtMs).toBe(shared.fetchedAtMs);
    expect(notices).toEqual(['success']);
    expect(inFlightQuotaCount()).toBe(0);
  });

  test('an explicit refresh ignores the TTL and stamps the fetch time', async () => {
    useQuotaStore.getState().setClaudeQuota({
      [cacheKey]: { status: 'success', windows: [], fetchedAtMs: Date.now() - 1_000 },
    });
    const { adapter, calls } = countingAdapter();
    const before = Date.now();

    await refreshQuotaEntry(file, adapter, t, () => {});

    expect(calls.count).toBe(1);
    expect(claudeState()?.windows).toHaveLength(1);
    expect(claudeState()?.fetchedAtMs).toBeGreaterThanOrEqual(before);
  });

  test('does not start a second request while the credential is loading', async () => {
    useQuotaStore.getState().setClaudeQuota({ [cacheKey]: { status: 'loading', windows: [] } });
    const { adapter, calls } = countingAdapter();

    await refreshQuotaEntry(file, adapter, t, () => {});

    expect(calls.count).toBe(0);
    expect(inFlightQuotaCount()).toBe(0);
  });
});

describe('Auth Files mount restore respects the TTL', () => {
  // Persistence is keyed by the connected API base.
  const apiBase = 'http://127.0.0.1:8317';

  const persisted = (ageMs: number) => ({
    ...QUOTA_ADAPTERS.claude.buildSuccessState(data),
    fetchedAtMs: Date.now() - ageMs,
  });

  test('restores a result persisted inside the TTL without fetching', () => {
    const storage = new MemoryStorage();
    persistQuotaSuccess('claude', cacheKey, persisted(60_000), storage, apiBase);

    expect(restoreQuotaFromSession([{ type: 'claude', file }], { storage, apiBase })).toBe(1);
    expect(claudeState()?.status).toBe('success');
    expect(inFlightQuotaCount()).toBe(0);
  });

  test('ignores a result older than the TTL', () => {
    const storage = new MemoryStorage();
    persistQuotaSuccess(
      'claude',
      cacheKey,
      persisted(QUOTA_CACHE_TTL_MS + 1_000),
      storage,
      apiBase
    );
    expect(storage.length).toBe(1);

    expect(restoreQuotaFromSession([{ type: 'claude', file }], { storage, apiBase })).toBe(0);
    expect(claudeState()).toBeUndefined();
  });

  test('never overwrites a result already in the store', () => {
    const storage = new MemoryStorage();
    persistQuotaSuccess('claude', cacheKey, persisted(60_000), storage, apiBase);
    useQuotaStore.getState().setClaudeQuota({ [cacheKey]: { status: 'loading', windows: [] } });

    expect(restoreQuotaFromSession([{ type: 'claude', file }], { storage, apiBase })).toBe(0);
    expect(claudeState()?.status).toBe('loading');
  });
});
