import type { TFunction } from 'i18next';
import type { AuthFileItem } from '@/types';
import {
  captureQuotaCacheGeneration,
  commitIfQuotaCacheCurrent,
  useQuotaStore,
} from '@/stores/useQuotaStore';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import type { QuotaAdapter, QuotaCardState, QuotaMapUpdater } from './providers';
import { persistQuotaSuccess } from './quotaCache';

/** Optional metadata must neither delay quota rendering nor replace a newer result. */
export async function enrichQuotaInBackground(
  adapter: QuotaAdapter,
  file: AuthFileItem,
  data: unknown,
  expectedState: QuotaCardState,
  t: TFunction
): Promise<void> {
  if (!adapter.enrichQuota) return;
  const cacheKey = getQuotaCacheKey(file);
  const currentState = () => adapter.storeSelector(useQuotaStore.getState())[cacheKey];
  if (currentState() !== expectedState) return;
  const generation = captureQuotaCacheGeneration(file.name);

  try {
    const enriched = await adapter.enrichQuota(file, data, t);
    if (enriched === data) return;
    commitIfQuotaCacheCurrent(generation, () => {
      const setQuota = useQuotaStore.getState()[adapter.storeSetter] as QuotaMapUpdater;
      const enrichedState: QuotaCardState = {
        ...adapter.buildSuccessState(enriched),
        fetchedAtMs: expectedState.fetchedAtMs,
      };
      let replaced = false;
      setQuota((prev) => {
        if (prev[cacheKey] !== expectedState) return prev;
        replaced = true;
        return { ...prev, [cacheKey]: enrichedState };
      });
      if (replaced) persistQuotaSuccess(adapter.type, cacheKey, enrichedState);
    });
  } catch {
    // Keep the successful quota and its original plan fallback on optional failures.
  }
}
