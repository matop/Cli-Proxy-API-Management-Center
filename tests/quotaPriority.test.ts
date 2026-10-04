/**
 * Which credential to burn first, decided by its binding window.
 */

import { describe, expect, test } from 'bun:test';
import {
  assessQuotaUsability,
  collectQuotaPriorityWindows,
  isLowQuota,
  pickPriorityWindow,
  priorityResetMs,
  rankByPriority,
  sortByInstant,
  type QuotaPriorityWindow,
} from '@/features/quota/quotaPriority';
import type { QuotaProviderType } from '@/features/quota/providers/types';
import { DAY_MS, HOUR_MS } from '@/utils/time/durations';

const NOW = new Date(2026, 9, 4, 1).getTime();

/** The operator's real Claude Max shape: percent USED per window. */
const claudeQuota = {
  status: 'success',
  windows: [
    { id: 'five-hour', usedPercent: 6, resetAtMs: NOW + 4 * HOUR_MS },
    { id: 'seven-day', usedPercent: 96, resetAtMs: NOW + DAY_MS },
    { id: 'seven-day-fable', usedPercent: 8, resetAtMs: NOW + 3 * DAY_MS },
  ],
};

/** The operator's real Codex shape: weekly window only. */
const codexQuota = {
  status: 'success',
  windows: [{ id: 'weekly', usedPercent: 9, resetAtMs: NOW + 5 * DAY_MS }],
  // Reset credits are not quota windows and never win.
  rateLimitResetCredits: [
    { id: 'credit-1', status: 'available', expiresAt: new Date(NOW + HOUR_MS).toISOString() },
  ],
};

const win = (
  rowId: string,
  remainingPercent: number | null,
  resetInMs: number | null,
  extra: Partial<QuotaPriorityWindow> = {}
): QuotaPriorityWindow => ({
  rowId,
  remainingPercent,
  resetAtMs: resetInMs === null ? null : NOW + resetInMs,
  scope: 'account',
  rankable: true,
  ...extra,
});

type Item = { name: string; provider: QuotaProviderType | null; quota: unknown };
const read = (item: Item) => item;
const names = (ranked: { item: Item }[]) => ranked.map((entry) => entry.item.name);

describe('collectQuotaPriorityWindows', () => {
  test('converts percent used into percent remaining and tags scope', () => {
    expect(
      collectQuotaPriorityWindows('claude', claudeQuota).map((w) => [
        w.rowId,
        w.remainingPercent,
        w.scope,
      ])
    ).toEqual([
      ['five-hour', 94, 'account'],
      ['seven-day', 4, 'account'],
      ['seven-day-fable', 92, 'scoped'],
    ]);
    expect(collectQuotaPriorityWindows('codex', codexQuota)).toMatchObject([
      { rowId: 'weekly', remainingPercent: 91, resetAtMs: NOW + 5 * DAY_MS, scope: 'account' },
    ]);
  });

  test('treats per-model and per-surface Claude and Codex rows as scoped', () => {
    const claude = collectQuotaPriorityWindows('claude', {
      status: 'success',
      windows: [
        'seven-day-opus',
        'seven-day-sonnet',
        'seven-day-oauth-apps',
        'seven-day-cowork',
      ].map((id) => ({ id, usedPercent: 10, resetAtMs: NOW + DAY_MS })),
    });
    expect(claude.every((w) => w.scope === 'scoped')).toBe(true);

    const codex = collectQuotaPriorityWindows('codex', {
      status: 'success',
      windows: [
        { id: 'five-hour', usedPercent: 10, resetAtMs: NOW + HOUR_MS },
        { id: 'monthly', usedPercent: 10, resetAtMs: NOW + DAY_MS },
        { id: 'code-review-weekly', usedPercent: 10, resetAtMs: NOW + DAY_MS },
        { id: 'gpt-5-3-codex-spark-weekly-0', usedPercent: 10, resetAtMs: NOW + DAY_MS },
      ],
    });
    expect(codex.map((w) => w.scope)).toEqual(['account', 'account', 'scoped', 'scoped']);
  });

  test('reads each provider on its own terms', () => {
    expect(
      collectQuotaPriorityWindows('antigravity', {
        status: 'success',
        groups: [{ buckets: [{ id: 'b', remainingFraction: 0.25, resetAtMs: NOW + HOUR_MS }] }],
      })
    ).toMatchObject([{ rowId: 'b', remainingPercent: 25, scope: 'scoped' }]);
    expect(
      collectQuotaPriorityWindows('kimi', {
        status: 'success',
        rows: [{ id: 'r', used: 30, limit: 40, resetAtMs: NOW + HOUR_MS }],
      })
    ).toMatchObject([{ rowId: 'r', remainingPercent: 25, scope: 'account' }]);
    expect(
      collectQuotaPriorityWindows('meta', {
        status: 'success',
        data: { windows: [{ id: 'weekly', usedPercent: 40, resetAt: NOW / 1000 + 60 }] },
      })
    ).toMatchObject([
      {
        rowId: 'weekly',
        remainingPercent: 60,
        resetAtMs: NOW + 60_000,
        labelKey: 'meta_quota.weekly',
      },
    ]);
    expect(
      collectQuotaPriorityWindows('xai', {
        status: 'success',
        billing: { periodType: 'monthly', usagePercent: 10, resetAtMs: NOW + DAY_MS },
      })
    ).toMatchObject([{ rowId: 'xai:monthly', scope: 'account', rankable: false }]);
  });

  test('returns nothing until the quota has loaded or without a provider', () => {
    expect(collectQuotaPriorityWindows('claude', undefined)).toEqual([]);
    expect(collectQuotaPriorityWindows('claude', { ...claudeQuota, status: 'loading' })).toEqual(
      []
    );
    expect(collectQuotaPriorityWindows(null, claudeQuota)).toEqual([]);
  });
});

