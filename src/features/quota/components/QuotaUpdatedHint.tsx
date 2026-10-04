/**
 * `Updated 3 minutes ago` for a quota result stamped with `fetchedAtMs`
 * (quotaCache.fetchQuotaShared). Shared by the Quota page card and the Auth
 * Files quota section so both read the same instant the same way.
 */

import { useTranslation } from 'react-i18next';
import { useNow } from '@/hooks/useNow';
import { formatRelativeInstant } from '@/utils/quota';
import { updatedAgoInstant } from '../quotaCache';

export interface QuotaUpdatedHintProps {
  fetchedAtMs: number;
  className?: string;
}

export function QuotaUpdatedHint({ fetchedAtMs, className }: QuotaUpdatedHintProps) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  return (
    <span className={className}>
      {t('quota_management.updated_relative', {
        relative: formatRelativeInstant(
          updatedAgoInstant(fetchedAtMs, now),
          now,
          i18n.resolvedLanguage
        ),
      })}
    </span>
  );
}
