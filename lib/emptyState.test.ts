import { describe, expect, it } from 'vitest';

import { EMPTY_STATE_DEFAULTS } from './emptyState';

describe('EMPTY_STATE_DEFAULTS', () => {
  it('gives empty, denied, and unavailable surfaces distinct guidance', () => {
    expect(EMPTY_STATE_DEFAULTS.empty).toMatchObject({ icon: 'inbox', title: 'Nothing here yet' });
    expect(EMPTY_STATE_DEFAULTS.denied).toMatchObject({ icon: 'lock', title: "You don't have permission to view this" });
    expect(EMPTY_STATE_DEFAULTS.unavailable).toMatchObject({ icon: 'lock', title: 'Not available here' });
  });
});
