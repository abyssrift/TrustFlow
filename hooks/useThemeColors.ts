import { useMemo } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import { NATIVE_THEME_COLORS } from '@/lib/layout';

export function useThemeColors() {
  const { theme } = useTheme();
  
  return useMemo(() => {
    return NATIVE_THEME_COLORS[theme];
  }, [theme]);
}
