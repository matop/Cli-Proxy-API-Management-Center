/**
 * Which credential to burn first, and which of its windows decides that.
 *
 * Unused quota is lost when its window resets. A credential can only spend as
 * much as its most constrained account-wide window allows, so that window (the
 * binding window) is the one whose leftover quota is actually at stake. The
 * credential to use first is the usable one whose binding window resets
 * soonest.
 *
 * Rule, per credential:
 * 1. Drop windows whose reset has already passed: the stored numbers are stale.
 * 2. Blocked: any account-wide window at 0% remaining. Nothing can be spent until
 *    it resets, so the credential gets no binding window and sorts after usable
 *    ones.
 * 3. Binding window: among account-wide, rankable windows with remaining > 0 and
 *    a known future reset, the one with the lowest remaining. Ties go to the
 *    sooner reset, then to row id.
 * 4. Credentials rank by the binding window's reset instant.
 *
 * Window scope. Only windows that cap every request on the credential are
 * `account` scope. A window that caps one model or one product surface is
 * `scoped`: exhausting it leaves the rest of the account usable, so it never
 * binds and never blocks. Scope is assigned per provider from the row ids the
 * parsers emit (see ACCOUNT_WINDOW_IDS and collectQuotaPriorityWindows):
 * - claude: `five-hour` and `seven-day` (payload keys `five_hour`, `seven_day`)
 *   are account-wide. `seven-day-opus`, `seven-day-sonnet` and `seven-day-fable`
 *   are per model: the Fable row comes from a `limits[]` entry with
 *   `kind: 'weekly_scoped'` and `scope.model.display_name: 'Fable'`, or from the
 *   `iguana_necktie` key (providers/claude/data.ts). `seven-day-oauth-apps` and
 *   `seven-day-cowork` count only one product surface and are scoped too.
 * - codex: `five-hour`, `weekly`, `monthly` come from the top-level `rate_limit`
 *   and are account-wide. `code-review-*` rows cap the code review feature, and
 *   rows built from `additional_rate_limits` are named by `limit_name`, which is a
 *   model name such as `GPT-5.3-Codex-Spark` (backend
 *   internal/runtime/executor/helps/codex_quota.go). Both are scoped.
 * - antigravity: every bucket belongs to a named model group, so all are scoped
 *   and an Antigravity credential never gets a binding window.
 * - devin, kimi, meta, xai: no per-model rows exist; every row is account-wide.
 *   xAI monthly billing is account-wide but not rankable: its reset rolls a
 *   spend cap over, it does not take unused capacity away. At 0% it still blocks.
 * Unknown Claude or Codex row ids default to scoped, so a new per-model window
 * cannot silently become the binding one.
 *
 * Pure and React-free: `nowMs` is passed in and quota state is read
 * structurally, so the dashboard can use it without the quota page.
 *
 * Percent semantics per provider (all normalized here to percent REMAINING):
 * - claude, codex, meta, xai: state stores percent USED; remaining = 100 - used.
 * - devin: state stores `remainingPercent` directly.
 * - antigravity: state stores `remainingFraction` 0..1.
 * - kimi: state stores raw `used` / `limit` counts.
 *
 * Codex reset credits are not quota windows and are never collected.
 */

import type { QuotaProviderType } from './providers/types';

/** A window at or below this percent remaining gets the low-quota warning. */
export const LOW_QUOTA_REMAINING_PERCENT = 10;

/** `account`: caps every request on the credential. `scoped`: one model or surface only. */
export type QuotaWindowScope = 'account' | 'scoped';

export interface QuotaPriorityWindow {
  /** Matches the React key of the card row the window renders as. */
  rowId: string;
  /** Percent remaining, 0..100, or null when the payload did not say. */
  remainingPercent: number | null;
  resetAtMs: number | null;
  scope: QuotaWindowScope;
  /** False when the reset does not take unused quota away (xAI monthly billing). */
  rankable: boolean;
  /** Display label as the parser stored it; `labelKey` wins when present. */
  label?: string;
  labelKey?: string;
  labelParams?: Record<string, string | number>;
}

/** Row ids that cap the whole credential. Everything else from these providers is scoped. */
const ACCOUNT_WINDOW_IDS: Partial<Record<QuotaProviderType, ReadonlySet<string>>> = {
  claude: new Set(['five-hour', 'seven-day']),
  codex: new Set(['five-hour', 'weekly', 'monthly']),
};

