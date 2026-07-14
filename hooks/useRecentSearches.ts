// Recent searches for the TopBar dropdown. Mirrors usePinnedShortcuts: AsyncStorage,
// most-recent-first, deduped, capped. Web + native (AsyncStorage handles both).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'trustflow.recentSearches';
const MAX_RECENT = 8;

export function useRecentSearches() {
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setRecent(parsed.slice(0, MAX_RECENT));
      } catch { }
    });
  }, []);

  const push = useCallback((query: string) => {
    const q = query.trim();
    if (!q) return;
    setRecent((prev) => {
      const next = [q, ...prev.filter((p) => p.toLowerCase() !== q.toLowerCase())].slice(0, MAX_RECENT);
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const remove = useCallback((query: string) => {
    setRecent((prev) => {
      const next = prev.filter((p) => p !== query);
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setRecent([]);
    AsyncStorage.removeItem(STORAGE_KEY);
  }, []);

  return { recent, push, remove, clear };
}
