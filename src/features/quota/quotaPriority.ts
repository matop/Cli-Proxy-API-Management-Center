/**
 * Which quota window to burn first.
 *
 * Unused quota is lost when its window resets, so the window worth spending
 * next is the one that resets soonest while it still has capacity left. A
 * window at 0% is skipped: its reset gives capacity back, it does not take any
 * away. That is the difference from `nextRecoveryMs` in resetSchedule.ts, which
 * ranks by "when does anything come back" and counts exhausted windows too.
 *
 * Pure and React-free: `nowMs` is passed in and quota state is read
 * structurally, so the dashboard can import this without the quota store.
 *
 * Percent semantics per provider (all normalized here to percent REMAINING):
 * - claude, codex, meta, xai weekly: state stores percent USED; remaining = 100 - used.
 * - devin: state stores `remainingPercent` directly.
 * - antigravity: state stores `remainingFraction` 0..1.
 * - kimi: state stores raw `used` / `limit` counts.
 *
 * Codex reset credits and the xAI monthly billing cycle are not quota windows
 * and are never candidates.
 */

import type { QuotaProviderType } from './providers/types';

/** A window at or below this percent remaining gets the low-quota warning. */
export const LOW_QUOTA_REMAINING_PERCENT = 10;

export interface QuotaPriorityWindow {
  /** Matches the React key of the card row the window renders as. */
  rowId: string;
  /** Percent remaining, 0..100, or null when the payload did not say. */
  remainingPercent: number | null;
  resetAtMs: number | null;
}

/** Row id used by the xAI weekly limit, mirrors XAI_WEEKLY_ROW_ID. */
const XAI_WEEKLY_PRIORITY_ROW_ID = 'xai:weekly';

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

const remainingFromUsed = (used: unknown): number | null =>
  isFiniteNumber(used) ? clampPercent(100 - used) : null;

const resetOrNull = (value: unknown): number | null => (isFiniteNumber(value) ? value : null);

export const isLowQuota = (remainingPercent: number | null): boolean =>
  remainingPercent !== null && remainingPercent <= LOW_QUOTA_REMAINING_PERCENT;

/** Every quota window on one credential, with percent remaining. */
export function collectQuotaPriorityWindows(
  provider: QuotaProviderType,
  quota: unknown
): QuotaPriorityWindow[] {
  const state = quota as { status?: string } | undefined;
  if (!state || state.status !== 'success') return [];

  if (provider === 'claude' || provider === 'codex') {
    const windows =
      (quota as { windows?: { id?: string; usedPercent?: unknown; resetAtMs?: unknown }[] })
        .windows ?? [];
    return windows.map((window, index) => ({
      rowId: window.id || `window-${index}`,
      remainingPercent: remainingFromUsed(window.usedPercent),
      resetAtMs: resetOrNull(window.resetAtMs),
    }));
  }

  if (provider === 'devin') {
    const windows =
      (quota as { windows?: { id?: string; remainingPercent?: unknown; resetAtMs?: unknown }[] })
        .windows ?? [];
    return windows.map((window, index) => ({
      rowId: window.id || `window-${index}`,
      remainingPercent: isFiniteNumber(window.remainingPercent)
        ? clampPercent(window.remainingPercent)
        : null,
      resetAtMs: resetOrNull(window.resetAtMs),
    }));
  }

  if (provider === 'kimi') {
    const rows =
      (quota as { rows?: { id?: string; used?: unknown; limit?: unknown; resetAtMs?: unknown }[] })
        .rows ?? [];
    return rows.map((row, index) => ({
      rowId: row.id || `row-${index}`,
      remainingPercent:
        isFiniteNumber(row.limit) && row.limit > 0 && isFiniteNumber(row.used)
          ? clampPercent(((row.limit - row.used) / row.limit) * 100)
          : null,
      resetAtMs: resetOrNull(row.resetAtMs),
    }));
  }

  if (provider === 'antigravity') {
    const groups =
      (
        quota as {
          groups?: {
            buckets?: { id?: string; remainingFraction?: unknown; resetAtMs?: unknown }[];
          }[];
        }
      ).groups ?? [];
    return groups
      .flatMap((group) => group.buckets ?? [])
      .map((bucket, index) => ({
        rowId: bucket.id || `bucket-${index}`,
        remainingPercent: isFiniteNumber(bucket.remainingFraction)
          ? clampPercent(bucket.remainingFraction * 100)
          : null,
        resetAtMs: resetOrNull(bucket.resetAtMs),
      }));
  }

  if (provider === 'meta') {
    const windows =
      (quota as { data?: { windows?: { id: string; usedPercent?: unknown; resetAt?: unknown }[] } })
        .data?.windows ?? [];
    return windows.map((window) => ({
      rowId: window.id,
      remainingPercent: remainingFromUsed(window.usedPercent),
      // Unix seconds upstream.
      resetAtMs: isFiniteNumber(window.resetAt) ? window.resetAt * 1000 : null,
    }));
  }

  if (provider === 'xai') {
    const billing = (
      quota as { billing?: { periodType?: string; usagePercent?: unknown; resetAtMs?: unknown } }
    ).billing;
    if (!billing || billing.periodType !== 'weekly') return [];
    return [
      {
        rowId: XAI_WEEKLY_PRIORITY_ROW_ID,
        remainingPercent: remainingFromUsed(billing.usagePercent),
        resetAtMs: resetOrNull(billing.resetAtMs),
      },
    ];
  }

  return [];
}

