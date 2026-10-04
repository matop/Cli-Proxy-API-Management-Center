/**
 * Severity of one quota window's remaining percent, shared by every quota bar:
 * QuotaMeter on the Quota page and auth-file cards, and the dashboard Accounts
 * panel (accountDisplay.quotaTone). Change bands here, not in a component.
 *
 * Bands (percent remaining):
 * - exhausted: 0. The backend blocks the window until it resets.
 * - low: above 0 up to LOW_QUOTA_REMAINING_PERCENT (10). Warning; the same cut
 *   isLowQuota uses for the low-quota chip.
 * - medium: above 10 up to QUOTA_MEDIUM_MAX_PERCENT (30). Under a third left,
 *   so one heavy session can drain the window before it resets.
 * - healthy: above 30.
 * - unknown: the payload did not report a percent.
 */

import { LOW_QUOTA_REMAINING_PERCENT } from './quotaPriority';

/** Highest percent remaining that still renders as medium. */
export const QUOTA_MEDIUM_MAX_PERCENT = 30;

export type QuotaLevel = 'unknown' | 'exhausted' | 'low' | 'medium' | 'healthy';

export function quotaLevel(remainingPercent: number | null): QuotaLevel {
  if (remainingPercent === null || Number.isNaN(remainingPercent)) return 'unknown';
  if (remainingPercent <= 0) return 'exhausted';
  if (remainingPercent <= LOW_QUOTA_REMAINING_PERCENT) return 'low';
  if (remainingPercent <= QUOTA_MEDIUM_MAX_PERCENT) return 'medium';
  return 'healthy';
}
