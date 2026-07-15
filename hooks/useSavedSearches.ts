// Saved (pinned) searches for the TopBar dropdown — personal, client-only.
// Same AsyncStorage pattern as useRecentSearches; no gating (per-user, local).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'trustflow.savedSearches';
const MAX_SAVED = 12;

export function useSavedSearches() {
  const [saved, setSaved] = useState<string[]>([]);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setSaved(parsed.slice(0, MAX_SAVED));
      } catch { }
    });
  }, []);

  const persist = (next: string[]) => { AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)); return next; };

  const isSaved = useCallback((q: string) => saved.some((s) => s.toLowerCase() === q.trim().toLowerCase()), [saved]);

  const toggle = useCallback((query: string) => {
    const q = query.trim();
    if (!q) return;
    setSaved((prev) => prev.some((s) => s.toLowerCase() === q.toLowerCase())
      ? persist(prev.filter((s) => s.toLowerCase() !== q.toLowerCase()))
      : persist([q, ...prev].slice(0, MAX_SAVED)));
  }, []);

  return { saved, isSaved, toggle };
}
