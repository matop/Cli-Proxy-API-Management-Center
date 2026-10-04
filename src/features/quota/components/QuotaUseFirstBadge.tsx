/**
 * `Use first · resets in 1 day` on the row chosen by pickPriorityWindow.
 *
 * Renders only when the host opts in with a `quotaUseFirst` class, so hosts
 * that do not style it show nothing rather than loose text.
 */

import { useTranslation } from 'react-i18next';
import { formatRelativeInstant } from '@/utils/quota';
import type { QuotaClassMap } from '../types';

export interface QuotaUseFirstBadgeProps {
  resetAtMs: number;
  nowMs: number;
  classes: QuotaClassMap;
}

export function QuotaUseFirstBadge({ resetAtMs, nowMs, classes }: QuotaUseFirstBadgeProps) {
  const { t, i18n } = useTranslation();
  if (!classes.quotaUseFirst) return null;
  const relative = formatRelativeInstant(resetAtMs, nowMs, i18n.resolvedLanguage);
  return (
    <span className={classes.quotaUseFirst} title={t('quota_management.use_first_hint')}>
      {t('quota_management.use_first_badge', { relative })}
    </span>
  );
}
