/**
 * Which quota window to burn first, and which credential to burn first.
 */

import { describe, expect, test } from 'bun:test';
import {
  collectQuotaPriorityWindows,
  isLowQuota,
  pickPriorityWindow,
  priorityResetMs,
  rankByPriority,
  sortByInstant,
} from '@/features/quota/quotaPriority';
import type { QuotaProviderType } from '@/features/quota/providers/types';
import { DAY_MS, HOUR_MS } from '@/utils/time/durations';

const NOW = new Date(2026, 9, 4, 1).getTime();

/** The operator's real Claude Max shape: percent USED per window. */
const claudeQuota = {
  status: 'success',
  windows: [
    { id: 'five-hour', usedPercent: 2, resetAtMs: NOW + 4 * HOUR_MS },
    { id: 'seven-day', usedPercent: 95, resetAtMs: NOW + DAY_MS },
    { id: 'seven-day-fable', usedPercent: 8, resetAtMs: NOW + DAY_MS },
  ],
};

const codexQuota = {
  status: 'success',
  windows: [{ id: 'weekly', usedPercent: 9, resetAtMs: NOW + 5 * DAY_MS }],
  // Reset credits are not quota windows and never win.
  rateLimitResetCredits: [
    { id: 'credit-1', status: 'available', expiresAt: new Date(NOW + HOUR_MS).toISOString() },
  ],
};

describe('collectQuotaPriorityWindows', () => {
  test('converts Claude and Codex percent used into percent remaining', () => {
    expect(collectQuotaPriorityWindows('claude', claudeQuota)).toEqual([
      { rowId: 'five-hour', remainingPercent: 98, resetAtMs: NOW + 4 * HOUR_MS },
      { rowId: 'seven-day', remainingPercent: 5, resetAtMs: NOW + DAY_MS },
      { rowId: 'seven-day-fable', remainingPercent: 92, resetAtMs: NOW + DAY_MS },
    ]);
    expect(collectQuotaPriorityWindows('codex', codexQuota)).toEqual([
      { rowId: 'weekly', remainingPercent: 91, resetAtMs: NOW + 5 * DAY_MS },
    ]);
  });

  test('reads each provider on its own terms', () => {
    expect(
      collectQuotaPriorityWindows('antigravity', {
        status: 'success',
        groups: [{ buckets: [{ id: 'b', remainingFraction: 0.25, resetAtMs: NOW + HOUR_MS }] }],
      })
    ).toEqual([{ rowId: 'b', remainingPercent: 25, resetAtMs: NOW + HOUR_MS }]);
    expect(
      collectQuotaPriorityWindows('kimi', {
        status: 'success',
        rows: [{ id: 'r', used: 30, limit: 40, resetAtMs: NOW + HOUR_MS }],
      })
    ).toEqual([{ rowId: 'r', remainingPercent: 25, resetAtMs: NOW + HOUR_MS }]);
    expect(
      collectQuotaPriorityWindows('meta', {
        status: 'success',
        data: { windows: [{ id: 'weekly', usedPercent: 40, resetAt: NOW / 1000 + 60 }] },
      })
    ).toEqual([{ rowId: 'weekly', remainingPercent: 60, resetAtMs: NOW + 60_000 }]);
    expect(
      collectQuotaPriorityWindows('xai', {
        status: 'success',
        billing: { periodType: 'monthly', usagePercent: 10, resetAtMs: NOW + DAY_MS },
      })
    ).toEqual([]);
  });

  test('returns nothing until the quota has loaded', () => {
    expect(collectQuotaPriorityWindows('claude', undefined)).toEqual([]);
    expect(collectQuotaPriorityWindows('claude', { ...claudeQuota, status: 'loading' })).toEqual(
      []
    );
  });
});

