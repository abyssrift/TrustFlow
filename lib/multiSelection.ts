/** Pure, domain-neutral selection helpers for visible/loaded collection scope. */

export function addOrRemoveSelection(selectedIds: Iterable<string>, id: string): string[] {
  const next = new Set(selectedIds);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return Array.from(next);
}

export function selectAllVisible(selectedIds: Iterable<string>, visibleIds: Iterable<string>): string[] {
  const next = new Set(selectedIds);
  const visible = Array.from(new Set(visibleIds));
  const allVisibleSelected = visible.length > 0 && visible.every(id => next.has(id));

  for (const id of visible) {
    if (allVisibleSelected) next.delete(id);
    else next.add(id);
  }

  return Array.from(next);
}

/** Explicitly retain only IDs in the supplied valid scope. */
export function pruneSelection(selectedIds: Iterable<string>, validIds: Iterable<string>): string[] {
  const valid = new Set(validIds);
  return Array.from(new Set(selectedIds)).filter(id => valid.has(id));
}

/** Select the inclusive range in the caller-supplied visible ordering. */
export function selectRange(
  visibleIds: readonly string[],
  anchorId: string,
  targetId: string,
): string[] {
  const targetIndex = visibleIds.indexOf(targetId);
  if (targetIndex < 0) return [];

  const anchorIndex = visibleIds.indexOf(anchorId);
  if (anchorIndex < 0) return [targetId];

  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  return Array.from(new Set(visibleIds.slice(start, end + 1)));
}

/** Remove successful mutation IDs; failed and unreported IDs remain selected. */
export function reconcileMutationSelection(
  selectedIds: Iterable<string>,
  succeededIds: Iterable<string>,
): string[] {
  const succeeded = new Set(succeededIds);
  return Array.from(new Set(selectedIds)).filter(id => !succeeded.has(id));
}
