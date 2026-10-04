import type { QuotaProviderType } from './providers/types';

/** tab 顺序 = 旧页五分区的纵向顺序，'全部' tab 下卡片也按此分组排列。 */
export const QUOTA_TAB_ORDER: readonly QuotaProviderType[] = [
  'claude',
  'antigravity',
  'codex',
  'xai',
  'kimi',
  'devin',
  'meta',
];

export type QuotaTabId = 'all' | QuotaProviderType;

/** 页级分页固定 20/页，同时把「刷新全部」的上游并发限制在 20。 */
export const QUOTA_PAGE_SIZE = 20;

/**
 * Card sort modes. The values are persisted (uiState.ts), so they never change;
 * only their labels do.
 * - priority: reset of the binding window, the account-wide window with the
 *   least quota left that is above 0% (quotaPriority.priorityResetMs). Blocked
 *   and unknown credentials sink. Default when nothing is stored.
 * - default: provider-grouped order.
 * - soonest: earliest upcoming reset of any row, account-wide or per-model,
 *   plus available Codex reset credits, whatever the quota left (Meta skips
 *   windows at 0% used) (resetSchedule.nextRecoveryMs).
 */
export const QUOTA_SORT_MODES = ['priority', 'default', 'soonest'] as const;

export type QuotaSortMode = (typeof QUOTA_SORT_MODES)[number];

/** Menu label per stored sort value. */
export const QUOTA_SORT_LABEL_KEYS: Record<QuotaSortMode, string> = {
  priority: 'quota_management.sort_priority',
  default: 'quota_management.sort_default',
  soonest: 'quota_management.sort_soonest',
};

/** Sort used when the session has no stored choice. */
export const DEFAULT_QUOTA_SORT_MODE: QuotaSortMode = 'priority';

/** 与 useRevealGroup 的 GROUP_MAX_TOTAL 一致：卡片级联总预算 360ms。 */
export const CARD_ENTRANCE_BUDGET_MS = 360;
