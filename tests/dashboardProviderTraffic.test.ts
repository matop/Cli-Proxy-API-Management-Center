import { describe, expect, test } from 'bun:test';
import { aggregateDashboardTraffic } from '../src/features/dashboard/traffic';
import type { RecentRequestUsageEntry } from '../src/utils/recentRequests';
import type { AuthFileItem } from '../src/types/authFile';

const buckets = (pairs: Array<[number, number]>) =>
  pairs.map(([success, failed]) => ({ success, failed }));

describe('aggregateDashboardTraffic', () => {
  test('provider volume and success rate come from the same buckets as the chart', () => {
    // Lifetime counters (success/failed) are far larger than the recent window.
    const authFiles = [
      {
        name: 'claude-a.json',
        type: 'claude',
        success: 5000,
        failed: 1000,
        recent_requests: buckets([
          [3, 1],
          [4, 0],
        ]),
      },
      {
        name: 'claude-b.json',
        type: 'claude',
        success: 700,
        failed: 0,
        recent_requests: buckets([
          [0, 0],
          [2, 0],
        ]),
      },
    ] as unknown as AuthFileItem[];

    const { traffic, providers } = aggregateDashboardTraffic(new Map(), authFiles);

    expect(traffic.total).toBe(10);
    expect(providers).toHaveLength(1);
    const claude = providers[0];
    expect(claude.credentials).toBe(2);
    expect(claude.success).toBe(9);
    expect(claude.failure).toBe(1);
    expect(claude.total).toBe(10);
    expect(claude.successRate).toBe(90);
  });

  test('provider totals sum to the chart total across both sources', () => {
    const usage = new Map<string, Map<string, RecentRequestUsageEntry>>([
      [
        'gemini',
        new Map([
          [
            'https://example.invalid|key-1',
            { success: 900, failed: 90, recentRequests: buckets([[1, 2]]) },
          ],
        ]),
      ],
    ]);
    const authFiles = [
      { name: 'codex.json', type: 'codex', success: 50, failed: 5, recent_requests: [] },
    ] as unknown as AuthFileItem[];

    const { traffic, providers } = aggregateDashboardTraffic(usage, authFiles);
    const sum = providers.reduce((total, provider) => total + provider.total, 0);

    expect(sum).toBe(traffic.total);
    const codex = providers.find((provider) => provider.id === 'codex');
    expect(codex?.credentials).toBe(1);
    expect(codex?.total).toBe(0);
    expect(codex?.successRate).toBeNull();
  });
});
