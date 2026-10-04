/**
 * "Use first" on the Devin, Meta and xAI bodies, and never on Antigravity.
 *
 * The badge window comes from quotaPriority.rankByPriority, exactly as
 * QuotaPage hands it to the card, so these tests check that the ranking's row
 * ids match the rows each body renders.
 */

import { beforeAll, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import { AntigravityQuotaBody } from '@/features/quota/providers/antigravity/AntigravityQuotaBody';
import { DevinQuotaBody } from '@/features/quota/providers/devin/DevinQuotaBody';
import { MetaQuotaBody } from '@/features/quota/providers/meta/MetaQuotaBody';
import { XaiQuotaBody } from '@/features/quota/providers/xai/XaiQuotaBody';
import {
  QUOTA_CLASS_KEYS,
  QUOTA_OPTIONAL_CLASS_KEYS,
  bindQuotaClasses,
} from '@/features/quota/types';
import {
  collectQuotaPriorityWindows,
  rankByPriority,
  type QuotaPriorityWindow,
} from '@/features/quota/quotaPriority';
import type { QuotaProviderType } from '@/features/quota/providers/types';
import { DAY_MS, HOUR_MS } from '@/utils/time/durations';
import type {
  AntigravityQuotaState,
  ClaudeQuotaState,
  DevinQuotaState,
  MetaQuotaState,
  XaiBillingSummary,
  XaiQuotaState,
} from '@/types';

const classes = bindQuotaClasses(
  Object.fromEntries([...QUOTA_CLASS_KEYS, ...QUOTA_OPTIONAL_CLASS_KEYS].map((key) => [key, key])),
  'test-host-full'
);

// useNow() freezes to module-load time under renderToStaticMarkup.
const now = Date.now();

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

const devin: DevinQuotaState = {
  status: 'success',
  windows: [
    { id: 'daily', remainingPercent: 37.5, resetAtMs: now + 3 * HOUR_MS, periodHours: 24 },
    { id: 'weekly', remainingPercent: 80, resetAtMs: now + 5 * DAY_MS, periodHours: 168 },
  ],
  observedAtMs: now,
  plan: 'Pro',
  planStartMs: null,
  planEndMs: null,
};

const meta: MetaQuotaState = {
  status: 'success',
  data: {
    windows: [
      {
        id: 'window',
        usedPercent: 10,
        durationMinutes: 300,
        resetAt: Math.floor((now + 2 * HOUR_MS) / 1000),
      },
      { id: 'weekly', usedPercent: 94, resetAt: Math.floor((now + 2 * DAY_MS) / 1000) },
    ],
  },
};

const xaiBilling = (overrides: Partial<XaiBillingSummary> = {}): XaiBillingSummary => ({
  mode: 'billing',
  periodType: 'weekly',
  usagePercent: 92,
  periodEnd: new Date(now + 3 * DAY_MS).toISOString(),
  resetAtMs: now + 3 * DAY_MS,
  productUsage: [],
  monthlyLimitCents: 15_000,
  usedCents: 4_500,
  includedUsedCents: 4_500,
  onDemandCapCents: 0,
  onDemandUsedCents: 0,
  onDemandUsedPercent: null,
  billingPeriodEnd: new Date(now + 20 * DAY_MS).toISOString(),
  usedPercent: 30,
  ...overrides,
});
const xai: XaiQuotaState = { status: 'success', billing: xaiBilling() };

const antigravity: AntigravityQuotaState = {
  status: 'success',
  groups: [
    {
      id: 'gemini',
      label: 'Gemini Models',
      buckets: [
        {
          id: 'gemini-weekly',
          label: 'Weekly limit',
          remainingFraction: 0.02,
          resetTime: new Date(now + HOUR_MS * 2).toISOString(),
          resetAtMs: now + HOUR_MS * 2,
        },
      ],
    },
  ],
};

// A Claude account that would rank behind every fixture above (reset in 6 days).
const claudeLater: ClaudeQuotaState = {
  status: 'success',
  windows: [
    {
      id: 'seven-day',
      label: '7-day limit',
      usedPercent: 50,
      resetLabel: '',
      resetAtMs: now + 6 * DAY_MS,
      periodHours: 168,
    },
  ],
};

type Entry = { provider: QuotaProviderType; quota: unknown };

/** What QuotaPage passes to a card: the top window if this entry ranks first, else null. */
const useFirstFor = (entries: Entry[], target: Entry): QuotaPriorityWindow | null => {
  const [top] = rankByPriority(entries, (entry) => entry, now);
  return top?.useFirst && top.item === target && top.usability.kind === 'usable'
    ? top.usability.window
    : null;
};

const badgeCount = (markup: string) => (markup.match(/class="quotaUseFirst"/g) ?? []).length;

describe('use-first badge on newly supported providers', () => {
  const cases = [
    {
      name: 'Devin',
      entry: { provider: 'devin', quota: devin } as Entry,
      render: (useFirst: QuotaPriorityWindow | null) =>
        renderToStaticMarkup(createElement(DevinQuotaBody, { quota: devin, classes, useFirst })),
      rowId: 'daily',
      badge: /Use first · 38% left, lost in 3 hours/,
    },
    {
      name: 'Meta',
      entry: { provider: 'meta', quota: meta } as Entry,
      render: (useFirst: QuotaPriorityWindow | null) =>
        renderToStaticMarkup(createElement(MetaQuotaBody, { quota: meta, classes, useFirst })),
      rowId: 'weekly',
      badge: /Use first · 6% left, lost in (1 day|2 days)/,
    },
    {
      name: 'xAI',
      entry: { provider: 'xai', quota: xai } as Entry,
      render: (useFirst: QuotaPriorityWindow | null) =>
        renderToStaticMarkup(createElement(XaiQuotaBody, { quota: xai, classes, useFirst })),
      rowId: 'xai:weekly',
      badge: /Use first · 8% left, lost in 3 days/,
    },
  ];

  test.each(cases)('$name renders the badge once when ranked first', (item) => {
    const claude: Entry = { provider: 'claude', quota: claudeLater };
    const useFirst = useFirstFor([claude, item.entry], item.entry);
    expect(useFirst?.rowId).toBe(item.rowId);
    const markup = item.render(useFirst);
    expect(badgeCount(markup)).toBe(1);
    expect(markup).toMatch(item.badge);
  });

  test.each(cases)('$name renders no badge when another account ranks first', (item) => {
    const sooner: ClaudeQuotaState = {
      ...claudeLater,
      windows: [{ ...claudeLater.windows[0], resetAtMs: now + HOUR_MS }],
    };
    const claude: Entry = { provider: 'claude', quota: sooner };
    const useFirst = useFirstFor([claude, item.entry], item.entry);
    expect(useFirst).toBeNull();
    expect(badgeCount(item.render(useFirst))).toBe(0);
  });

  test('Devin labels its percent as left and keeps one decimal', () => {
    const markup = renderToStaticMarkup(createElement(DevinQuotaBody, { quota: devin, classes }));
    expect(markup).toContain('aria-label="37.5 percent of quota left">37.5% left</span>');
    expect(markup).toContain('>80% left</span>');
  });

  test('xAI monthly credits are labelled as left; weekly keeps its used wording', () => {
    const markup = renderToStaticMarkup(createElement(XaiQuotaBody, { quota: xai, classes }));
    expect(markup).toContain('>70% left</span>');
    expect(markup).toContain('Used 92%');
  });

  test('xAI monthly billing never ranks, so a monthly-only account gets no badge', () => {
    const monthly: XaiQuotaState = {
      status: 'success',
      billing: xaiBilling({ periodType: 'monthly', resetAtMs: now + HOUR_MS }),
    };
    const entry: Entry = { provider: 'xai', quota: monthly };
    expect(useFirstFor([entry], entry)).toBeNull();
  });
});

describe('Antigravity never gets the badge', () => {
  test('every bucket is scoped, so the ranking never marks it first', () => {
    const entry: Entry = { provider: 'antigravity', quota: antigravity };
    expect(collectQuotaPriorityWindows('antigravity', antigravity).map((w) => w.scope)).toEqual([
      'scoped',
    ]);
    // Alone, and against an account that resets days later.
    expect(rankByPriority([entry], (item) => item, now)[0].useFirst).toBe(false);
    const claude: Entry = { provider: 'claude', quota: claudeLater };
    const ranked = rankByPriority([entry, claude], (item) => item, now);
    expect(ranked[0].item).toBe(claude);
    expect(ranked.find((row) => row.item === entry)?.useFirst).toBe(false);
  });

  test('the body renders no badge even if handed a window', () => {
    const forced: QuotaPriorityWindow = {
      rowId: 'gemini-weekly',
      remainingPercent: 2,
      resetAtMs: now + 2 * HOUR_MS,
      scope: 'account',
      rankable: true,
    };
    const markup = renderToStaticMarkup(
      createElement(AntigravityQuotaBody, {
        quota: antigravity,
        classes,
        useFirst: forced,
      })
    );
    expect(markup).not.toContain('quotaUseFirst');
  });
});
