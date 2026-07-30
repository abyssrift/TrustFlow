import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';

/**
 * Shared board-picker state for the task board switcher.
 *
 * Both the desktop and adaptive task layouts used to carry their own copy of
 * this logic (favourites, recents, per-board task counts) against the same
 * AsyncStorage keys, and the two copies had drifted. This is the single source.
 *
 * The important invariant: **`orderedBoards` is stable**. Recency deliberately
 * does *not* feed into it. The keyboard shortcuts, the wheel-scroll handler and
 * the hover peek all cycle through `orderedBoards`, so if recency reordered it
 * then every switch would change what "next board" means — cycling forward
 * twice could land you back where you started. Recency is display-only, surfaced
 * through `recentBoards`.
 */

export const BOARD_PICKER_KEYS = {
  FAVORITE_BOARDS: '@TrustFlow_favorite_boards',
  RECENTLY_USED_BOARDS: '@TrustFlow_recently_used_boards',
  MY_DEFAULT: '@TrustFlow_my_default_pipeline',
  LAST_VISITED: '@TrustFlow_board_last_visited',
} as const;

const MAX_RECENTLY_USED = 5;

export type PickerBoard = {
  id: string;
  name: string;
  is_default?: boolean;
};

type RecentEntry = { id: string; timestamp: number };

export type UseBoardPickerResult<B extends PickerBoard> = {
  /** Stable cycle/display order: favourites first, then alphabetical. */
  orderedBoards: B[];
  /** `orderedBoards` filtered by `searchQuery`. */
  filteredBoards: B[];
  /** Recently used, resolved to live boards and pruned. Display-only. */
  recentBoards: B[];
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  favoriteBoardIds: Set<string>;
  toggleFavorite: (boardId: string) => void;
  myDefaultPipelineId: string | null;
  setMyDefault: (boardId: string) => void;
  taskCounts: Record<string, number>;
  newTaskCounts: Record<string, number>;
  /**
   * Record a visit. Only `explicit` visits (an actual pick from the switcher)
   * touch the recents list — cycling past a board with Ctrl+]/wheel would
   * otherwise flood all five slots with boards the user never wanted.
   */
  recordBoardVisit: (boardId: string, opts?: { explicit?: boolean }) => void;
  /** Neighbours in the stable order, wrapping around. */
  neighbours: { prev: B | null; next: B | null };
  /** Step through the stable order. Returns the board to switch to, or null. */
  getBoardAtOffset: (offset: number) => B | null;
};