/** Row ids used by the xAI billing period, mirror XAI_WEEKLY_ROW_ID. */
const XAI_PRIORITY_ROW_ID = { weekly: 'xai:weekly', monthly: 'xai:monthly' } as const;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

const remainingFromUsed = (used: unknown): number | null =>
  isFiniteNumber(used) ? clampPercent(100 - used) : null;

const resetOrNull = (value: unknown): number | null => (isFiniteNumber(value) ? value : null);

const textOrUndefined = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

const paramsOrUndefined = (value: unknown): Record<string, string | number> | undefined =>
  value && typeof value === 'object' ? (value as Record<string, string | number>) : undefined;

const scopeFor = (provider: QuotaProviderType, rowId: string): QuotaWindowScope => {
  const accountIds = ACCOUNT_WINDOW_IDS[provider];
  if (accountIds) return accountIds.has(rowId) ? 'account' : 'scoped';
  return provider === 'antigravity' ? 'scoped' : 'account';
};

export const isLowQuota = (remainingPercent: number | null): boolean =>
  remainingPercent !== null && remainingPercent <= LOW_QUOTA_REMAINING_PERCENT;

interface LabelledRow {
  id?: string;
  label?: unknown;
  labelKey?: unknown;
  labelParams?: unknown;
}

const labelsOf = (row: LabelledRow) => ({
  label: textOrUndefined(row.label),
  labelKey: textOrUndefined(row.labelKey),
  labelParams: paramsOrUndefined(row.labelParams),
});

/** Every quota window on one credential, with percent remaining and scope. */
export function collectQuotaPriorityWindows(
  provider: QuotaProviderType | null,
  quota: unknown
): QuotaPriorityWindow[] {
  const state = quota as { status?: string } | undefined;
  if (!provider || !state || state.status !== 'success') return [];

  if (provider === 'claude' || provider === 'codex') {
    const windows =
      (quota as { windows?: (LabelledRow & { usedPercent?: unknown; resetAtMs?: unknown })[] })
        .windows ?? [];
    return windows.map((window, index) => {
      const rowId = window.id || `window-${index}`;
      return {
        rowId,
        remainingPercent: remainingFromUsed(window.usedPercent),
        resetAtMs: resetOrNull(window.resetAtMs),
        scope: scopeFor(provider, rowId),
        rankable: true,
        ...labelsOf(window),
      };
    });
  }

  if (provider === 'devin') {
    const windows =
      (quota as { windows?: { id?: string; remainingPercent?: unknown; resetAtMs?: unknown }[] })
        .windows ?? [];
    return windows.map((window, index) => {
      const rowId = window.id || `window-${index}`;
      return {
        rowId,
        remainingPercent: isFiniteNumber(window.remainingPercent)
          ? clampPercent(window.remainingPercent)
          : null,
        resetAtMs: resetOrNull(window.resetAtMs),
        scope: scopeFor(provider, rowId),
        rankable: true,
        labelKey: `devin_quota.${rowId}`,
      };
    });
  }

  if (provider === 'kimi') {
    const rows =
      (
        quota as {
          rows?: (LabelledRow & { used?: unknown; limit?: unknown; resetAtMs?: unknown })[];
        }
      ).rows ?? [];
    return rows.map((row, index) => {
      const rowId = row.id || `row-${index}`;
      return {
        rowId,
        remainingPercent:
          isFiniteNumber(row.limit) && row.limit > 0 && isFiniteNumber(row.used)
            ? clampPercent(((row.limit - row.used) / row.limit) * 100)
            : null,
        resetAtMs: resetOrNull(row.resetAtMs),
        scope: scopeFor(provider, rowId),
        rankable: true,
        ...labelsOf(row),
      };
    });
  }

  if (provider === 'antigravity') {
    const groups =
      (
        quota as {
          groups?: {
            buckets?: {
              id?: string;
              label?: unknown;
              remainingFraction?: unknown;
              resetAtMs?: unknown;
            }[];
          }[];
        }
      ).groups ?? [];
    return groups
      .flatMap((group) => group.buckets ?? [])
      .map((bucket, index) => {
        const rowId = bucket.id || `bucket-${index}`;
        return {
          rowId,
          remainingPercent: isFiniteNumber(bucket.remainingFraction)
            ? clampPercent(bucket.remainingFraction * 100)
            : null,
          resetAtMs: resetOrNull(bucket.resetAtMs),
          scope: scopeFor(provider, rowId),
          rankable: true,
          label: textOrUndefined(bucket.label),
        };
      });
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
      scope: scopeFor(provider, window.id),
      rankable: true,
      labelKey: `meta_quota.${window.id}`,
    }));
  }

  if (provider === 'xai') {
    const billing = (
      quota as {
        billing?: { periodType?: string; usagePercent?: unknown; resetAtMs?: unknown } | null;
      }
    ).billing;
    if (!billing || (billing.periodType !== 'weekly' && billing.periodType !== 'monthly')) {
      return [];
    }
    const rowId = XAI_PRIORITY_ROW_ID[billing.periodType];
    return [
      {
        rowId,
        remainingPercent: remainingFromUsed(billing.usagePercent),
        resetAtMs: resetOrNull(billing.resetAtMs),
        scope: scopeFor(provider, rowId),
        rankable: billing.periodType === 'weekly',
      },
    ];
  }

  return [];
}

