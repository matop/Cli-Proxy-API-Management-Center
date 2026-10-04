import type { ProviderRecentRequests } from '@/components/providers/hooks/useProviderRecentRequests';
import {
  mergeRecentRequestBucketGroups,
  normalizeRecentRequestUsageEntry,
  type RecentRequestBucket,
} from '@/utils/recentRequests';
import type { AuthFileItem } from '@/types/authFile';
import { TRAFFIC_BUCKET_MINUTES, type ProviderTraffic, type TrafficWindow } from './types';

const EMPTY_TRAFFIC: TrafficWindow = {
  buckets: [],
  totalSuccess: 0,
  totalFailure: 0,
  total: 0,
  successRate: null,
  peakTotal: 0,
  peakIndex: -1,
  windowMinutes: 0,
};

/** `api-key-usage` 的键形如 `<baseUrl>|<apiKey>`，取第一个分隔符之后的部分 */
const apiKeyFromCompositeKey = (compositeKey: string): string => {
  const separatorIndex = compositeKey.indexOf('|');
  return separatorIndex < 0 ? '' : compositeKey.slice(separatorIndex + 1).trim();
};

export const providerIdOfAuthFile = (file: AuthFileItem): string => {
  const candidate = String(file.type ?? file.provider ?? '')
    .trim()
    .toLowerCase();
  return candidate && candidate !== 'empty' ? candidate : 'unknown';
};

const buildTrafficWindow = (bucketGroups: RecentRequestBucket[][]): TrafficWindow => {
  const buckets = mergeRecentRequestBucketGroups(bucketGroups);
  if (buckets.length === 0) {
    return EMPTY_TRAFFIC;
  }

  let totalSuccess = 0;
  let totalFailure = 0;
  let peakTotal = 0;
  let peakIndex = -1;

  buckets.forEach((bucket, index) => {
    const bucketTotal = bucket.success + bucket.failed;
    totalSuccess += bucket.success;
    totalFailure += bucket.failed;
    if (bucketTotal > peakTotal) {
      peakTotal = bucketTotal;
      peakIndex = index;
    }
  });

  const total = totalSuccess + totalFailure;

  return {
    buckets,
    totalSuccess,
    totalFailure,
    total,
    successRate: total > 0 ? (totalSuccess / total) * 100 : null,
    peakTotal,
    peakIndex,
    windowMinutes: buckets.length * TRAFFIC_BUCKET_MINUTES,
  };
};

interface ProviderAccumulator {
  credentials: number;
  bucketGroups: RecentRequestBucket[][];
}

const createAccumulator = (): ProviderAccumulator => ({
  credentials: 0,
  bucketGroups: [],
});

/**
 * 汇总整体流量窗口与按供应商的流量切片。两者都只读 `recent_requests` 桶
 * （后端 20 × 10 分钟），不读累计的 success/failed 计数。
 *
 * 流量数据有两个互不重叠的来源：`api-key-usage`（配置内联的 API Key 凭证）
 * 与 `auth-files`（文件/运行时凭证）。后端对二者的判定条件互斥，但插件提供的
 * 凭证理论上可同时命中，因此这里按 `account_type` + `account` 做一次防御性去重。
 */
export function aggregateDashboardTraffic(
  usageByProvider: ProviderRecentRequests,
  authFiles: AuthFileItem[] | null
): { traffic: TrafficWindow; providers: ProviderTraffic[] } {
  const accumulators = new Map<string, ProviderAccumulator>();
  const allBucketGroups: RecentRequestBucket[][] = [];
  const apiKeysFromUsage = new Set<string>();

  const accumulatorFor = (providerId: string): ProviderAccumulator => {
    const existing = accumulators.get(providerId);
    if (existing) return existing;
    const created = createAccumulator();
    accumulators.set(providerId, created);
    return created;
  };

  usageByProvider.forEach((entriesByKey, providerId) => {
    const accumulator = accumulatorFor(providerId);
    entriesByKey.forEach((entry, compositeKey) => {
      const apiKey = apiKeyFromCompositeKey(compositeKey);
      if (apiKey) {
        apiKeysFromUsage.add(apiKey);
      }
      accumulator.credentials += 1;
      if (entry.recentRequests.length > 0) {
        accumulator.bucketGroups.push(entry.recentRequests);
        allBucketGroups.push(entry.recentRequests);
      }
    });
  });

  (authFiles ?? []).forEach((file) => {
    const accountType = String(file.account_type ?? '')
      .trim()
      .toLowerCase();
    const account = String(file.account ?? '').trim();
    // 已经由 api-key-usage 统计过的凭证不再重复计入
    if (accountType === 'api_key' && account && apiKeysFromUsage.has(account)) {
      return;
    }

    const accumulator = accumulatorFor(providerIdOfAuthFile(file));
    const entry = normalizeRecentRequestUsageEntry(file);
    accumulator.credentials += 1;
    if (entry.recentRequests.length > 0) {
      accumulator.bucketGroups.push(entry.recentRequests);
      allBucketGroups.push(entry.recentRequests);
    }
  });

  const providerRows: ProviderTraffic[] = Array.from(accumulators.entries())
    .map(([id, accumulator]) => {
      // Same 10-minute buckets as the chart, not the lifetime success/failed
      // counters, so the rows describe the window the section claims.
      const window = buildTrafficWindow(accumulator.bucketGroups);
      return {
        id,
        credentials: accumulator.credentials,
        success: window.totalSuccess,
        failure: window.totalFailure,
        total: window.total,
        successRate: window.successRate,
        buckets: window.buckets,
      };
    })
    .sort((a, b) => b.total - a.total || b.credentials - a.credentials || a.id.localeCompare(b.id));

  return {
    traffic: buildTrafficWindow(allBucketGroups),
    providers: providerRows,
  };
}
