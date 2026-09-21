import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(fileURLToPath(String(new URL('./GuideCoachPanel.tsx', import.meta.url))), 'utf8');

describe('GuideCoachPanel styling', () => {
  it('keeps the guide card light and its controls compact and accessible', () => {
    expect(source).toMatch(/bg-surface-card\/90/);
    expect(source).toMatch(/border-surface-border/);
    expect(source).not.toMatch(/shadow-lg|p-5/);
    expect(source).not.toMatch(/\{final \? 'Done' : 'Next'\}/);
    expect(source).not.toMatch(/bg-brand-primary px-4/);

    for (const label of ['Close guide', 'Skip for now', 'Previous guide step']) {
      expect(source).toContain(`accessibilityLabel="${label}"`);
    }
    expect(source).toMatch(/accessibilityLabel=\{final \? 'Finish guide' : 'Next guide step'\}/);
    expect(source).toMatch(/h-11 w-11/);
    expect(source).toMatch(/accessibilityState=\{\{ selected: final \}\}/);
    expect(source).toMatch(/name=\{final \? 'check' : 'arrow-right'\}/);
    expect(source).toMatch(/void nextStep\(\)/);
    expect(source).toMatch(/Tooltip label=\{final \? 'Finish guide' : 'Next step'\}/);
  });
});
