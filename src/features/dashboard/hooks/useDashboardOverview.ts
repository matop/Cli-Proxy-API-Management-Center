import { useCallback, useEffect, useMemo, useState } from 'react';
import { authFilesApi } from '@/services/api';
import { useAuthStore, useConfigStore, useModelsStore } from '@/stores';
import { useApiKeysForModels } from '@/hooks/useApiKeysForModels';
import { useProviderRecentRequests } from '@/components/providers/hooks/useProviderRecentRequests';
import { getErrorMessage } from '@/utils/helpers';
import type { Config } from '@/types';
import type { AuthFileItem } from '@/types/authFile';
import type { CredentialHealth, DashboardCounts } from '../types';
import { aggregateDashboardTraffic, providerIdOfAuthFile } from '../traffic';

export const getProviderKeyCounts = (config: Config) => ({
  gemini: config.geminiApiKeys?.length ?? 0,
  interactions: config.interactionsApiKeys?.length ?? 0,
  codex: config.codexApiKeys?.length ?? 0,
  meta: config.metaApiKeys?.length ?? 0,
  xai: config.xaiApiKeys?.length ?? 0,
  claude: config.claudeApiKeys?.length ?? 0,
  vertex: config.vertexApiKeys?.length ?? 0,
  openai: config.openaiCompatibility?.length ?? 0,
});

/**
 * 汇总仪表盘所需的全部数据。流量聚合见 ../traffic.ts。
 */
export function useDashboardOverview() {
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const apiBase = useAuthStore((state) => state.apiBase);
  const config = useConfigStore((state) => state.config);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);

  const models = useModelsStore((state) => state.models);
  const modelsLoading = useModelsStore((state) => state.loading);
  const modelsError = useModelsStore((state) => state.error);
  const fetchModelsFromStore = useModelsStore((state) => state.fetchModels);

  const connected = connectionStatus === 'connected';
  const resolveApiKeysForModels = useApiKeysForModels();

  const { usageByProvider, refreshRecentRequests } = useProviderRecentRequests({
    enabled: connected,
  });

  const [authFiles, setAuthFiles] = useState<AuthFileItem[] | null>(null);
  // Null while loading or after success. Without it a failed load leaves
  // authFiles null, which the Accounts panel reads as still loading.
  const [authFilesError, setAuthFilesError] = useState<string | null>(null);

  const loadAuthFiles = useCallback(async () => {
    if (!connected) return;
    try {
      const response = await authFilesApi.list();
      setAuthFiles(response.files);
      setAuthFilesError(null);
    } catch (error) {
      setAuthFiles(null);
      setAuthFilesError(getErrorMessage(error));
    }
  }, [connected]);

  const loadModels = useCallback(async () => {
    if (!connected || !apiBase) return;
    try {
      const apiKeys = await resolveApiKeysForModels();
      await fetchModelsFromStore(apiBase, apiKeys[0]);
    } catch {
      // 模型列表失败不应影响仪表盘其余部分
    }
  }, [connected, apiBase, resolveApiKeysForModels, fetchModelsFromStore]);

  useEffect(() => {
    if (!connected) return;
    void fetchConfig().catch(() => undefined);
    void loadAuthFiles();
    void loadModels();
  }, [connected, fetchConfig, loadAuthFiles, loadModels]);

  const refresh = useCallback(async () => {
    if (!connected) return;
    await Promise.allSettled([
      fetchConfig(true),
      loadAuthFiles(),
      loadModels(),
      refreshRecentRequests(),
    ]);
  }, [connected, fetchConfig, loadAuthFiles, loadModels, refreshRecentRequests]);

  const providerKeyCounts = useMemo(() => (config ? getProviderKeyCounts(config) : null), [config]);

  const { traffic, providers } = useMemo(
    () => aggregateDashboardTraffic(usageByProvider, authFiles),
    [usageByProvider, authFiles]
  );

  const credentials = useMemo<CredentialHealth | null>(() => {
    if (!authFiles) return null;

    let disabled = 0;
    let unavailable = 0;
    const countsByType = new Map<string, number>();

    authFiles.forEach((file) => {
      if (file.disabled) {
        disabled += 1;
      } else if (file.unavailable) {
        unavailable += 1;
      }
      const type = providerIdOfAuthFile(file);
      countsByType.set(type, (countsByType.get(type) ?? 0) + 1);
    });

    return {
      total: authFiles.length,
      active: authFiles.length - disabled - unavailable,
      disabled,
      unavailable,
      byType: Array.from(countsByType.entries())
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
    };
  }, [authFiles]);

  const counts = useMemo<DashboardCounts>(
    () => ({
      managementKeys: config ? (config.apiKeys?.length ?? 0) : null,
      providerKeys: providerKeyCounts
        ? Object.values(providerKeyCounts).reduce((sum, count) => sum + count, 0)
        : null,
      credentials: authFiles ? authFiles.length : null,
      models: modelsLoading || modelsError ? null : models.length,
    }),
    [config, providerKeyCounts, authFiles, models.length, modelsLoading, modelsError]
  );

  return {
    connectionStatus,
    connected,
    config,
    counts,
    providerKeyCounts,
    traffic,
    providers,
    credentials,
    authFiles,
    authFilesError,
    refresh,
  };
}
