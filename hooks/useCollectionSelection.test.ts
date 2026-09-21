import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';

import {
  addOrRemoveSelection,
  pruneSelection,
  selectAllVisible,
  selectRange,
  useCollectionSelection,
} from './useCollectionSelection';

function SelectionHarness({ onReady }: { onReady: (selection: ReturnType<typeof useCollectionSelection>) => void }) {
  const selection = useCollectionSelection({
    active: true,
    selectedIds: [],
    onActiveChange: () => {},
    onSelectedIdsChange: () => {},
  });
  onReady(selection);
  return null;
}

describe('collection selection controller', () => {
  it('toggles an id without clearing other selections', () => {
    expect(addOrRemoveSelection(['a', 'b'], 'b')).toEqual(['a']);
    expect(addOrRemoveSelection(['a'], 'c')).toEqual(['a', 'c']);
  });

  it('selects only the visible scope and toggles that scope off', () => {
    expect(selectAllVisible(['outside'], ['a', 'b'])).toEqual(['outside', 'a', 'b']);
    expect(selectAllVisible(['outside', 'a', 'b'], ['a', 'b'])).toEqual(['outside']);
  });

  it('prunes only when explicitly asked', () => {
    expect(pruneSelection(['a', 'missing', 'b'], ['a', 'b'])).toEqual(['a', 'b']);
  });

  it('selects an anchor-to-target range in visible order', () => {
    expect(selectRange(['a', 'b', 'c', 'd'], 'b', 'd')).toEqual(['b', 'c', 'd']);
    expect(selectRange(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['b', 'c', 'd']);
  });

  it('clears the anchor during the hook lifecycle', () => {
    let selection: ReturnType<typeof useCollectionSelection> | undefined;
    act(() => {
      TestRenderer.create(React.createElement(SelectionHarness, { onReady: value => { selection = value; } }));
    });

    act(() => selection?.enter('b'));
    expect(selection?.anchorId).toBe('b');

    act(() => selection?.clear());
    expect(selection?.anchorId).toBeNull();
  });

  it('keeps list, details, and stacked row wrappers relative to their indicators', () => {
    const source = readFileSync(fileURLToPath(String(new URL('../components/common/MultiViewList.tsx', import.meta.url))), 'utf8');
    const list = source.slice(source.indexOf('function ListBody'), source.indexOf('function ColumnCell'));
    const details = source.slice(source.indexOf('function DetailsTable'), source.indexOf('function DetailsStacked'));
    const stacked = source.slice(source.indexOf('function DetailsStacked'), source.indexOf('function SelectionIndicator'));

    expect(list).toMatch(/className=\{`relative px-4/);
    expect(details).toMatch(/className=\{`relative flex-row/);
    expect(stacked).toMatch(/className="relative bg-surface-card/);
  });
});