describe('assessQuotaUsability', () => {
  test('binds on the lowest remaining account-wide window, not the soonest reset', () => {
    const windows = collectQuotaPriorityWindows('claude', claudeQuota);
    const usability = assessQuotaUsability(windows, NOW);
    expect(usability.kind).toBe('usable');
    expect(pickPriorityWindow(windows, NOW)).toMatchObject({
      rowId: 'seven-day',
      remainingPercent: 4,
      resetAtMs: NOW + DAY_MS,
    });
  });

  test('ignores model-scoped windows for binding and for blocking', () => {
    const scopedLowest = [
      win('seven-day', 40, DAY_MS),
      win('seven-day-fable', 2, HOUR_MS, { scope: 'scoped' }),
    ];
    expect(pickPriorityWindow(scopedLowest, NOW)?.rowId).toBe('seven-day');

    const scopedExhausted = [
      win('five-hour', 80, HOUR_MS),
      win('seven-day-fable', 0, DAY_MS, { scope: 'scoped' }),
    ];
    expect(assessQuotaUsability(scopedExhausted, NOW).kind).toBe('usable');

    expect(assessQuotaUsability([win('b', 50, HOUR_MS, { scope: 'scoped' })], NOW)).toEqual({
      kind: 'unknown',
    });
  });

  test('blocks an account with any account-wide window at 0% until it resets', () => {
    const blocked = assessQuotaUsability(
      [win('weekly', 0, DAY_MS), win('five-hour', 80, HOUR_MS)],
      NOW
    );
    expect(blocked).toMatchObject({ kind: 'blocked', window: { rowId: 'weekly' } });
    // Once the exhausted window's reset has passed its numbers are stale.
    expect(
      pickPriorityWindow([win('weekly', 0, -HOUR_MS), win('five-hour', 80, HOUR_MS)], NOW)?.rowId
    ).toBe('five-hour');
  });

  test('xAI monthly billing blocks at 0% but never binds', () => {
    const billing = win('xai:monthly', 3, DAY_MS, { rankable: false });
    expect(assessQuotaUsability([billing], NOW).kind).toBe('unknown');
    expect(pickPriorityWindow([billing, win('xai:weekly', 50, 2 * DAY_MS)], NOW)?.rowId).toBe(
      'xai:weekly'
    );
    expect(assessQuotaUsability([{ ...billing, remainingPercent: 0 }], NOW).kind).toBe('blocked');
  });

  test('skips unknown remaining, missing reset, and past reset', () => {
    expect(
      assessQuotaUsability(
        [win('unknown', null, HOUR_MS), win('no-reset', 80, null), win('past', 80, -HOUR_MS)],
        NOW
      )
    ).toEqual({ kind: 'unknown' });
  });

  test('breaks equal remaining on the sooner reset, then row id', () => {
    expect(
      pickPriorityWindow([win('later', 20, DAY_MS), win('sooner', 20, HOUR_MS)], NOW)?.rowId
    ).toBe('sooner');
    const tied = [win('b', 20, DAY_MS), win('a', 20, DAY_MS)];
    expect(pickPriorityWindow(tied, NOW)?.rowId).toBe('a');
    expect(pickPriorityWindow([...tied].reverse(), NOW)?.rowId).toBe('a');
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
  test('real data: Claude 7-day (4% left, lost in 1 day) is used first, Codex gets no badge', () => {
    const ranked = rankByPriority(
      [
        { name: 'codex', provider: 'codex', quota: codexQuota },
        { name: 'claude', provider: 'claude', quota: claudeQuota },
      ] as Item[],
      read,
      NOW
    );
    expect(names(ranked)).toEqual(['claude', 'codex']);
    expect(ranked.map((entry) => entry.useFirst)).toEqual([true, false]);
    expect(ranked[0].usability).toMatchObject({
      kind: 'usable',
      window: { rowId: 'seven-day', remainingPercent: 4, resetAtMs: NOW + DAY_MS },
    });
  });

  test('sorts blocked, unloaded, and reset-less credentials after usable ones', () => {
    const items: Item[] = [
      { name: 'unloaded', provider: 'claude', quota: undefined },
      {
        name: 'blocked',
        provider: 'codex',
        quota: {
          status: 'success',
          windows: [
            { id: 'five-hour', usedPercent: 10, resetAtMs: NOW + HOUR_MS },
            { id: 'weekly', usedPercent: 100, resetAtMs: NOW + DAY_MS },
          ],
        },
      },
      {
        name: 'no-reset',
        provider: 'codex',
        quota: { status: 'success', windows: [{ id: 'weekly', usedPercent: 10 }] },
      },
      { name: 'no-api', provider: null, quota: undefined },
      { name: 'codex', provider: 'codex', quota: codexQuota },
    ];
    const ranked = rankByPriority(items, read, NOW);
    expect(names(ranked)).toEqual(['codex', 'unloaded', 'blocked', 'no-reset', 'no-api']);
    expect(ranked.find((entry) => entry.item.name === 'blocked')?.usability.kind).toBe('blocked');
    expect(ranked.filter((entry) => entry.useFirst).map((entry) => entry.item.name)).toEqual([
      'codex',
    ]);
  });

  test('marks nobody when no credential is usable', () => {
    const ranked = rankByPriority(
      [
        { name: 'a', provider: 'claude', quota: undefined },
        {
          name: 'b',
          provider: 'claude',
          quota: {
            status: 'success',
            windows: [{ id: 'seven-day', usedPercent: 100, resetAtMs: NOW + DAY_MS }],
          },
        },
      ] as Item[],
      read,
      NOW
    );
    expect(ranked.some((entry) => entry.useFirst)).toBe(false);
  });

  test('keeps incoming order for credentials that tie', () => {
    const items: Item[] = [
      { name: 'b', provider: 'codex', quota: codexQuota },
      { name: 'a', provider: 'codex', quota: codexQuota },
    ];
    expect(names(rankByPriority(items, read, NOW))).toEqual(['b', 'a']);
  });

  test('priorityResetMs is the binding window reset rankByPriority sorts by', () => {
    expect(priorityResetMs('claude', claudeQuota, NOW)).toBe(NOW + DAY_MS);
    expect(priorityResetMs('codex', codexQuota, NOW)).toBe(NOW + 5 * DAY_MS);
    expect(priorityResetMs(null, claudeQuota, NOW)).toBeNull();
  });
});

describe('sortByInstant', () => {
  test('does not mutate the input', () => {
    const input = [3, 1, 2];
    expect(sortByInstant(input, (n) => n)).toEqual([1, 2, 3]);
    expect(input).toEqual([3, 1, 2]);
  });
});
