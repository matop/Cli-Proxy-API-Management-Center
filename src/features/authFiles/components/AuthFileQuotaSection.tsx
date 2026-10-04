/**
 * Quota block on an Auth Files card.
 *
 * Reads and writes the same useQuotaStore entry as the dashboard and the Quota
 * page. On mount it restores a persisted result still inside the TTL
 * (restoreQuotaFromSession), without network. A click is an explicit refresh
 * through useQuotaActions: it ignores the TTL but joins a fetch for the same
 * credential already in flight (quotaCache.fetchQuotaShared).
 */

import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuotaStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import { resolveQuotaErrorMessage } from '@/utils/quota';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import { isRuntimeOnlyAuthFile, type QuotaProviderType } from '@/features/authFiles/constants';
import { Button } from '@/components/ui/Button';
import { IconRefreshCw } from '@/components/ui/icons';
import { bindQuotaClasses } from '@/features/quota/types';
import { QUOTA_ADAPTERS, type QuotaCardState } from '@/features/quota/providers';
import { QuotaUpdatedHint } from '@/features/quota/components/QuotaUpdatedHint';
import { useQuotaActions } from '@/features/quota/hooks/useQuotaActions';
import { restoreQuotaFromSession } from '@/features/quota/hooks/useQuotaBatchLoader';
import styles from './AuthFileQuota.module.scss';

/** 认证文件卡片外衣：紧凑额度样式绑定成类型化契约（缺键在模块初始化即抛）。 */
const compactQuotaClasses = bindQuotaClasses(styles, 'AuthFileQuota.module.scss');

const assertNever = (value: never): never => {
  throw new Error(`Unsupported quota type: ${value}`);
};

export type AuthFileQuotaSectionProps = {
  file: AuthFileItem;
  quotaType: QuotaProviderType;
  disableControls: boolean;
};

export function AuthFileQuotaSection(props: AuthFileQuotaSectionProps) {
  const { file, quotaType, disableControls } = props;
  const { t } = useTranslation();
  const { resettingQuotaName, refreshQuota, resetQuota } = useQuotaActions(disableControls);
  const adapter = QUOTA_ADAPTERS[quotaType];
  const cacheKey = getQuotaCacheKey(file);
  const resettingQuota = resettingQuotaName === cacheKey;
  const runtimeOnly = isRuntimeOnlyAuthFile(file);

  const storedQuota = useQuotaStore((state) => {
    if (quotaType === 'antigravity')
      return state.antigravityQuota[cacheKey] as QuotaCardState | undefined;
    if (quotaType === 'claude') return state.claudeQuota[cacheKey] as QuotaCardState | undefined;
    if (quotaType === 'codex') return state.codexQuota[cacheKey] as QuotaCardState | undefined;
    if (quotaType === 'devin') return state.devinQuota[cacheKey] as QuotaCardState | undefined;
    if (quotaType === 'kimi') return state.kimiQuota[cacheKey] as QuotaCardState | undefined;
    if (quotaType === 'meta') return state.metaQuota[cacheKey] as QuotaCardState | undefined;
    if (quotaType === 'xai') return state.xaiQuota[cacheKey] as QuotaCardState | undefined;
    return assertNever(quotaType);
  });
  const quota = storedQuota;

  // No network: only a result another page persisted inside the TTL comes back.
  useEffect(() => {
    if (runtimeOnly || file.disabled) return;
    restoreQuotaFromSession([{ type: quotaType, file }]);
  }, [file, quotaType, runtimeOnly]);

  const refreshQuotaForFile = useCallback(() => {
    if (runtimeOnly) return;
    void refreshQuota(file, adapter);
  }, [adapter, file, refreshQuota, runtimeOnly]);

  const resetQuotaForFile = useCallback(() => {
    if (runtimeOnly) return;
    resetQuota(file, adapter);
  }, [adapter, file, resetQuota, runtimeOnly]);

  const quotaStatus = quota?.status ?? 'idle';
  const canRefreshQuota = !disableControls && !file.disabled && !resettingQuota;
  const canUseResetQuota = canRefreshQuota && quotaStatus !== 'loading';
  const showResetQuotaAction = quota !== undefined && Boolean(adapter.canResetQuota?.(quota));
  const resetQuotaAction =
    adapter.resetQuota && showResetQuotaAction ? (
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className={styles.quotaResetCreditButton}
        onClick={() => resetQuotaForFile()}
        disabled={!canUseResetQuota}
        loading={resettingQuota}
        title={t('codex_quota.reset_button')}
        aria-label={t('codex_quota.reset_button')}
      >
        {!resettingQuota && <IconRefreshCw size={14} />}
        {t('codex_quota.reset_button')}
      </Button>
    ) : undefined;
  const fetchedAtMs = quotaStatus === 'success' ? quota?.fetchedAtMs : undefined;
  const showActions =
    quotaStatus !== 'idle' &&
    (fetchedAtMs !== undefined || resetQuotaAction !== undefined || quotaType === 'devin');
  const quotaErrorMessage = resolveQuotaErrorMessage(
    t,
    quota?.errorStatus,
    quota?.error || t('common.unknown_error')
  );

  return (
    <div className={styles.quotaSection}>
      {quotaStatus === 'loading' ? (
        <div className={styles.quotaMessage}>{t(`${adapter.i18nPrefix}.loading`)}</div>
      ) : quotaStatus === 'idle' ? (
        <button
          type="button"
          className={`${styles.quotaMessage} ${styles.quotaMessageAction}`}
          onClick={refreshQuotaForFile}
          disabled={!canRefreshQuota}
        >
          {t(`${adapter.i18nPrefix}.idle`)}
        </button>
      ) : quotaStatus === 'error' ? (
        <div className={styles.quotaError}>
          {t(`${adapter.i18nPrefix}.load_failed`, {
            message: quotaErrorMessage,
          })}
        </div>
      ) : quota ? (
        <adapter.Body quota={quota} classes={compactQuotaClasses} />
      ) : (
        <div className={styles.quotaMessage}>{t(`${adapter.i18nPrefix}.idle`)}</div>
      )}
      {showActions && (
        <div className={styles.quotaCardActions}>
          {fetchedAtMs !== undefined && (
            <QuotaUpdatedHint fetchedAtMs={fetchedAtMs} className={styles.quotaUpdated} />
          )}
          {resetQuotaAction}
          {quotaType === 'devin' && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className={styles.quotaResetCreditButton}
              onClick={refreshQuotaForFile}
              disabled={!canRefreshQuota || quotaStatus === 'loading'}
              loading={quotaStatus === 'loading'}
              title={t('auth_files.quota_refresh_hint')}
            >
              {quotaStatus !== 'loading' && <IconRefreshCw size={14} />}
              {t('auth_files.quota_refresh_single')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
