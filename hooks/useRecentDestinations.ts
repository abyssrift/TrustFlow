// Ring buffer (localStorage, web-only) of the last 8 places opened *from the
// command palette* — both GO TO pages and entity search results. Sorted
// frequent-first then most-recent, so the palette's RECENT section surfaces the
// places you actually keep coming back to, not just the last thing you touched.
// Model: hooks/useRecentSearches.ts (that one stays plain most-recent-first for
// query strings; this one weights by frequency because destinations are re-hit).
import { useCallback, useEffect, useState } from 'react';
import type { IconName } from '@/components/sidebar/constants';

const STORAGE_KEY = 'trustflow.recentDestinations';
const MAX = 8;

export type RecentDestination = {
  id: string;
  label: string;
  href: string;
  icon: IconName;
  parentLabel?: string;
  kind: 'page' | 'result';
  count: number;
  lastAt: number;
};

export type RecordableDestination = Omit<RecentDestination, 'count' | 'lastAt'>;

// Pure: fold a freshly-opened destination into the list — dedupe by href (bump
// count + lastAt, keep the newest label/icon), then sort frequent-first then
// recent, then cap at MAX. Exported for useRecentDestinations.check.ts.
export function foldRecent(
  list: RecentDestination[],
  next: RecordableDestination,
  now: number
): RecentDestination[] {
  const prev = list.find((d) => d.href === next.href);
  const merged: RecentDestination = { ...next, count: (prev?.count ?? 0) + 1, lastAt: now };
  return [merged, ...list.filter((d) => d.href !== next.href)]
    .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt)
    .slice(0, MAX);
}

function read(): RecentDestination[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    // Stored value is always written sorted; slice guards a hand-edited blob.
    return Array.isArray(parsed) ? parsed.slice(0, MAX) : [];
  } catch {
    return []; // private windows / storage disabled
  }
}

export function useRecentDestinations() {
  const [recent, setRecent] = useState<RecentDestination[]>([]);

  useEffect(() => {
    setRecent(read());
  }, []);

  const record = useCallback((dest: RecordableDestination) => {
    setRecent((prev) => {
      const next = foldRecent(prev, dest, Date.now());
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore — the in-memory list still updates for this session
      }
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setRecent([]);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  return { recent, record, clear };
}
