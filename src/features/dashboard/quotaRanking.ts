/**
 * Dashboard account ranking: which credential's quota to burn first.
 *
 * Pure and clock-free: `nowMs` is passed in and quota states are read
 * structurally from the shapes the quota feature stores in useQuotaStore.
 * Nothing here fetches or parses upstream payloads; that stays in
 * src/features/quota/providers/<provider>/data.ts.
 *
 * The quota feature owns a similar reader (resetSchedule.ts); this copy is
 * dashboard-local on purpose until the two are deduplicated.
 */

import type { QuotaProviderType } from '@/features/quota/providers/types';
import { PREMIUM_CODEX_PLAN_TYPES, normalizePlanType } from '@/utils/quota';

/** At or below this many percent left, a window renders in warning style. */
export const LOW_QUOTA_PERCENT = 10;

export interface AccountQuotaWindow {
  id: string;
  /** i18n key for the window label; `label` is the fallback text. */
  labelKey?: string;
  labelParams?: Record<string, string | number>;
  label?: string;
  /** 0..100, null when the provider did not report usage. */
  remainingPercent: number | null;
  resetAtMs: number | null;
  /**
   * False for windows whose reset is not capacity coming back (xAI monthly
   * billing rollover). They still render but never drive the ranking.
   */
  rankable: boolean;
}

export type QuotaTone = 'good' | 'warning' | 'critical' | 'idle';

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

const finiteOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const remainingFromUsed = (used: unknown): number | null => {
  const value = finiteOrNull(used);
  return value === null ? null : clampPercent(100 - value);
};

/** Severity of a window's remaining percent. */
export function quotaTone(remainingPercent: number | null): QuotaTone {
  if (remainingPercent === null) return 'idle';
  if (remainingPercent <= 0) return 'critical';
  if (remainingPercent <= LOW_QUOTA_PERCENT) return 'warning';
  return 'good';
}

interface UsedWindowLike {
  id?: string;
  label?: string;
  labelKey?: string;
  labelParams?: Record<string, string | number>;
  usedPercent?: number | null;
  resetAtMs?: number | null;
}

/**
 * Every quota window of one loaded credential, as remaining percent plus reset
 * instant. Returns [] unless the state is a successful load.
 */
