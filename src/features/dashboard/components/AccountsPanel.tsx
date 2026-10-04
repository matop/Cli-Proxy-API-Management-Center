import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ResolvedTheme } from '@/types';
import { useNow } from '@/hooks/useNow';
import { formatDateTimeValue } from '@/utils/format';
import { formatRelativeInstant, resolveQuotaErrorMessage } from '@/utils/quota';
import {
  getAuthFileIcon,
  getThemeSurfaceIconBackground,
  getTypeLabel,
  isThemeSurfaceIconProvider,
} from '@/features/authFiles/constants';
import { updatedAgoInstant } from '@/features/quota/quotaCache';
import { rankByPriority, type QuotaPriorityWindow } from '@/features/quota/quotaPriority';
import type { DashboardAccount } from '../hooks/useDashboardQuota';
import { accountPlan, accountWindowLabel, quotaTone, shortAccountName } from '../accountDisplay';
import { Button } from '@/components/ui/Button';
import { Meter } from './Meter';
import styles from './AccountsPanel.module.scss';

interface AccountsPanelProps {
  accounts: DashboardAccount[];
  /** True until the credential list itself has loaded. */
  loading: boolean;
  /** Last failed credential list load (may be empty when unknown); null otherwise. */
  error: string | null;
  /** Reloads the credential list; the dashboard passes its header refresh. */
  onRetry: () => Promise<void> | void;
  resolvedTheme: ResolvedTheme;
}

