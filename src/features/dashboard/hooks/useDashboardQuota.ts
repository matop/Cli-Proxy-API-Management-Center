import { useCallback, useEffect, useMemo } from 'react';
import { useQuotaStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import { classifyQuotaFiles, resolveQuotaProviderType } from '@/features/quota/logic';
import type { QuotaCardState } from '@/features/quota/providers';
import type { QuotaProviderType } from '@/features/quota/providers/types';
import {
  restoreQuotaFromSession,
  useQuotaBatchLoader,
} from '@/features/quota/hooks/useQuotaBatchLoader';

export interface DashboardAccount {
  /** Stable React key. */
  key: string;
  file: AuthFileItem;
  /** Null when the credential's provider has no quota adapter. */
  provider: QuotaProviderType | null;
  quota: QuotaCardState | undefined;
}

/**
 * Quota for every credential on the dashboard, read from the shared
 * useQuotaStore cache that the Quota page also reads and writes.
 *
 * Nothing is fetched automatically. Opening the dashboard restores results
 * persisted in this tab; refreshQuota fetches every account through the Quota
 * page's batch loader, which shares any request already in flight.
 */
export function useDashboardQuota(files: AuthFileItem[] | null, enabled: boolean) {
  const antigravityQuota = useQuotaStore((state) => state.antigravityQuota);
  const claudeQuota = useQuotaStore((state) => state.claudeQuota);
  const codexQuota = useQuotaStore((state) => state.codexQuota);
  const devinQuota = useQuotaStore((state) => state.devinQuota);
  const kimiQuota = useQuotaStore((state) => state.kimiQuota);
  const metaQuota = useQuotaStore((state) => state.metaQuota);
  const xaiQuota = useQuotaStore((state) => state.xaiQuota);

  const { batchLoading, loadQuota } = useQuotaBatchLoader();

  // classifyQuotaFiles drops disabled files and files without a quota adapter.
  const quotaEntries = useMemo(() => (files ? classifyQuotaFiles(files) : []), [files]);

  // Opening the dashboard never fetches: it only restores results persisted
  // earlier in this tab, like the Quota page. Fetching is the explicit refresh.
  useEffect(() => {
    if (!enabled || quotaEntries.length === 0) return;
    restoreQuotaFromSession(quotaEntries);
  }, [enabled, quotaEntries]);

  const refreshQuota = useCallback(
    () => (enabled && quotaEntries.length > 0 ? loadQuota(quotaEntries, { force: true }) : undefined),
    [enabled, quotaEntries, loadQuota]
  );

  const accounts = useMemo<DashboardAccount[]>(() => {
    const maps: Record<QuotaProviderType, Record<string, QuotaCardState>> = {
      antigravity: antigravityQuota,
      claude: claudeQuota,
      codex: codexQuota,
      devin: devinQuota,
      kimi: kimiQuota,
      meta: metaQuota,
      xai: xaiQuota,
    } as unknown as Record<QuotaProviderType, Record<string, QuotaCardState>>;

    return (files ?? []).map((file) => {
      const provider = resolveQuotaProviderType(file);
      const cacheKey = getQuotaCacheKey(file);
      return {
        key: `${provider ?? file.type ?? 'unknown'}:${cacheKey}`,
        file,
        provider,
        quota: provider ? maps[provider][cacheKey] : undefined,
      };
    });
  }, [
    files,
    antigravityQuota,
    claudeQuota,
    codexQuota,
    devinQuota,
    kimiQuota,
    metaQuota,
    xaiQuota,
  ]);

  return { accounts, refreshQuota, refreshingQuota: batchLoading };
}
