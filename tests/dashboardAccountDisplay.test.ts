import { describe, expect, test } from 'bun:test';
import {
  accountPlan,
  accountWindowLabel,
  quotaTone,
  shortAccountName,
} from '../src/features/dashboard/accountDisplay';
import { summarizeDashboardStatus } from '../src/features/dashboard/utils';

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

describe('accountWindowLabel', () => {
  const base = { remainingPercent: 50, resetAtMs: null, scope: 'account' as const, rankable: true };

  test('prefers the parser label key, names xAI billing rows, else falls back to text', () => {
    expect(
      accountWindowLabel({ ...base, rowId: 'five-hour', labelKey: 'claude_quota.five_hour' })
    ).toEqual({ labelKey: 'claude_quota.five_hour', labelParams: undefined });
    expect(accountWindowLabel({ ...base, rowId: 'xai:monthly' })).toEqual({
      labelKey: 'dashboard.accounts_xai_monthly',
      labelParams: undefined,
    });
    expect(accountWindowLabel({ ...base, rowId: 'b', label: 'Gemini' })).toEqual({
      text: 'Gemini',
    });
    expect(accountWindowLabel({ ...base, rowId: 'b' })).toEqual({ text: 'b' });
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