export function AccountsPanel({
  accounts,
  loading,
  error,
  onRetry,
  resolvedTheme,
}: AccountsPanelProps) {
  const { t, i18n } = useTranslation();
  const [retrying, setRetrying] = useState(false);

  const retry = async () => {
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  };
  const now = useNow();
  const locale = i18n.resolvedLanguage;

  // Same ranking as the Quota page's "Use first" badge (quotaPriority.ts).
  const ranked = useMemo(
    () =>
      rankByPriority(
        accounts,
        (account) => ({ provider: account.provider, quota: account.quota }),
        now
      ),
    [accounts, now]
  );

  const windowLabel = (window: QuotaPriorityWindow) => {
    const label = accountWindowLabel(window);
    return 'text' in label ? label.text : t(label.labelKey, label.labelParams);
  };

  const resetText = (window: QuotaPriorityWindow) => {
    if (window.resetAtMs === null) return null;
    if (window.resetAtMs <= now) return t('dashboard.accounts_reset_passed');
    return t('dashboard.accounts_resets', {
      relative: formatRelativeInstant(window.resetAtMs, now, locale),
    });
  };

  const stateNote = (account: DashboardAccount, windowCount: number): string | null => {
    if (account.file.disabled) return t('dashboard.accounts_disabled_note');
    if (!account.provider) return t('dashboard.accounts_no_quota_api');
    const status = account.quota?.status ?? 'idle';
    if (status === 'idle' || status === 'loading') return t('dashboard.accounts_loading');
    if (status === 'error') {
      return t('dashboard.accounts_error', {
        message: resolveQuotaErrorMessage(
          t,
          account.quota?.errorStatus,
          account.quota?.error || t('common.unknown_error')
        ),
      });
    }
    return windowCount === 0 ? t('dashboard.accounts_no_windows') : null;
  };

  return (
    <section className={styles.panel} aria-labelledby="dashboard-accounts-title">
      <header className={styles.head}>
        <h2 id="dashboard-accounts-title" className={styles.title}>
          {t('dashboard.accounts_title')}
        </h2>
        <span className={styles.hint}>{t('dashboard.accounts_hint')}</span>
        <Link to="/quota" className={styles.headLink}>
          {t('dashboard.accounts_open_quota')}
        </Link>
      </header>

      {error !== null && accounts.length === 0 ? (
        <div className={`${styles.note} ${styles.listError}`} role="alert">
          <p className={styles.stateError}>
            {t('dashboard.accounts_list_error', {
              message: error || t('common.unknown_error'),
            })}
          </p>
          <Button type="button" variant="secondary" size="sm" loading={retrying} onClick={retry}>
            {t('dashboard.accounts_list_retry')}
          </Button>
        </div>
      ) : loading && accounts.length === 0 ? (
        <p className={styles.note}>{t('dashboard.accounts_list_loading')}</p>
      ) : accounts.length === 0 ? (
        <p className={styles.note}>{t('dashboard.health_empty')}</p>
      ) : (
        <ul className={styles.list}>
          {ranked.map(({ item: account, windows, usability, useFirst }) => {
            const burnWindowId = usability.kind === 'usable' ? usability.window.rowId : null;
            const file = account.file;
            const iconType = account.provider ?? String(file.type ?? file.provider ?? '');
            const iconSrc = getAuthFileIcon(iconType, resolvedTheme);
            const typeLabel = getTypeLabel(t, iconType);
            const plan = account.provider ? accountPlan(account.provider, account.quota) : null;
            const note = stateNote(account, windows.length);
            const status = account.quota?.status;
            const fetchedAtMs = status === 'success' ? account.quota?.fetchedAtMs : undefined;

            return (
              <li key={account.key}>
                <Link
                  to="/quota"
                  className={`${styles.row} ${useFirst ? styles.rowFirst : ''}`}
                  aria-busy={status === 'loading' || undefined}
                >
                  <div className={styles.identity}>
                    <span
                      className={styles.iconWrap}
                      title={typeLabel}
                      style={
                        isThemeSurfaceIconProvider(iconType)
                          ? { background: getThemeSurfaceIconBackground(resolvedTheme) }
                          : undefined
                      }
                    >
                      {iconSrc ? (
                        <img src={iconSrc} alt="" className={styles.icon} />
                      ) : (
                        <span className={styles.iconFallback} aria-hidden="true">
                          {typeLabel.slice(0, 1).toUpperCase()}
                        </span>
                      )}
                    </span>
                    <span className={styles.provider}>{typeLabel}</span>
                    <span className={styles.name} title={file.name}>
                      {shortAccountName(file)}
                    </span>
                    {plan && (
                      <span className={styles.plan}>
                        {'labelKey' in plan ? t(plan.labelKey) : plan.text}
                      </span>
                    )}
                    {useFirst && (
                      <span className={styles.useFirst}>{t('dashboard.accounts_use_first')}</span>
                    )}
                    {!file.disabled && file.unavailable && (
                      <span className={styles.badgeBad}>{t('dashboard.health_unavailable')}</span>
                    )}
                    {fetchedAtMs !== undefined && (
                      <span className={styles.hint}>
                        {t('quota_management.updated_relative', {
                          relative: formatRelativeInstant(
                            updatedAgoInstant(fetchedAtMs, now),
                            now,
                            locale
                          ),
                        })}
                      </span>
                    )}
                  </div>

                  {note ? (
                    <p
                      className={`${styles.stateNote} ${status === 'error' ? styles.stateError : ''}`}
                    >
                      {note}
                    </p>
                  ) : (
                    <ul className={styles.windows}>
                      {windows.map((window) => {
                        const tone = quotaTone(window.remainingPercent);
                        const label = windowLabel(window);
                        const reset = resetText(window);
                        return (
                          <li key={window.rowId} className={styles.window}>
                            <span className={styles.windowLabel} title={label}>
                              {label}
                            </span>
                            <Meter
                              value={window.remainingPercent}
                              tone={tone}
                              ariaLabel={label}
                              className={styles.windowMeter}
                            />
                            <span
                              className={`${styles.windowLeft} ${
                                tone === 'critical'
                                  ? styles.windowEmpty
                                  : tone === 'warning'
                                    ? styles.windowLow
                                    : ''
                              }`}
                            >
                              {window.remainingPercent === null
                                ? '—'
                                : t('dashboard.accounts_left', {
                                    percent: Math.round(window.remainingPercent),
                                  })}
                            </span>
                            <span
                              className={`${styles.windowReset} ${
                                window.rowId === burnWindowId ? styles.windowResetBurn : ''
                              }`}
                              title={
                                window.resetAtMs === null
                                  ? undefined
                                  : formatDateTimeValue(window.resetAtMs, locale)
                              }
                            >
                              {reset ?? '—'}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
