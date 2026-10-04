/**
 * Dashboard-only formatting for the Accounts panel.
 *
 * Ranking lives in src/features/quota/quotaPriority.ts and is shared with the
 * Quota page; this file only turns what that module returns into dashboard
 * labels and tones.
 */

import type { QuotaProviderType } from '@/features/quota/providers/types';
import {
  LOW_QUOTA_REMAINING_PERCENT,
  type QuotaPriorityWindow,
} from '@/features/quota/quotaPriority';
import { PREMIUM_CODEX_PLAN_TYPES, normalizePlanType } from '@/utils/quota';

export type QuotaTone = 'good' | 'warning' | 'critical' | 'idle';

/** Severity of a window's remaining percent. */
export function quotaTone(remainingPercent: number | null): QuotaTone {
  if (remainingPercent === null) return 'idle';
  if (remainingPercent <= 0) return 'critical';
  if (remainingPercent <= LOW_QUOTA_REMAINING_PERCENT) return 'warning';
  return 'good';
}

/** xAI billing rows carry no parser label; the dashboard names them itself. */
const XAI_WINDOW_LABEL_KEYS: Record<string, string> = {
  'xai:weekly': 'dashboard.accounts_xai_weekly',
  'xai:monthly': 'dashboard.accounts_xai_monthly',
};

/** Label of one window as an i18n key with params, or literal text. */
export function accountWindowLabel(
  window: QuotaPriorityWindow
): { labelKey: string; labelParams?: Record<string, string | number> } | { text: string } {
  const labelKey = window.labelKey ?? XAI_WINDOW_LABEL_KEYS[window.rowId];
  if (labelKey) return { labelKey, labelParams: window.labelParams };
  return { text: window.label ?? window.rowId };
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