describe('pickPriorityWindow', () => {
  test('picks the soonest reset that still has quota left', () => {
    const windows = collectQuotaPriorityWindows('claude', claudeQuota);
    expect(pickPriorityWindow(windows, NOW)?.rowId).toBe('five-hour');
  });

  test('skips exhausted windows even when they reset first', () => {
    const windows = [
      { rowId: 'exhausted', remainingPercent: 0, resetAtMs: NOW + HOUR_MS },
      { rowId: 'left', remainingPercent: 40, resetAtMs: NOW + DAY_MS },
    ];
    expect(pickPriorityWindow(windows, NOW)?.rowId).toBe('left');
  });

  test('skips windows with unknown remaining, missing reset, or a past reset', () => {
    const windows = [
      { rowId: 'unknown', remainingPercent: null, resetAtMs: NOW + HOUR_MS },
      { rowId: 'no-reset', remainingPercent: 80, resetAtMs: null },
      { rowId: 'past', remainingPercent: 80, resetAtMs: NOW - HOUR_MS },
    ];
    expect(pickPriorityWindow(windows, NOW)).toBeNull();
  });

  test('breaks equal reset instants on row id', () => {
    const windows = [
      { rowId: 'seven-day-fable', remainingPercent: 92, resetAtMs: NOW + DAY_MS },
      { rowId: 'seven-day', remainingPercent: 5, resetAtMs: NOW + DAY_MS },
    ];
    expect(pickPriorityWindow(windows, NOW)?.rowId).toBe('seven-day');
    expect(pickPriorityWindow([...windows].reverse(), NOW)?.rowId).toBe('seven-day');
  });
});

describe('isLowQuota', () => {
  test('warns at or below 10% left', () => {
    expect(isLowQuota(10)).toBe(true);
    expect(isLowQuota(0)).toBe(true);
    expect(isLowQuota(10.5)).toBe(false);
    expect(isLowQuota(null)).toBe(false);
  });
});

describe('rankByPriority', () => {
  type Item = { name: string; provider: QuotaProviderType; quota: unknown };
  const names = (items: Item[]) => items.map((item) => item.name);
  const read = (item: Item) => item;

  test('ranks mixed providers by the reset of their use-first window', () => {
    const items: Item[] = [
      { name: 'codex', provider: 'codex', quota: codexQuota },
      { name: 'claude', provider: 'claude', quota: claudeQuota },
      {
        name: 'kimi',
        provider: 'kimi',
        quota: {
          status: 'success',
          rows: [{ id: 'r', used: 10, limit: 100, resetAtMs: NOW + 2 * DAY_MS }],
        },
      },
    ];
    expect(names(rankByPriority(items, read, NOW))).toEqual(['claude', 'kimi', 'codex']);
  });

  test('sends fully exhausted, unloaded, and reset-less credentials last in incoming order', () => {
    const items: Item[] = [
      { name: 'unloaded', provider: 'claude', quota: undefined },
      {
        name: 'exhausted',
        provider: 'codex',
        quota: {
          status: 'success',
          windows: [{ id: 'weekly', usedPercent: 100, resetAtMs: NOW + HOUR_MS }],
        },
      },
      {
        name: 'no-reset',
        provider: 'codex',
        quota: { status: 'success', windows: [{ id: 'weekly', usedPercent: 10 }] },
      },
      { name: 'codex', provider: 'codex', quota: codexQuota },
    ];
    expect(names(rankByPriority(items, read, NOW))).toEqual([
      'codex',
      'unloaded',
      'exhausted',
      'no-reset',
    ]);
  });

  test('keeps incoming order for credentials that tie', () => {
    const items: Item[] = [
      { name: 'b', provider: 'codex', quota: codexQuota },
      { name: 'a', provider: 'codex', quota: codexQuota },
    ];
    expect(names(rankByPriority(items, read, NOW))).toEqual(['b', 'a']);
  });

  test('priorityResetMs is the sort key rankByPriority uses', () => {
    expect(priorityResetMs('claude', claudeQuota, NOW)).toBe(NOW + 4 * HOUR_MS);
    expect(priorityResetMs('claude', claudeQuota, NOW + 5 * HOUR_MS)).toBe(NOW + DAY_MS);
  });
});

describe('sortByInstant', () => {
  test('does not mutate the input', () => {
    const input = [3, 1, 2];
    expect(sortByInstant(input, (n) => n)).toEqual([1, 2, 3]);
    expect(input).toEqual([3, 1, 2]);
  });
});
