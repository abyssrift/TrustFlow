import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';

import { useTaskMultiSelect } from './useTaskMultiSelect';

function SelectionHarness({ onReady }: { onReady: (selection: ReturnType<typeof useTaskMultiSelect>) => void }) {
  const selection = useTaskMultiSelect();
  onReady(selection);
  return null;
}

describe('useTaskMultiSelect', () => {
  it('replaces multiple successful results atomically while staying in select mode', () => {
    let selection: ReturnType<typeof useTaskMultiSelect> | undefined;
    act(() => {
      TestRenderer.create(React.createElement(SelectionHarness, { onReady: value => { selection = value; } }));
    });

    act(() => selection?.enter('a'));
    act(() => selection?.toggle('b'));
    act(() => selection?.toggle('c'));
    act(() => selection?.replaceSelection(['c']));

    expect(selection?.selectedIds).toEqual(['c']);
    expect(selection?.active).toBe(true);
  });
});