export function useBoardPicker<B extends PickerBoard>(
  availableBoards: B[],
  currentBoardId: string | null | undefined,
): UseBoardPickerResult<B> {
  const [favoriteBoardIds, setFavoriteBoardIds] = useState<Set<string>>(new Set());
  const [recentEntries, setRecentEntries] = useState<RecentEntry[]>([]);
  const [myDefaultPipelineId, setMyDefaultPipelineId] = useState<string | null>(null);
  const [lastVisited, setLastVisited] = useState<Record<string, number>>({});
  const [taskCounts, setTaskCounts] = useState<Record<string, number>>({});
  const [newTaskCounts, setNewTaskCounts] = useState<Record<string, number>>({});
  const [searchQuery, setSearchQuery] = useState('');

  // Hydrate persisted state once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [favStr, recentStr, defaultId, visitedStr] = await Promise.all([
          AsyncStorage.getItem(BOARD_PICKER_KEYS.FAVORITE_BOARDS),
          AsyncStorage.getItem(BOARD_PICKER_KEYS.RECENTLY_USED_BOARDS),
          AsyncStorage.getItem(BOARD_PICKER_KEYS.MY_DEFAULT),
          AsyncStorage.getItem(BOARD_PICKER_KEYS.LAST_VISITED),
        ]);
        if (cancelled) return;
        setFavoriteBoardIds(new Set<string>(favStr ? JSON.parse(favStr) : []));
        setRecentEntries(recentStr ? JSON.parse(recentStr) : []);
        setMyDefaultPipelineId(defaultId);
        setLastVisited(visitedStr ? JSON.parse(visitedStr) : {});
      } catch {
        // Corrupt/unavailable storage just means we start from defaults.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Stable order. Favourites are user-driven and don't move on their own, so
  // unlike recency they're safe to sort by.
  const orderedBoards = useMemo(() => {
    return [...availableBoards].sort((a, b) => {
      const aFav = favoriteBoardIds.has(a.id) ? 0 : 1;
      const bFav = favoriteBoardIds.has(b.id) ? 0 : 1;
      if (aFav !== bFav) return aFav - bFav;
      return a.name.localeCompare(b.name);
    });
  }, [availableBoards, favoriteBoardIds]);

  const filteredBoards = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return orderedBoards;
    return orderedBoards.filter(b => b.name.toLowerCase().includes(q));
  }, [orderedBoards, searchQuery]);

  // Resolve recents against the live board list: entries are stored as
  // {id, timestamp} with no name, and boards that were deleted or that the user
  // lost access to must not keep occupying one of the five slots.
  const recentBoards = useMemo(() => {
    const byId = new Map(availableBoards.map(b => [b.id, b]));
    return recentEntries
      .map(e => byId.get(e.id))
      .filter((b): b is B => b !== undefined);
  }, [recentEntries, availableBoards]);

  // Drop stale recents from storage once the board list is known.
  useEffect(() => {
    if (availableBoards.length === 0 || recentEntries.length === 0) return;
    const live = new Set(availableBoards.map(b => b.id));
    const pruned = recentEntries.filter(e => live.has(e.id));
    if (pruned.length === recentEntries.length) return;
    setRecentEntries(pruned);
    AsyncStorage.setItem(BOARD_PICKER_KEYS.RECENTLY_USED_BOARDS, JSON.stringify(pruned)).catch(() => {});
  }, [availableBoards, recentEntries]);

  const toggleFavorite = useCallback((boardId: string) => {
    setFavoriteBoardIds(prev => {
      const next = new Set(prev);
      if (next.has(boardId)) next.delete(boardId);
      else next.add(boardId);
      AsyncStorage.setItem(BOARD_PICKER_KEYS.FAVORITE_BOARDS, JSON.stringify([...next])).catch(() => {});
      return next;
    });
  }, []);

  const setMyDefault = useCallback((boardId: string) => {
    setMyDefaultPipelineId(prev => {
      const next = prev === boardId ? null : boardId;
      if (next) AsyncStorage.setItem(BOARD_PICKER_KEYS.MY_DEFAULT, next).catch(() => {});
      else AsyncStorage.removeItem(BOARD_PICKER_KEYS.MY_DEFAULT).catch(() => {});
      return next;
    });
  }, []);

  const recordBoardVisit = useCallback((boardId: string, opts?: { explicit?: boolean }) => {
    const now = Date.now();

    setLastVisited(prev => {
      const next = { ...prev, [boardId]: now };
      AsyncStorage.setItem(BOARD_PICKER_KEYS.LAST_VISITED, JSON.stringify(next)).catch(() => {});
      return next;
    });

    if (!opts?.explicit) return;

    setRecentEntries(prev => {
      const next = [{ id: boardId, timestamp: now }, ...prev.filter(e => e.id !== boardId)]
        .slice(0, MAX_RECENTLY_USED);
      AsyncStorage.setItem(BOARD_PICKER_KEYS.RECENTLY_USED_BOARDS, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  // Task counts, plus "new since your last visit" counts. `lastVisited` is
  // persisted, so the new-task badge survives a reload instead of being dead on
  // every fresh load.
  const lastVisitedRef = useRef(lastVisited);
  lastVisitedRef.current = lastVisited;

  const boardIdsKey = useMemo(
    () => availableBoards.map(b => b.id).sort().join(','),
    [availableBoards],
  );

  useEffect(() => {
    if (!boardIdsKey) return;
    let cancelled = false;

    (async () => {
      try {
        const ids = boardIdsKey.split(',');
        const visited = lastVisitedRef.current;

        const results = await Promise.all(ids.map(async (id) => {
          const { count } = await supabase
            .from('tasks')
            .select('id', { count: 'exact', head: true })
            .eq('pipeline_id', id);

          const since = visited[id] || 0;
          let newCount = 0;
          if (since > 0) {
            const { count: n } = await supabase
              .from('tasks')
              .select('id', { count: 'exact', head: true })
              .eq('pipeline_id', id)
              .gt('created_at', new Date(since).toISOString());
            newCount = n || 0;
          }
          return { id, count: count || 0, newCount };
        }));

        if (cancelled) return;
        const counts: Record<string, number> = {};
        const newCounts: Record<string, number> = {};
        for (const r of results) {
          counts[r.id] = r.count;
          newCounts[r.id] = r.newCount;
        }
        setTaskCounts(counts);
        setNewTaskCounts(newCounts);
      } catch (e) {
        console.error('Failed to fetch board task counts:', e);
      }
    })();

    return () => { cancelled = true; };
    // Intentionally keyed on the board id set only — `lastVisited` is read via a
    // ref so recording a visit doesn't re-run the whole count fetch.
  }, [boardIdsKey]);

  // Keep counts live as tasks are created/deleted across any board.
  useEffect(() => {
    if (!boardIdsKey) return;

    const channel = supabase
      .channel(`board-task-counts-${Date.now()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tasks' }, (payload) => {
        const id = (payload.new as any).pipeline_id;
        setTaskCounts(prev => ({ ...prev, [id]: (prev[id] || 0) + 1 }));
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'tasks' }, (payload) => {
        const id = (payload.old as any).pipeline_id;
        setTaskCounts(prev => ({ ...prev, [id]: Math.max(0, (prev[id] || 0) - 1) }));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [boardIdsKey]);

  const getBoardAtOffset = useCallback((offset: number): B | null => {
    if (orderedBoards.length <= 1 || !currentBoardId) return null;
    const idx = orderedBoards.findIndex(b => b.id === currentBoardId);
    if (idx < 0) return null;
    const len = orderedBoards.length;
    return orderedBoards[(((idx + offset) % len) + len) % len] ?? null;
  }, [orderedBoards, currentBoardId]);

  const neighbours = useMemo(() => ({
    prev: getBoardAtOffset(-1),
    next: getBoardAtOffset(1),
  }), [getBoardAtOffset]);

  return {
    orderedBoards,
    filteredBoards,
    recentBoards,
    searchQuery,
    setSearchQuery,
    favoriteBoardIds,
    toggleFavorite,
    myDefaultPipelineId,
    setMyDefault,
    taskCounts,
    newTaskCounts,
    recordBoardVisit,
    neighbours,
    getBoardAtOffset,
  };
}
