/**
 * 0% left is blocked, not just low: both the Quota page card and the dashboard
 * Accounts panel must say so in text, not only by colour. 1-10% stays a warning.
 */

import { beforeAll, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import { ClaudeQuotaBody } from '@/features/quota/providers/claude/ClaudeQuotaBody';
import { QuotaMeter } from '@/features/quota/components/QuotaMeter';
import {
  bindQuotaClasses,
  QUOTA_CLASS_KEYS,
  QUOTA_OPTIONAL_CLASS_KEYS,
} from '@/features/quota/types';
import { AccountsPanel } from '@/features/dashboard/components/AccountsPanel';
import type { DashboardAccount } from '@/features/dashboard/hooks/useDashboardQuota';
import { HOUR_MS } from '@/utils/time/durations';
import type { AuthFileItem, ClaudeQuotaState } from '@/types';

const now = Date.now();

const fullClasses = bindQuotaClasses(
  Object.fromEntries([...QUOTA_CLASS_KEYS, ...QUOTA_OPTIONAL_CLASS_KEYS].map((key) => [key, key])),
  'test-host-full'
);

const claudeQuota = (fiveHourUsed: number, sevenDayUsed: number): ClaudeQuotaState => ({
  status: 'success',
  fetchedAtMs: now,
  windows: [
    {
      id: 'five-hour',
      label: '5-hour limit',
      usedPercent: fiveHourUsed,
      resetLabel: '10/04 06:00',
      resetAtMs: now + 2 * HOUR_MS,
      periodHours: 5,
    },
    {
      id: 'seven-day',
      label: '7-day limit',
      usedPercent: sevenDayUsed,
      resetLabel: '10/05 04:00',
      resetAtMs: now + 30 * HOUR_MS,
      periodHours: 168,
    },
  ],
});

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

describe('Quota page card at 0% and 4% left', () => {
  const render = () =>
    renderToStaticMarkup(
      createElement(ClaudeQuotaBody, { quota: claudeQuota(100, 96), classes: fullClasses })
    );

  test('0% renders the exhausted chip with its own text and accessible name', () => {
    expect(render()).toContain(
      '<span class="quotaPercent quotaPercentEmpty" aria-label="Quota exhausted: 0 percent left, blocked until reset">Exhausted</span>'
    );
  });

  test('4% keeps the low warning chip', () => {
    const markup = render();
    expect(markup).toContain(
      '<span class="quotaPercent quotaPercentLow" aria-label="Low quota: 4 percent left">4% left</span>'
    );
    expect(markup.match(/quotaPercentLow/g)).toHaveLength(1);
  });

  test('the empty bar takes the exhausted track class only at 0%', () => {
    const empty = renderToStaticMarkup(
      createElement(QuotaMeter, { percent: 0, classes: fullClasses })
    );
    const low = renderToStaticMarkup(
      createElement(QuotaMeter, { percent: 4, classes: fullClasses })
    );
    expect(empty).toContain('class="quotaBar quotaBarEmpty"');
    expect(low).toContain('class="quotaBar"');
  });
});

describe('dashboard Accounts panel at 0% and 4% left', () => {
  test('0% says exhausted, 4% shows the percent', () => {
    const account: DashboardAccount = {
      key: 'claude:a',
      file: { name: 'claude-a.json', type: 'claude' } as AuthFileItem,
      provider: 'claude',
      quota: claudeQuota(100, 96) as DashboardAccount['quota'],
    };
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(AccountsPanel, {
          accounts: [account],
          loading: false,
          error: null,
          onRetry: () => undefined,
          resolvedTheme: 'dark',
        })
      )
    );
    expect(html).toContain('>Exhausted</span>');
    expect(html).not.toContain('0% left');
    expect(html).toContain('4% left');
  });
});
