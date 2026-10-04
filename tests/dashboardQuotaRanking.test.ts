import { describe, expect, test } from 'bun:test';
import {
  accountPlan,
  extractAccountWindows,
  pickBurnWindow,
  quotaTone,
  rankAccountsByBurnOrder,
  shortAccountName,
  type AccountQuotaWindow,
} from '../src/features/dashboard/quotaRanking';
import { summarizeDashboardStatus } from '../src/features/dashboard/utils';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 9, 4, 12, 0, 0);

const win = (
  id: string,
  remainingPercent: number | null,
  resetInMs: number | null,
  rankable = true
): AccountQuotaWindow => ({
  id,
  remainingPercent,
  resetAtMs: resetInMs === null ? null : NOW + resetInMs,
  rankable,
});

describe('quotaTone', () => {
  test('warns at or below ten percent left and is critical at zero', () => {
    expect(quotaTone(null)).toBe('idle');
    expect(quotaTone(0)).toBe('critical');
    expect(quotaTone(5)).toBe('warning');
    expect(quotaTone(10)).toBe('warning');
    expect(quotaTone(10.5)).toBe('good');
    expect(quotaTone(98)).toBe('good');
  });
});

describe('extractAccountWindows', () => {
  test('turns Claude percent used into percent left', () => {
    const windows = extractAccountWindows('claude', {
      status: 'success',
      windows: [
        {
          id: 'five-hour',
          labelKey: 'claude_quota.five_hour',
          usedPercent: 2,
          resetAtMs: NOW + 4 * HOUR,
        },
        {
          id: 'seven-day',
          labelKey: 'claude_quota.seven_day',
          usedPercent: 95,
          resetAtMs: NOW + DAY,
        },
      ],
    });
    expect(windows.map((w) => [w.id, w.remainingPercent, w.resetAtMs])).toEqual([
      ['five-hour', 98, NOW + 4 * HOUR],
      ['seven-day', 5, NOW + DAY],
    ]);
  });

  test('reads Antigravity fractions and Meta Unix seconds', () => {
    const [bucket] = extractAccountWindows('antigravity', {
      status: 'success',
      groups: [
        { buckets: [{ id: 'b', label: 'Gemini', remainingFraction: 0.42, resetAtMs: NOW }] },
      ],
    });
    expect(bucket.remainingPercent).toBe(42);

    const [meta] = extractAccountWindows('meta', {
      status: 'success',
      data: { windows: [{ id: 'weekly', usedPercent: 30, resetAt: NOW / 1000 }] },
    });
    expect(meta).toMatchObject({
      remainingPercent: 70,
      resetAtMs: NOW,
      labelKey: 'meta_quota.weekly',
    });
  });

  test('keeps xAI monthly billing out of the ranking', () => {
    const [monthly] = extractAccountWindows('xai', {
      status: 'success',
      billing: { periodType: 'monthly', usagePercent: 10, resetAtMs: NOW + DAY },
    });
    expect(monthly.rankable).toBe(false);
  });

  test('returns nothing for states that are not a successful load', () => {
    expect(extractAccountWindows('claude', undefined)).toEqual([]);
    expect(extractAccountWindows('claude', { status: 'loading', windows: [] })).toEqual([]);
    expect(extractAccountWindows('codex', { status: 'error', windows: [] })).toEqual([]);
  });
});

describe('pickBurnWindow', () => {
  test('picks the soonest future reset that still has quota left', () => {
    const burn = pickBurnWindow([win('weekly', 5, DAY), win('five-hour', 98, 4 * HOUR)], NOW);
    expect(burn?.id).toBe('five-hour');
  });

  test('skips empty, unknown, past and non-rankable windows', () => {
    expect(
      pickBurnWindow(
        [win('past', 50, -HOUR), win('unknown', null, HOUR), win('billing', 90, HOUR, false)],
        NOW
      )
    ).toBeNull();
  });

  test('treats an account with an exhausted window as blocked', () => {
    expect(pickBurnWindow([win('weekly', 0, DAY), win('five-hour', 80, HOUR)], NOW)).toBeNull();
    // Once the exhausted window's reset has passed it no longer blocks.
    expect(pickBurnWindow([win('weekly', 0, -HOUR), win('five-hour', 80, HOUR)], NOW)?.id).toBe(
      'five-hour'
    );
  });
});