export function extractAccountWindows(
  provider: QuotaProviderType,
  quota: unknown
): AccountQuotaWindow[] {
  const state = quota as { status?: string } | undefined;
  if (!state || state.status !== 'success') return [];

  if (provider === 'claude' || provider === 'codex') {
    return ((quota as { windows?: UsedWindowLike[] }).windows ?? []).map((window, index) => ({
      id: window.id || `window-${index}`,
      labelKey: window.labelKey,
      labelParams: window.labelParams,
      label: window.label,
      remainingPercent: remainingFromUsed(window.usedPercent),
      resetAtMs: finiteOrNull(window.resetAtMs),
      rankable: true,
    }));
  }

  if (provider === 'devin') {
    const windows =
      (
        quota as {
          windows?: { id: string; remainingPercent: number | null; resetAtMs: number | null }[];
        }
      ).windows ?? [];
    return windows.map((window) => {
      const remaining = finiteOrNull(window.remainingPercent);
      return {
        id: window.id,
        labelKey: `devin_quota.${window.id}`,
        remainingPercent: remaining === null ? null : clampPercent(remaining),
        resetAtMs: finiteOrNull(window.resetAtMs),
        rankable: true,
      };
    });
  }

  if (provider === 'kimi') {
    const rows =
      (quota as { rows?: (UsedWindowLike & { used: number; limit: number })[] }).rows ?? [];
    return rows.map((row, index) => ({
      id: row.id || `row-${index}`,
      labelKey: row.labelKey,
      labelParams: row.labelParams,
      label: row.label,
      remainingPercent:
        row.limit > 0 ? clampPercent(Math.round(((row.limit - row.used) / row.limit) * 100)) : null,
      resetAtMs: finiteOrNull(row.resetAtMs),
      rankable: true,
    }));
  }

  if (provider === 'antigravity') {
    const groups =
      (
        quota as {
          groups?: {
            buckets?: {
              id?: string;
              label?: string;
              remainingFraction?: number | null;
              resetAtMs?: number | null;
            }[];
          }[];
        }
      ).groups ?? [];
    return groups
      .flatMap((group) => group.buckets ?? [])
      .map((bucket, index) => {
        const fraction = finiteOrNull(bucket.remainingFraction);
        return {
          id: bucket.id || `bucket-${index}`,
          label: bucket.label,
          // Antigravity reports the fraction remaining, not percent used.
          remainingPercent: fraction === null ? null : clampPercent(Math.round(fraction * 100)),
          resetAtMs: finiteOrNull(bucket.resetAtMs),
          rankable: true,
        };
      });
  }

  if (provider === 'meta') {
    const windows =
      (
        quota as {
          data?: { windows?: { id: string; usedPercent: number | null; resetAt?: number }[] };
        }
      ).data?.windows ?? [];
    return windows.map((window) => {
      const resetAt = finiteOrNull(window.resetAt);
      return {
        id: window.id,
        labelKey: `meta_quota.${window.id}`,
        remainingPercent: remainingFromUsed(window.usedPercent),
        // Meta reports Unix seconds.
        resetAtMs: resetAt === null ? null : resetAt * 1000,
        rankable: true,
      };
    });
  }

  if (provider === 'xai') {
    const billing = (
      quota as {
        billing?: {
          periodType?: string;
          usagePercent?: number | null;
          resetAtMs?: number | null;
        } | null;
      }
    ).billing;
    if (!billing || (billing.periodType !== 'weekly' && billing.periodType !== 'monthly')) {
      return [];
    }
    return [
      {
        id: `xai:${billing.periodType}`,
        labelKey: `dashboard.accounts_xai_${billing.periodType}`,
        remainingPercent: remainingFromUsed(billing.usagePercent),
        resetAtMs: finiteOrNull(billing.resetAtMs),
        // A monthly billing rollover is a spend cap resetting, not capacity coming back.
        rankable: billing.periodType === 'weekly',
      },
    ];
  }

  return [];
}

export interface RankableAccount {
  windows: AccountQuotaWindow[];
}

export interface RankedAccount<T extends RankableAccount> {
  account: T;
  /** Window whose remaining quota is lost first; null when nothing is burnable. */
  burnWindowId: string | null;
  burnAtMs: number | null;
  /** True for exactly the first account, and only when it has a burnable window. */
  useFirst: boolean;
}

/**
 * The window to burn on one account: the soonest future reset among windows
 * that still have quota left.
 *
 * An account with any exhausted window that has not reset yet is blocked: its
 * other windows cannot be spent until that one resets, so it gets no candidate.
 */
export function pickBurnWindow(
  windows: readonly AccountQuotaWindow[],
  nowMs: number
): AccountQuotaWindow | null {
  const blocked = windows.some(
    (window) =>
      window.remainingPercent !== null &&
      window.remainingPercent <= 0 &&
      (window.resetAtMs === null || window.resetAtMs > nowMs)
  );
  if (blocked) return null;

  let best: AccountQuotaWindow | null = null;
  for (const window of windows) {
    if (!window.rankable) continue;
    if (window.remainingPercent === null || window.remainingPercent <= 0) continue;
    if (window.resetAtMs === null || window.resetAtMs <= nowMs) continue;
    if (
      best === null ||
      window.resetAtMs < (best.resetAtMs as number) ||
      (window.resetAtMs === best.resetAtMs && window.id < best.id)
    ) {
      best = window;
    }
  }
  return best;
}

/**
 * Order accounts so the one whose unused quota is lost soonest comes first.
 *
 * Accounts without a burnable window (not loaded, failed, exhausted, no reset
 * reported) keep their incoming order after the ranked ones.
 */
