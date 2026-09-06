import { useCallback, useMemo, useState } from 'react';

// Issue #216 — batch/multi-select state for the Tasks board (desktop + adaptive).
// Deliberately dumb: this hook only tracks "which ids are selected" and "is
// select mode on". It knows nothing about task data, RPCs, or rendering —
// those live in BulkTaskActionBar / lib/bulkTaskActions.ts. Kept generic
// (task ids only) so both _tasks_desktop.tsx and _tasks_adaptive.tsx share
// one implementation instead of hand-rolling their own Set<string> state.
export function useTaskMultiSelect() {
  const [active, setActive] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  /** Long-press / toolbar entry: turn select mode on, optionally pre-selecting one card. */
  const enter = useCallback((initialId?: string) => {
    setActive(true);
    if (initialId) setSelected(new Set([initialId]));
  }, []);

  /** Exit select mode entirely and drop the selection (the bulk bar's ✕). */
  const exit = useCallback(() => {
    setActive(false);
    setSelected(new Set());
  }, []);

  /** Flip one id's membership. No-op on `active` — caller decides mode. */
  const toggle = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /**
   * Ctrl/Cmd+click a card on the normal (non-select-mode) board: starts a
   * batch straight away instead of requiring the toolbar toggle first.
   */
  const addFromModifierClick = useCallback((id: string) => {
    setActive(true);
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /** Marquee drag replaces the selection outright with whatever it currently overlaps. */
  const replaceFromMarquee = useCallback((ids: string[]) => {
    setSelected(new Set(ids));
  }, []);

  const isSelected = useCallback((id: string) => selected.has(id), [selected]);
  const selectedIds = useMemo(() => Array.from(selected), [selected]);

  return {
    active,
    selectedIds,
    count: selected.size,
    enter,
    exit,
    toggle,
    addFromModifierClick,
    replaceFromMarquee,
    isSelected,
  };
}

export type TaskMultiSelect = ReturnType<typeof useTaskMultiSelect>;
