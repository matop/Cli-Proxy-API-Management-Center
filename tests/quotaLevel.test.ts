/**
 * One remaining-percent scale for every quota bar: the Quota page's QuotaMeter
 * and the dashboard Accounts panel must put the same percent in the same band.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QuotaMeter } from '@/features/quota/components/QuotaMeter';
import { quotaLevel, type QuotaLevel } from '@/features/quota/quotaLevel';
import { bindQuotaClasses, QUOTA_CLASS_KEYS } from '@/features/quota/types';
import { quotaTone, type QuotaTone } from '@/features/dashboard/accountDisplay';

const classes = bindQuotaClasses(
  Object.fromEntries(QUOTA_CLASS_KEYS.map((key) => [key, key])),
  'test-host'
);

const meterFillClass = (percent: number | null): string => {
  const markup = renderToStaticMarkup(createElement(QuotaMeter, { percent, classes }));
  const match = markup.match(/class="quotaBarFill (\w+)"/);
  return match ? match[1] : '';
};

/** Quota page fill class and dashboard tone for each level. */
const EXPECTED: Record<QuotaLevel, { fill: string; tone: QuotaTone }> = {
  unknown: { fill: 'quotaBarFillMedium', tone: 'idle' },
  exhausted: { fill: 'quotaBarFillLow', tone: 'critical' },
  low: { fill: 'quotaBarFillLow', tone: 'warning' },
  medium: { fill: 'quotaBarFillMedium', tone: 'medium' },
  healthy: { fill: 'quotaBarFillHigh', tone: 'good' },
};

describe('quotaLevel', () => {
  test('bands: 0 exhausted, 1-10 low, 11-30 medium, above 30 healthy', () => {
    expect(quotaLevel(null)).toBe('unknown');
    expect(quotaLevel(0)).toBe('exhausted');
    expect(quotaLevel(-3)).toBe('exhausted');
    expect(quotaLevel(0.5)).toBe('low');
    expect(quotaLevel(4)).toBe('low');
    expect(quotaLevel(10)).toBe('low');
    expect(quotaLevel(10.5)).toBe('medium');
    expect(quotaLevel(30)).toBe('medium');
    expect(quotaLevel(30.5)).toBe('healthy');
    expect(quotaLevel(58)).toBe('healthy');
    expect(quotaLevel(100)).toBe('healthy');
  });

  test('a 58% window is healthy on both the Quota page and the dashboard', () => {
    expect(meterFillClass(58)).toBe('quotaBarFillHigh');
    expect(quotaTone(58)).toBe('good');
  });

  test.each([null, 0, 3, 10, 11, 25, 30, 31, 58, 69, 70, 100])(
    'QuotaMeter and the dashboard agree at %p percent left',
    (percent) => {
      const expected = EXPECTED[quotaLevel(percent)];
      expect(meterFillClass(percent)).toBe(expected.fill);
      expect(quotaTone(percent)).toBe(expected.tone);
    }
  );

  test('the Quota page bar colours match the dashboard meter colours', () => {
    const quotaCss = readFileSync('src/features/quota/components/QuotaBody.module.scss', 'utf8');
    const meter = readFileSync('src/features/dashboard/components/Meter.tsx', 'utf8');
    const fill = (name: string) =>
      quotaCss.match(new RegExp(`\\.${name} \\{\\s*background: ([^;]+);`))?.[1];
    const tone = (name: string) => meter.match(new RegExp(`${name}: '([^']+)'`))?.[1];

    expect(fill('quotaBarFillHigh')).toBe('var(--viz-success)');
    expect(tone('good')).toContain('var(--viz-success');
    expect(fill('quotaBarFillMedium')).toBe(tone('medium'));
    expect(fill('quotaBarFillLow')).toBe(tone('warning'));
  });
});
