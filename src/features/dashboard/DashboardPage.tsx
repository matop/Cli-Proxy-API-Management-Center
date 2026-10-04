import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore, useThemeStore } from '@/stores';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { formatDateValue, formatPercent } from '@/utils/format';
import { useDashboardOverview } from './hooks/useDashboardOverview';
import { useDashboardQuota } from './hooks/useDashboardQuota';
import { AccountsPanel } from './components/AccountsPanel';
import { Meter } from './components/Meter';
import { Sparkline } from './components/Sparkline';
import { ThroughputChart } from './components/ThroughputChart';
import { useRevealGroup, useRevealOnScroll } from '@/hooks/motion';
import {
  providerLabel,
  splitWindowMinutes,
  summarizeDashboardStatus,
  type MeterTone,
} from './utils';
import styles from './dashboard.module.scss';

const DASH = '—';

const STATUS_ACCENTS: Record<MeterTone, string> = {
  good: 'var(--viz-success)',
  warning: 'var(--amber-color)',
  critical: 'var(--viz-failure)',
  idle: 'var(--text-quaternary)',
};

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const serverVersion = useAuthStore((state) => state.serverVersion);
  const serverBuildDate = useAuthStore((state) => state.serverBuildDate);
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);

  const {
    connectionStatus,
    connected,
    config,
    counts,
    traffic,
    providers,
    credentials,
    authFiles,
    refresh,
  } = useDashboardOverview();

  const { accounts } = useDashboardQuota(authFiles, connected);

  useHeaderRefresh(refresh, connected);

  const trafficRef = useRevealOnScroll<HTMLElement>();
  const fleetRef = useRevealOnScroll<HTMLElement>();
  const detailRef = useRevealGroup<HTMLElement>();

  const windowLabel = useMemo(() => {
    if (traffic.windowMinutes <= 0) return DASH;
    const { hours, minutes } = splitWindowMinutes(traffic.windowMinutes);
    if (hours === 0) return t('dashboard.window_m', { minutes });
    if (minutes === 0) return t('dashboard.window_h', { hours });
    return t('dashboard.window_hm', { hours, minutes });
  }, [traffic.windowMinutes, t]);

  const routingStrategy = useMemo(() => {
    const raw = config?.routingStrategy?.trim() ?? '';
    if (!raw) return DASH;
    if (raw === 'round-robin') return t('basic_settings.routing_strategy_round_robin');
    if (raw === 'weighted-round-robin') {
      return t('basic_settings.routing_strategy_weighted_round_robin');
    }
    if (raw === 'fill-first') return t('basic_settings.routing_strategy_fill_first');
    return raw;
  }, [config?.routingStrategy, t]);

  const unknownProviderLabel = t('dashboard.provider_unknown');

  // Failures come from the bucketed rolling window (traffic.totalFailure), the
  // same source as the chart, not from the lifetime per-credential counters.
  const status = summarizeDashboardStatus({
    connectionStatus,
    unavailableCredentials: credentials?.unavailable ?? null,
    failuresInWindow: traffic.totalFailure,
  });
  const statusHeadline = status.headlineKey
    ? t(`dashboard.${status.headlineKey}`)
    : status.issues
        .map((issue) => t(`dashboard.${issue.key}`, { count: issue.count, window: windowLabel }))
        .join(' · ');

  const connectionLabel = t(
    connectionStatus === 'connected'
      ? 'common.connected'
      : connectionStatus === 'connecting'
        ? 'common.connecting'
        : 'common.disconnected'
  );
  const versionLabel = serverVersion ? `v${serverVersion.trim().replace(/^[vV]+/, '')}` : null;
  const statusMetaLine = [versionLabel, connectionLabel].filter(Boolean).join(' · ');

  const runtimeRows: Array<{ label: string; value: string; mono?: boolean }> = [
    { label: t('dashboard.runtime_routing'), value: routingStrategy },
    { label: t('dashboard.runtime_retry'), value: String(config?.requestRetry ?? 0) },
    {
      label: t('dashboard.stat_provider_keys'),
      value: counts.providerKeys === null ? DASH : counts.providerKeys.toLocaleString(),
    },
    {
      label: t('dashboard.stat_models'),
      value: counts.models === null ? DASH : counts.models.toLocaleString(),
    },
    {
      label: t('dashboard.runtime_management_keys'),
      value: counts.managementKeys === null ? DASH : String(counts.managementKeys),
    },
    { label: t('dashboard.runtime_version'), value: serverVersion?.trim() || DASH },
    {
      label: t('dashboard.runtime_build'),
      value: formatDateValue(serverBuildDate, i18n.language) || DASH,
    },
    { label: t('dashboard.runtime_proxy'), value: config?.proxyUrl?.trim() || DASH, mono: true },
  ];

  const runtimeToggles = config
    ? [
        { label: t('dashboard.runtime_debug'), on: Boolean(config.debug) },
        { label: t('dashboard.runtime_file_logging'), on: Boolean(config.loggingToFile) },
        { label: t('dashboard.runtime_request_log'), on: Boolean(config.requestLog) },
        { label: t('dashboard.runtime_ws_auth'), on: Boolean(config.wsAuth) },
        { label: t('dashboard.runtime_model_prefix'), on: Boolean(config.forceModelPrefix) },
      ]
    : [];

  return (
    <div className={styles.page}>
      {/* ---------- Status + accounts ---------- */}
      <section className={styles.top}>
        <div
          className={styles.statusLine}
          role="status"
          style={{ '--status-accent': STATUS_ACCENTS[status.tone] } as React.CSSProperties}
        >
          <i className={styles.statusDot} aria-hidden="true" />
          <h1 className={styles.statusHeadline}>{statusHeadline}</h1>
          <span className={styles.statusMeta}>{statusMetaLine}</span>
        </div>
        <AccountsPanel
          accounts={accounts}
          loading={connected && authFiles === null}
          resolvedTheme={resolvedTheme}
        />
      </section>

      {/* ---------- Traffic ---------- */}
      <section className={styles.section} ref={trafficRef}>
        <header className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>{t('dashboard.traffic_title')}</h2>
          <p className={styles.sectionDescription}>
            {t('dashboard.traffic_description', { window: windowLabel })}
          </p>
        </header>
        <div className={styles.panel}>
          <ThroughputChart traffic={traffic} />
        </div>
      </section>

      {/* ---------- Provider fleet ---------- */}
      <section className={styles.section} ref={fleetRef}>
        <header className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>{t('dashboard.fleet_title')}</h2>
          <p className={styles.sectionDescription}>{t('dashboard.fleet_description')}</p>
        </header>
        <div className={styles.panel}>
          {providers.length === 0 ? (
            <p className={styles.emptyNote}>{t('dashboard.fleet_empty')}</p>
          ) : (
            <ul className={styles.fleetList}>
              {providers.map((provider, index) => (
                <li key={provider.id} className={styles.fleetRow}>
                  <span className={styles.fleetRank} aria-hidden="true">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <div className={styles.fleetIdentity}>
                    <span className={styles.fleetName}>
                      {providerLabel(provider.id, unknownProviderLabel)}
                    </span>
                    <span className={styles.fleetMeta}>
                      {t('dashboard.fleet_credentials', { value: provider.credentials })}
                    </span>
                  </div>
                  <Sparkline
                    points={provider.buckets.map((bucket) => bucket.success + bucket.failed)}
                    ariaLabel={t('dashboard.fleet_spark_label', {
                      provider: providerLabel(provider.id, unknownProviderLabel),
                    })}
                    className={styles.fleetSpark}
                  />
                  <div className={styles.fleetNumbers}>
                    <span className={styles.fleetTotal}>{provider.total.toLocaleString()}</span>
                    <span className={styles.fleetTotalLabel}>{t('dashboard.fleet_requests')}</span>
                  </div>
                  <div className={styles.fleetRate}>
                    <span className={styles.fleetRateValue}>
                      {provider.successRate === null ? DASH : formatPercent(provider.successRate)}
                    </span>
                    <Meter
                      value={provider.successRate}
                      ariaLabel={t('dashboard.success_rate')}
                      className={styles.fleetMeter}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* ---------- Credential health + runtime ---------- */}
      <section className={styles.detailGrid} ref={detailRef}>
        <div className={styles.panel} data-reveal>
          <header className={styles.panelHead}>
            <h2 className={styles.panelTitle}>{t('dashboard.health_title')}</h2>
          </header>
          {!credentials || credentials.total === 0 ? (
            <p className={styles.emptyNote}>{t('dashboard.health_empty')}</p>
          ) : (
            <>
              <div className={styles.healthBar}>
                {credentials.active > 0 && (
                  <span
                    className={`${styles.healthSegment} ${styles.healthActive}`}
                    style={{ flexGrow: credentials.active }}
                  />
                )}
                {credentials.unavailable > 0 && (
                  <span
                    className={`${styles.healthSegment} ${styles.healthUnavailable}`}
                    style={{ flexGrow: credentials.unavailable }}
                  />
                )}
                {credentials.disabled > 0 && (
                  <span
                    className={`${styles.healthSegment} ${styles.healthDisabled}`}
                    style={{ flexGrow: credentials.disabled }}
                  />
                )}
              </div>
              <ul className={styles.healthLegend}>
                <li>
                  <i className={`${styles.healthKey} ${styles.healthActive}`} aria-hidden="true" />
                  {t('dashboard.health_active')}
                  <b>{credentials.active.toLocaleString()}</b>
                </li>
                <li>
                  <i
                    className={`${styles.healthKey} ${styles.healthUnavailable}`}
                    aria-hidden="true"
                  />
                  {t('dashboard.health_unavailable')}
                  <b>{credentials.unavailable.toLocaleString()}</b>
                </li>
                <li>
                  <i
                    className={`${styles.healthKey} ${styles.healthDisabled}`}
                    aria-hidden="true"
                  />
                  {t('dashboard.health_disabled')}
                  <b>{credentials.disabled.toLocaleString()}</b>
                </li>
              </ul>
              <div className={styles.typeBreakdown}>
                <span className={styles.typeBreakdownLabel}>{t('dashboard.health_by_type')}</span>
                <ul className={styles.typeList}>
                  {credentials.byType.map((entry) => (
                    <li key={entry.type} className={styles.typeChip}>
                      {providerLabel(entry.type, unknownProviderLabel)}
                      <b>{entry.count.toLocaleString()}</b>
                    </li>
                  ))}
                </ul>
              </div>
              <Link to="/auth-files" className={styles.panelLink}>
                {t('dashboard.health_link')}{' '}
                <span className={styles.linkArrow} aria-hidden="true">
                  →
                </span>
              </Link>
            </>
          )}
        </div>

        <div className={styles.panel} data-reveal>
          <header className={styles.panelHead}>
            <h2 className={styles.panelTitle}>{t('dashboard.runtime_title')}</h2>
          </header>
          <dl className={styles.specList}>
            {runtimeRows.map((row) => (
              <div key={row.label} className={styles.specRow}>
                <dt className={styles.specLabel}>{row.label}</dt>
                <dd className={`${styles.specValue} ${row.mono ? styles.specMono : ''}`}>
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
          {runtimeToggles.length > 0 && (
            <ul className={styles.toggleList}>
              {runtimeToggles.map((toggle) => (
                <li
                  key={toggle.label}
                  className={`${styles.togglePill} ${toggle.on ? styles.toggleOn : styles.toggleOff}`}
                >
                  {toggle.label}
                  <b>{toggle.on ? t('common.yes') : t('common.no')}</b>
                </li>
              ))}
            </ul>
          )}
          <Link to="/config" className={styles.panelLink}>
            {t('dashboard.runtime_link')}{' '}
            <span className={styles.linkArrow} aria-hidden="true">
              →
            </span>
          </Link>
        </div>
      </section>
    </div>
  );
}
