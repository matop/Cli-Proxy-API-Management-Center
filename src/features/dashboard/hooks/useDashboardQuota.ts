import { useEffect, useMemo } from 'react';
import { useQuotaStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import { classifyQuotaFiles, resolveQuotaProviderType } from '@/features/quota/logic';
import { QUOTA_ADAPTERS, type QuotaCardState } from '@/features/quota/providers';
import type { QuotaProviderType, QuotaStore } from '@/features/quota/providers/types';
import { useQuotaBatchLoader } from '@/features/quota/hooks/useQuotaBatchLoader';

export interface DashboardAccount {
  /** Stable React key. */
  key: string;
  file: AuthFileItem;
  /** Null when the credential's provider has no quota adapter. */
  provider: QuotaProviderType | null;
  quota: QuotaCardState | undefined;
}

const cachedStateFor = (provider: QuotaProviderType, file: AuthFileItem) =>
  QUOTA_ADAPTERS[provider].storeSelector(useQuotaStore.getState() as unknown as QuotaStore)[
    getQuotaCacheKey(file)
  ];

/**
 * Quota for every credential on the dashboard, read from the shared
 * useQuotaStore cache that the Quota page also reads and writes.
 *
 * Only credentials with no cached state are fetched, through the Quota page's
 * own batch loader, so each credential costs at most one upstream /api-call
 * per session no matter how often the dashboard or the Quota page mounts.
 * Refreshing an account's quota stays an explicit action on /quota.
 */
export function useDashboardQuota(files: AuthFileItem[] | null, enabled: boolean) {
  const antigravityQuota = useQuotaStore((state) => state.antigravityQuota);
  const claudeQuota = useQuotaStore((state) => state.claudeQuota);
  const codexQuota = useQuotaStore((state) => state.codexQuota);
  const devinQuota = useQuotaStore((state) => state.devinQuota);
  const kimiQuota = useQuotaStore((state) => state.kimiQuota);
  const metaQuota = useQuotaStore((state) => state.metaQuota);
  const xaiQuota = useQuotaStore((state) => state.xaiQuota);

  const { loadQuota } = useQuotaBatchLoader();

  // classifyQuotaFiles drops disabled files and files without a quota adapter.
  const quotaEntries = useMemo(() => (files ? classifyQuotaFiles(files) : []), [files]);

  useEffect(() => {
    if (!enabled || quotaEntries.length === 0) return;
    // Read the store at effect time, not from render: a batch started by the
    // Quota page or an earlier mount has already written 'loading' states.
    const missing = quotaEntries.filter((entry) => {
      const cached = cachedStateFor(entry.type, entry.file);
      return !cached || cached.status === 'idle';
    });
    if (missing.length > 0) void loadQuota(missing);
  }, [enabled, quotaEntries, loadQuota]);

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

  return { accounts };
}
