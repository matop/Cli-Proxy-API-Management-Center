/**
 * `98% left` — the remaining percent of one quota row, labelled as remaining.
 *
 * At or below LOW_QUOTA_REMAINING_PERCENT the label takes the host's
 * `quotaPercentLow` class and its accessible name says the quota is low. The
 * displayed number is the caller's remaining percent, rounded as before.
 *
 * At 0% (quotaLevel 'exhausted') the window is blocked until reset: the label
 * reads "Exhausted" and takes `quotaPercentEmpty`, falling back to
 * `quotaPercentLow` in hosts without it.
 */

import { useTranslation } from 'react-i18next';
import { quotaLevel } from '../quotaLevel';
import { isLowQuota } from '../quotaPriority';
import type { QuotaClassMap } from '../types';

export interface QuotaPercentLabelProps {
  /** Percent remaining, 0..100, or null when unknown. */
  remaining: number | null;
  classes: QuotaClassMap;
}

export function QuotaPercentLabel({ remaining, classes }: QuotaPercentLabelProps) {
  const { t } = useTranslation();
  if (remaining === null) return <span className={classes.quotaPercent}>--</span>;

  if (quotaLevel(remaining) === 'exhausted') {
    const emptyClass = classes.quotaPercentEmpty ?? classes.quotaPercentLow;
    return (
      <span
        className={emptyClass ? `${classes.quotaPercent} ${emptyClass}` : classes.quotaPercent}
        aria-label={t('quota_management.percent_exhausted_aria')}
      >
        {t('quota_management.percent_exhausted')}
      </span>
    );
  }

  const percent = Math.round(remaining);
  const low = isLowQuota(remaining);
  const className =
    low && classes.quotaPercentLow
      ? `${classes.quotaPercent} ${classes.quotaPercentLow}`
      : classes.quotaPercent;

  return (
    <span
      className={className}
      aria-label={t(
        low ? 'quota_management.percent_left_low_aria' : 'quota_management.percent_left_aria',
        { percent }
      )}
    >
      {t('quota_management.percent_left', { percent })}
    </span>
  );
}
