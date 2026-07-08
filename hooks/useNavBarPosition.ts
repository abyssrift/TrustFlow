import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type NavPosition = 'top' | 'bottom';

const STORAGE_KEY = 'nav_bar_position';

// ponytail: single AsyncStorage-backed hook so web nav bar position stays in
// sync between the bar itself and the layout that pads content around it.
export function useNavBarPosition() {
  const [position, setPosition] = useState<NavPosition>('bottom');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((v) => {
      if (v === 'top' || v === 'bottom') setPosition(v);
    });
  }, []);

  const toggle = useCallback(() => {
    setPosition((prev) => {
      const next: NavPosition = prev === 'bottom' ? 'top' : 'bottom';
      AsyncStorage.setItem(STORAGE_KEY, next);
      return next;
    });
  }, []);

  return { position, toggle };
}
