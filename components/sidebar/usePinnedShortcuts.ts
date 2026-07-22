import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { MAX_PINNED_SHORTCUTS, PinnedShortcut } from './constants';

const STORAGE_KEY = 'topbar_pinned_shortcuts';

export function usePinnedShortcuts() {
  const [pinned, setPinned] = useState<PinnedShortcut[]>([]);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setPinned(parsed.slice(0, MAX_PINNED_SHORTCUTS));
      } catch { }
    });
  }, []);

  const isPinned = useCallback((id: string) => pinned.some((p) => p.id === id), [pinned]);

  const togglePin = useCallback((item: PinnedShortcut) => {
    setPinned((prev) => {
      const exists = prev.some((p) => p.id === item.id);
      const next = exists
        ? prev.filter((p) => p.id !== item.id)
        : prev.length >= MAX_PINNED_SHORTCUTS
          ? prev
          : [...prev, item];
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return { pinned, isPinned, togglePin, maxPinned: MAX_PINNED_SHORTCUTS };
}