describe('rankAccountsByBurnOrder', () => {
  test('puts the account whose quota is lost soonest first and marks only it', () => {
    const claude = {
      name: 'claude',
      windows: [win('five-hour', 98, 4 * HOUR), win('weekly', 5, DAY)],
    };
    const codex = { name: 'codex', windows: [win('weekly', 91, 5 * DAY)] };
    const ranked = rankAccountsByBurnOrder([codex, claude], NOW);

    expect(ranked.map((entry) => entry.account.name)).toEqual(['claude', 'codex']);
    expect(ranked.map((entry) => entry.useFirst)).toEqual([true, false]);
    expect(ranked[0].burnWindowId).toBe('five-hour');
  });

  test('keeps unranked accounts after ranked ones in their incoming order', () => {
    const unloaded = { name: 'unloaded', windows: [] };
    const blocked = { name: 'blocked', windows: [win('weekly', 0, DAY)] };
    const ready = { name: 'ready', windows: [win('weekly', 40, 2 * DAY)] };
    const ranked = rankAccountsByBurnOrder([unloaded, blocked, ready], NOW);

    expect(ranked.map((entry) => entry.account.name)).toEqual(['ready', 'unloaded', 'blocked']);
  });

  test('marks nobody when no account has a burnable window', () => {
    const ranked = rankAccountsByBurnOrder([{ windows: [] }, { windows: [win('w', 0, DAY)] }], NOW);
    expect(ranked.some((entry) => entry.useFirst)).toBe(false);
  });
});

describe('accountPlan', () => {
  test('maps known plans onto the quota card labels', () => {
    expect(accountPlan('claude', { status: 'success', planType: 'plan_max' })).toEqual({
      labelKey: 'claude_quota.plan_max',
    });
    expect(accountPlan('codex', { status: 'success', planType: 'prolite' })).toEqual({
      labelKey: 'codex_quota.plan_prolite',
    });
    expect(accountPlan('codex', { status: 'success', planType: 'pro' })).toEqual({
      labelKey: 'codex_quota.plan_pro',
    });
    expect(accountPlan('devin', { status: 'success', plan: 'Core' })).toEqual({ text: 'Core' });
    expect(accountPlan('claude', { status: 'loading', planType: 'plan_max' })).toBeNull();
  });
});

describe('shortAccountName', () => {
  test('prefers the email and otherwise strips the .json suffix', () => {
    expect(shortAccountName({ name: 'claude-a@b.cl.json', email: 'a@b.cl' })).toBe('a@b.cl');
    expect(shortAccountName({ name: 'codex-team.json' })).toBe('codex-team');
  });
});

describe('summarizeDashboardStatus', () => {
  test('is healthy with no unavailable credentials and no windowed failures', () => {
    expect(
      summarizeDashboardStatus({
        connectionStatus: 'connected',
        unavailableCredentials: 0,
        failuresInWindow: 0,
      })
    ).toEqual({ tone: 'good', headlineKey: 'status_healthy', issues: [] });
  });

  test('lists unavailable credentials before windowed failures', () => {
    const status = summarizeDashboardStatus({
      connectionStatus: 'connected',
      unavailableCredentials: 2,
      failuresInWindow: 3,
    });
    expect(status.tone).toBe('critical');
    expect(status.issues).toEqual([
      { key: 'status_unavailable', count: 2 },
      { key: 'status_failures', count: 3 },
    ]);
  });

  test('reports failures alone as a warning and offline as idle', () => {
    expect(
      summarizeDashboardStatus({
        connectionStatus: 'connected',
        unavailableCredentials: null,
        failuresInWindow: 1,
      }).tone
    ).toBe('warning');
    expect(
      summarizeDashboardStatus({
        connectionStatus: 'disconnected',
        unavailableCredentials: 5,
        failuresInWindow: 9,
      })
    ).toEqual({ tone: 'idle', headlineKey: 'status_offline', issues: [] });
  });
});
