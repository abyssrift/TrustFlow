import { useCallback, useMemo, useState } from 'react';
import {
  addOrRemoveSelection,
  pruneSelection,
  selectAllVisible,
  selectRange,
} from '@/lib/multiSelection';

export { addOrRemoveSelection, pruneSelection, selectAllVisible, selectRange } from '@/lib/multiSelection';

export type CollectionSelectionOptions = {
  active: boolean;
  selectedIds: Iterable<string>;
  onActiveChange: (active: boolean) => void;
  onSelectedIdsChange: (selectedIds: string[]) => void;
};

export function useCollectionSelection({
  active,
  selectedIds,
  onActiveChange,
  onSelectedIdsChange,
}: CollectionSelectionOptions) {
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedArray = useMemo(() => Array.from(selected), [selected]);

  const clear = useCallback(() => {
    onSelectedIdsChange([]);
    setAnchorId(null);
  }, [onSelectedIdsChange]);
  const exit = useCallback(() => {
    onActiveChange(false);
    onSelectedIdsChange([]);
    setAnchorId(null);
  }, [onActiveChange, onSelectedIdsChange]);
  const enter = useCallback((initialId?: string) => {
    onActiveChange(true);
    if (initialId) {
      onSelectedIdsChange(addOrRemoveSelection(selected, initialId));
      setAnchorId(initialId);
    }
  }, [onActiveChange, onSelectedIdsChange, selected]);
  const toggle = useCallback((id: string) => {
    onSelectedIdsChange(addOrRemoveSelection(selected, id));
    setAnchorId(id);
  }, [onSelectedIdsChange, selected]);
  const selectAll = useCallback((visibleIds: Iterable<string>) => {
    onSelectedIdsChange(selectAllVisible(selected, visibleIds));
  }, [onSelectedIdsChange, selected]);
  const prune = useCallback((validIds: Iterable<string>) => {
    onSelectedIdsChange(pruneSelection(selected, validIds));
  }, [onSelectedIdsChange, selected]);
  const range = useCallback((visibleIds: readonly string[], targetId: string, additive = false) => {
    const next = selectRange(visibleIds, anchorId ?? targetId, targetId);
    onSelectedIdsChange(additive ? Array.from(new Set([...selected, ...next])) : next);
    setAnchorId(targetId);
  }, [anchorId, onSelectedIdsChange, selected]);

  return {
    active,
    selectedIds: selectedArray,
    count: selected.size,
    anchorId,
    isSelected: (id: string) => selected.has(id),
    enter,
    exit,
    clear,
    toggle,
    selectAllVisible: selectAll,
    prune,
    selectRange: range,
  };
}

export type CollectionSelection = ReturnType<typeof useCollectionSelection>;
