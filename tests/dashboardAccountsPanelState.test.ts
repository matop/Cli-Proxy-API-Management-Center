/**
 * Accounts panel states for the credential list itself (not per-account quota).
 * AccountsPanel imports a CSS module; Bun resolves it to an empty class map, so
 * the markup renders without class names.
 */

import { beforeAll, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import { AccountsPanel } from '@/features/dashboard/components/AccountsPanel';

type PanelProps = Parameters<typeof AccountsPanel>[0];

const render = (props: Partial<PanelProps>) =>
  renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(AccountsPanel, {
        accounts: [],
        loading: false,
        error: null,
        onRetry: () => undefined,
        resolvedTheme: 'dark',
        ...props,
      } as PanelProps)
    )
  );

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

describe('AccountsPanel credential list states', () => {
  test('shows the loading note while the list is loading', () => {
    const html = render({ loading: true });
    expect(html).toContain('Loading credentials…');
    expect(html).not.toContain('Retry');
  });

  test('a failed list load shows the error and a retry button, not loading', () => {
    const html = render({ loading: false, error: 'Network Error' });
    expect(html).not.toContain('Loading credentials…');
    expect(html).toContain('Credentials failed to load: Network Error');
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>(<span>)?Retry/);
    expect(html).toContain('role="alert"');
  });
});
