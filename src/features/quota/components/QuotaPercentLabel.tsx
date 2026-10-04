/**
 * `98% left` — the remaining percent of one quota row, labelled as remaining.
 *
 * At or below LOW_QUOTA_REMAINING_PERCENT the label takes the host's
 * `quotaPercentLow` class and its accessible name says the quota is low. The
 * displayed number is the caller's remaining percent, rounded to whole percent
 * unless `fractionDigits` keeps decimals (Devin reports fractional percents).
 */

import { useTranslation } from 'react-i18next';
import { isLowQuota } from '../quotaPriority';
import type { QuotaClassMap } from '../types';

export interface QuotaPercentLabelProps {
  /** Percent remaining, 0..100, or null when unknown. */
  remaining: number | null;
  classes: QuotaClassMap;
  /** Decimals to keep, trailing zeros dropped. Default 0 (whole percent). */
  fractionDigits?: number;
}

export function QuotaPercentLabel({
  remaining,
  classes,
  fractionDigits = 0,
}: QuotaPercentLabelProps) {
  const { t } = useTranslation();
  if (remaining === null) return <span className={classes.quotaPercent}>--</span>;

  const percent =
    fractionDigits > 0 ? Number(remaining.toFixed(fractionDigits)) : Math.round(remaining);
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
