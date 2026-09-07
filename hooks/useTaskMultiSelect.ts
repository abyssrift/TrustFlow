import { useCallback, useState } from 'react';

// Batch-select mode for the task board (issue #216). One instance per board
// screen; the card renderer reads `active` / `selected` and calls `toggle`,
// the toolbar toggles the mode, the bulk-action bar reads `ids`.
export function useTaskMultiSelect() {
  const [active, setActive] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  // Marquee (web) hands back the full hit list on every mouse-move — replace,
  // don't merge, so shrinking the rubber-band deselects.
  const replace = useCallback((ids: string[]) => setSelected(new Set(ids)), []);

  const clear = useCallback(() => setSelected(new Set()), []);

  const enter = useCallback((seedId?: string) => {
    setActive(true);
    setSelected(seedId ? new Set([seedId]) : new Set());
  }, []);

  const exit = useCallback(() => {
    setActive(false);
    setSelected(new Set());
  }, []);

  return { active, selected, ids: [...selected], toggle, replace, clear, enter, exit };
}
