/**
 * 混合提供商批量额度加载（原 useQuotaLoader 的跨分区泛化）。
 *
 * 保留的三道守卫与旧实现逐一对应：
 * - loadingRef：并发批量加载去重；
 * - requestIdRef：被超越的响应直接丢弃；
 * - cacheGeneration：断线重连后过期请求不得写入新会话缓存。
 * 提交按 provider 分组进行 —— 快的提供商先落地，不等慢的。
 *
 * Cache (quotaCache.ts): an automatic load first restores fresh results from
 * sessionStorage and skips credentials whose result is younger than the TTL.
 * `{ force: true }` (Refresh all) skips both checks. Every fetch goes through
 * fetchQuotaShared, so it joins an identical request already in flight from
 * the dashboard, the Quota page, or a single-card refresh.
 */

import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { captureQuotaCacheGeneration, commitIfQuotaCacheCurrent } from '@/stores';
import { getStatusFromError } from '@/utils/quota';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import type { QuotaFileEntry } from '../logic';
import { QUOTA_ADAPTERS, getQuotaMap, getQuotaSetter, type QuotaCardState } from '../providers';
import type { QuotaProviderType } from '../providers/types';
import type { QuotaCacheStorage } from '@/services/storage/quotaCacheStorage';
import {
  fetchQuotaShared,
  persistQuotaSuccess,
  restorePersistedQuota,
  selectQuotaLoadTargets,
} from '../quotaCache';

interface BatchFetchResult {
  name: string;
  cacheKey: string;
  status: 'success' | 'error';
  data?: unknown;
  fetchedAtMs?: number;
  error?: string;
  errorStatus?: number;
}

export interface LoadQuotaOptions {
  /** Explicit user action: ignore the TTL and the persisted copy. In-flight requests are still shared. */
  force?: boolean;
}

/**
 * Restore persisted, still-fresh quota into the store for targets with nothing
 * loaded. No network. Returns how many were restored. Storage and API base
 * default to sessionStorage and the connected base; tests pass their own.
 */
export function restoreQuotaFromSession(
  targets: readonly QuotaFileEntry[],
  source: { storage?: QuotaCacheStorage | null; apiBase?: string } = {}
): number {
  return restorePersistedQuota(
    targets,
    (type, cacheKey) => getQuotaMap(QUOTA_ADAPTERS[type])[cacheKey],
    (type, cacheKey, state) =>
      getQuotaSetter(QUOTA_ADAPTERS[type])((prev) => ({
        ...prev,
        [cacheKey]: state as unknown as QuotaCardState,
      })),
    Date.now(),
    source.storage,
    source.apiBase
  );
}

export function useQuotaBatchLoader() {
  const { t } = useTranslation();
  const [batchLoading, setBatchLoading] = useState(false);
  const loadingRef = useRef(false);
  const requestIdRef = useRef(0);

  const loadQuota = useCallback(
    async (requested: QuotaFileEntry[], options?: LoadQuotaOptions) => {
      if (loadingRef.current) return;
      const force = Boolean(options?.force);
      if (!force) restoreQuotaFromSession(requested);
      const targets = selectQuotaLoadTargets(
        requested,
        (type, cacheKey) => getQuotaMap(QUOTA_ADAPTERS[type])[cacheKey],
        Date.now(),
        force
      );
      if (targets.length === 0) return;
      loadingRef.current = true;
      const requestId = ++requestIdRef.current;
      const cacheGeneration = captureQuotaCacheGeneration();
      setBatchLoading(true);

      try {
        const groups = new Map<QuotaProviderType, QuotaFileEntry[]>();
        targets.forEach((entry) => {
          const group = groups.get(entry.type) ?? [];
          group.push(entry);
          groups.set(entry.type, group);
        });

        await Promise.all(
          Array.from(groups.entries()).map(async ([type, entries]) => {
            const adapter = QUOTA_ADAPTERS[type];
            const setQuota = getQuotaSetter(adapter);

            commitIfQuotaCacheCurrent(cacheGeneration, () => {
              setQuota((prev) => {
                const nextState = { ...prev };
                entries.forEach(({ file }) => {
                  nextState[getQuotaCacheKey(file)] = adapter.buildLoadingState();
                });
                return nextState;
              });
            });

            const results = await Promise.all(
              entries.map(async ({ file }): Promise<BatchFetchResult> => {
                const cacheKey = getQuotaCacheKey(file);
                try {
                  const { data, fetchedAtMs } = await fetchQuotaShared(type, file, () =>
                    adapter.fetchQuota(file, t)
                  );
                  return { name: file.name, cacheKey, status: 'success', data, fetchedAtMs };
                } catch (err: unknown) {
                  const message = err instanceof Error ? err.message : t('common.unknown_error');
                  return {
                    name: file.name,
                    cacheKey,
                    status: 'error',
                    error: message,
                    errorStatus: getStatusFromError(err),
                  };
                }
              })
            );

            if (requestId !== requestIdRef.current) return;

            const committed: { cacheKey: string; state: QuotaCardState }[] = [];
            setQuota((prev) => {
              const nextState = { ...prev };
              results.forEach((result) => {
                commitIfQuotaCacheCurrent(
                  cacheGeneration,
                  () => {
                    const state =
                      result.status === 'success'
                        ? {
                            ...adapter.buildSuccessState(result.data),
                            fetchedAtMs: result.fetchedAtMs,
                          }
                        : adapter.buildErrorState(
                            result.error || t('common.unknown_error'),
                            result.errorStatus
                          );
                    nextState[result.cacheKey] = state;
                    committed.push({ cacheKey: result.cacheKey, state });
                  },
                  result.name
                );
              });
              return nextState;
            });
            committed.forEach(({ cacheKey, state }) => persistQuotaSuccess(type, cacheKey, state));
          })
        );
      } finally {
        if (requestId === requestIdRef.current) {
          setBatchLoading(false);
          loadingRef.current = false;
        }
      }
    },
    [t]
  );

  return { batchLoading, loadQuota };
}
