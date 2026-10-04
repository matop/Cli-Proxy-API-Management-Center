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
 * 卡片排序：priority = 有剩余额度且最快重置的窗口优先（未选择时的默认）；
 * default = provider 分组序；soonest = 最快恢复优先。
 * 'default' 与 'soonest' 是已持久化的取值，保持有效。
 */
export const QUOTA_SORT_MODES = ['priority', 'default', 'soonest'] as const;

export type QuotaSortMode = (typeof QUOTA_SORT_MODES)[number];

/** Sort used when the session has no stored choice. */
export const DEFAULT_QUOTA_SORT_MODE: QuotaSortMode = 'priority';

/** 与 useRevealGroup 的 GROUP_MAX_TOTAL 一致：卡片级联总预算 360ms。 */
export const CARD_ENTRANCE_BUDGET_MS = 360;