/**
 * The window to use first: soonest upcoming reset among windows with quota
 * left (> 0%). Windows with unknown remaining or no future reset are skipped.
 * Equal reset instants break on row id so the choice is deterministic.
 */
export function pickPriorityWindow(
  windows: readonly QuotaPriorityWindow[],
  nowMs: number
): QuotaPriorityWindow | null {
  let best: QuotaPriorityWindow | null = null;
  for (const window of windows) {
    if (window.remainingPercent === null || window.remainingPercent <= 0) continue;
    if (window.resetAtMs === null || window.resetAtMs <= nowMs) continue;
    if (
      best === null ||
      window.resetAtMs < (best.resetAtMs as number) ||
      (window.resetAtMs === best.resetAtMs && window.rowId < best.rowId)
    ) {
      best = window;
    }
  }
  return best;
}

/** Sort key for "Resets soonest": reset instant of the use-first window, or null. */
export function priorityResetMs(
  provider: QuotaProviderType,
  quota: unknown,
  nowMs: number
): number | null {
  return pickPriorityWindow(collectQuotaPriorityWindows(provider, quota), nowMs)?.resetAtMs ?? null;
}

/**
 * Stable ascending sort by an instant. Items whose instant is null go last in
 * their incoming order; equal instants keep their incoming order.
 */
export function sortByInstant<T>(items: readonly T[], instantOf: (item: T) => number | null): T[] {
  return items
    .map((item, index) => ({ item, index, atMs: instantOf(item) }))
    .sort((a, b) => {
      if (a.atMs === null && b.atMs === null) return a.index - b.index;
      if (a.atMs === null) return 1;
      if (b.atMs === null) return -1;
      return a.atMs - b.atMs || a.index - b.index;
    })
    .map((decorated) => decorated.item);
}

/**
 * Rank credentials of any provider mix by which one to burn first.
 *
 * `read` maps an item to its provider and quota state, so callers keep their
 * own entry shape. Credentials with no use-first window (not loaded, all
 * windows exhausted, or no known reset) go last, in incoming order.
 */
export function rankByPriority<T>(
  items: readonly T[],
  read: (item: T) => { provider: QuotaProviderType; quota: unknown },
  nowMs: number
): T[] {
  return sortByInstant(items, (item) => {
    const { provider, quota } = read(item);
    return priorityResetMs(provider, quota, nowMs);
  });
}
