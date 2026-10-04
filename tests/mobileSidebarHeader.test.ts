import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const layout = readFileSync('src/styles/layout.scss', 'utf8');
const mobileStart = layout.indexOf('@media (max-width: $breakpoint-mobile) {\n  :root {');
const mobile = layout.slice(mobileStart);

describe('mobile sidebar header', () => {
  test('the open drawer starts its brand below the floating toolbar row', () => {
    expect(mobileStart).toBeGreaterThan(-1);
    // Outer width of .mobile-sidebar-actions: control plus 5px padding and 1px border per side.
    expect(mobile).toMatch(/--mobile-toggle-box: calc\(var\(--floating-control-size\) \+ 12px\);/);
    const header = mobile.match(
      /\.sidebar-header,\s*&\.collapsed \.sidebar-header\s*\{([^}]*)\}/
    )?.[1];
    expect(header).toBeDefined();
    expect(header).toContain('padding-top: calc(var(--shell-gutter) + var(--mobile-toggle-box)');
  });
});