export function rankAccountsByBurnOrder<T extends RankableAccount>(
  accounts: readonly T[],
  nowMs: number
): RankedAccount<T>[] {
  return accounts
    .map((account, index) => {
      const burn = pickBurnWindow(account.windows, nowMs);
      return {
        account,
        index,
        burnWindowId: burn?.id ?? null,
        burnAtMs: burn?.resetAtMs ?? null,
      };
    })
    .sort((a, b) => {
      if (a.burnAtMs === null && b.burnAtMs === null) return a.index - b.index;
      if (a.burnAtMs === null) return 1;
      if (b.burnAtMs === null) return -1;
      return a.burnAtMs - b.burnAtMs || a.index - b.index;
    })
    .map((entry, position) => ({
      account: entry.account,
      burnWindowId: entry.burnWindowId,
      burnAtMs: entry.burnAtMs,
      useFirst: position === 0 && entry.burnAtMs !== null,
    }));
}

/** Short display name: the account email when known, else the filename without `.json`. */
export function shortAccountName(file: { name: string; email?: string }): string {
  const email = typeof file.email === 'string' ? file.email.trim() : '';
  if (email) return email;
  return file.name.replace(/\.json$/i, '');
}

/** Plan label as an i18n key or literal text; null when the provider reported none. */
export type AccountPlan = { labelKey: string } | { text: string };

const CODEX_PLAN_KEYS: Record<string, string> = {
  pro: 'codex_quota.plan_pro',
  self_serve_business_prolite: 'codex_quota.plan_business_premium',
  plus: 'codex_quota.plan_plus',
  team: 'codex_quota.plan_team',
  free: 'codex_quota.plan_free',
};

const ANTIGRAVITY_PLAN_KEYS: Record<string, string> = {
  free: 'antigravity_subscription.plan_free',
  pro: 'antigravity_subscription.plan_pro',
  ultra: 'antigravity_subscription.plan_ultra',
  'ultra-lite': 'antigravity_subscription.plan_ultra_lite',
};

const XAI_PLAN_KEYS: Record<number, string> = {
  15_000: 'xai_quota.plan_supergrok',
  150_000: 'xai_quota.plan_supergrok_heavy',
};

const textOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

/**
 * Plan of one loaded credential, mirroring the labels the quota cards show.
 */
export function accountPlan(provider: QuotaProviderType, quota: unknown): AccountPlan | null {
  const state = quota as { status?: string } | undefined;
  if (!state || state.status !== 'success') return null;

  if (provider === 'claude') {
    const planType = textOrNull((quota as { planType?: string | null }).planType);
    return planType ? { labelKey: `claude_quota.${planType}` } : null;
  }
  if (provider === 'codex') {
    const raw = (quota as { planType?: string | null }).planType;
    const normalized = normalizePlanType(raw);
    if (!normalized) return null;
    const key = CODEX_PLAN_KEYS[normalized];
    if (key) return { labelKey: key };
    if (PREMIUM_CODEX_PLAN_TYPES.has(normalized)) return { labelKey: 'codex_quota.plan_prolite' };
    return { text: textOrNull(raw) ?? normalized };
  }
  if (provider === 'antigravity') {
    const subscription = (
      quota as {
        subscription?: { plan: string | null; tierName: string | null; tierId: string | null };
      }
    ).subscription;
    if (!subscription) return null;
    const key = subscription.plan ? ANTIGRAVITY_PLAN_KEYS[subscription.plan] : undefined;
    if (key) return { labelKey: key };
    const text = textOrNull(subscription.tierName) ?? textOrNull(subscription.tierId);
    return text ? { text } : null;
  }
  if (provider === 'devin') {
    const text = textOrNull((quota as { plan?: string | null }).plan);
    return text ? { text } : null;
  }
  if (provider === 'meta') {
    const text = textOrNull((quota as { data?: { planName?: string } }).data?.planName);
    return text ? { text } : null;
  }
  if (provider === 'xai') {
    const billing = (
      quota as { billing?: { planType?: string; monthlyLimitCents?: number | null } | null }
    ).billing;
    if (!billing) return null;
    const key =
      typeof billing.monthlyLimitCents === 'number'
        ? XAI_PLAN_KEYS[billing.monthlyLimitCents]
        : undefined;
    if (key) return { labelKey: key };
    return billing.planType === 'paid' ? { labelKey: 'xai_quota.plan_paid' } : null;
  }
  return null;
}
