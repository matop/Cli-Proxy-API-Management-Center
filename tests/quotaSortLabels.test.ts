/**
 * Sort menu labels: renamed texts, unchanged stored values.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';
import { QUOTA_SORT_LABEL_KEYS, QUOTA_SORT_MODES } from '@/features/quota/constants';
import { isQuotaSortMode } from '@/features/quota/uiState';

const LOCALES = ['en', 'zh-CN', 'zh-TW', 'ru'] as const;

const lookup = (locale: string, key: string): unknown =>
  key
    .split('.')
    .reduce<unknown>(
      (node, part) => (node as Record<string, unknown> | undefined)?.[part],
      JSON.parse(readFileSync(`src/i18n/locales/${locale}.json`, 'utf8'))
    );

describe('quota sort labels', () => {
  test('stored sort values are unchanged and still accepted', () => {
    expect([...QUOTA_SORT_MODES]).toEqual(['priority', 'default', 'soonest']);
    for (const mode of ['priority', 'default', 'soonest']) {
      expect(isQuotaSortMode(mode)).toBe(true);
    }
  });

  test('each stored value maps to its original translation key', () => {
    expect(QUOTA_SORT_LABEL_KEYS).toEqual({
      priority: 'quota_management.sort_priority',
      default: 'quota_management.sort_default',
      soonest: 'quota_management.sort_soonest',
    });
  });

  test('English names what each option sorts by', () => {
    expect(lookup('en', QUOTA_SORT_LABEL_KEYS.priority)).toBe('Use first (soonest loss)');
    expect(lookup('en', QUOTA_SORT_LABEL_KEYS.soonest)).toBe('Next reset (any limit)');
  });

  test.each(LOCALES)('%s has three distinct, non-empty labels', (locale) => {
    const labels = QUOTA_SORT_MODES.map((mode) => lookup(locale, QUOTA_SORT_LABEL_KEYS[mode]));
    for (const label of labels) {
      expect(typeof label).toBe('string');
      expect((label as string).length).toBeGreaterThan(0);
    }
    expect(new Set(labels).size).toBe(3);
  });
});
