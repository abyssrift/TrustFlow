import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// How many days ahead the attention ribbon (TimelineStrip/TimelineDropdown
// on web, and the "Upcoming" list in the mobile Deadlines screen) looks for
// non-overdue tasks. Persisted per-device, same pattern as useNavBarPosition.
export const RIBBON_WINDOW_OPTIONS: { label: string; days: number }[] = [
  { label: '3d', days: 3 },
  { label: '1w', days: 7 },
  { label: '2w', days: 14 },
  { label: '1mo', days: 30 },
];
export const DEFAULT_RIBBON_WINDOW_DAYS = 7;

const STORAGE_KEY = 'attention_ribbon_window_days';

export function useAttentionRibbonWindow() {
  const [windowDays, setWindowDays] = useState<number>(DEFAULT_RIBBON_WINDOW_DAYS);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((v) => {
      const n = v ? Number(v) : NaN;
      if (RIBBON_WINDOW_OPTIONS.some((o) => o.days === n)) setWindowDays(n);
    });
  }, []);

  const setWindow = useCallback((days: number) => {
    setWindowDays(days);
    AsyncStorage.setItem(STORAGE_KEY, String(days));
  }, []);

  return { windowDays, setWindow };
}
