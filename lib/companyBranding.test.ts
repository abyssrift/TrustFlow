import { describe, expect, it } from 'vitest';

import { companyInitials } from './companyBranding';

describe('companyInitials', () => {
  it('uses the first two meaningful words in a company name', () => {
    expect(companyInitials('North Star Labs')).toBe('NS');
  });

  it('falls back to a neutral placeholder when a name is empty', () => {
    expect(companyInitials('   ')).toBe('CO');
  });
});