/**
 * Where one credential stands:
 * - `usable`: `window` is the binding window and the credential ranks by its reset.
 * - `blocked`: `window` is an account-wide window at 0% that has not reset yet.
 * - `unknown`: nothing to rank on (not loaded, only scoped windows, no known reset).
 */
export type QuotaUsability =
  | { kind: 'usable'; window: QuotaPriorityWindow }
  | { kind: 'blocked'; window: QuotaPriorityWindow }
  | { kind: 'unknown' };

/** Apply the binding-window rule from the file header to one credential's windows. */
export function assessQuotaUsability(
  windows: readonly QuotaPriorityWindow[],
  nowMs: number
): QuotaUsability {
  const live = windows.filter(
    (window) =>
      window.scope === 'account' && (window.resetAtMs === null || window.resetAtMs > nowMs)
  );

  const exhausted = live.find(
    (window) => window.remainingPercent !== null && window.remainingPercent <= 0
  );
  if (exhausted) return { kind: 'blocked', window: exhausted };

  let binding: QuotaPriorityWindow | null = null;
  for (const window of live) {
    if (!window.rankable || window.remainingPercent === null || window.resetAtMs === null) {
      continue;
    }
    if (
      binding === null ||
      window.remainingPercent < (binding.remainingPercent as number) ||
      (window.remainingPercent === binding.remainingPercent &&
        (window.resetAtMs < (binding.resetAtMs as number) ||
          (window.resetAtMs === binding.resetAtMs && window.rowId < binding.rowId)))
    ) {
      binding = window;
    }
  }
  return binding ? { kind: 'usable', window: binding } : { kind: 'unknown' };
}

/** The binding window of a usable credential, or null when blocked or unknown. */
export function pickPriorityWindow(
  windows: readonly QuotaPriorityWindow[],
  nowMs: number
): QuotaPriorityWindow | null {
  const usability = assessQuotaUsability(windows, nowMs);
  return usability.kind === 'usable' ? usability.window : null;
}

/** Sort key for "Use first (soonest loss)": reset instant of the binding window, or null. */
export function priorityResetMs(
  provider: QuotaProviderType | null,
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

export interface PriorityRankedItem<T> {
  item: T;
  windows: QuotaPriorityWindow[];
  usability: QuotaUsability;
  /** True for exactly one item: the first, and only when it is usable. */
  useFirst: boolean;
}

/**
 * Rank credentials of any provider mix by which one to burn first.
 *
 * `read` maps an item to its provider and quota state, so callers keep their
 * own entry shape. Usable credentials come first by binding-window reset;
 * blocked and unknown ones follow in incoming order.
 */
export function rankByPriority<T>(
  items: readonly T[],
  read: (item: T) => { provider: QuotaProviderType | null; quota: unknown },
  nowMs: number
): PriorityRankedItem<T>[] {
  const assessed = items.map((item) => {
    const { provider, quota } = read(item);
    const windows = collectQuotaPriorityWindows(provider, quota);
    return { item, windows, usability: assessQuotaUsability(windows, nowMs) };
  });
  return sortByInstant(assessed, (entry) =>
    entry.usability.kind === 'usable' ? entry.usability.window.resetAtMs : null
  ).map((entry, position) => ({
    ...entry,
    useFirst: position === 0 && entry.usability.kind === 'usable',
  }));
}
