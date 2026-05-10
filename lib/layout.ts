import { Platform } from 'react-native';
import type { ThemeType } from '@/contexts/ThemeContext';

// Base nav content height (56px). Add useSafeAreaInsets().bottom on top of this for iOS.
export const WEB_NAV_HEIGHT_BASE = 56;

export const BREAKPOINTS = {
  tablet: 768,
  desktop: 1024,
} as const;

export const TAB_BAR_HEIGHT = {
  ios: 88,
  android: 70,
  web: 70,
  // Convenience getter used on the native side
  get native() {
    return Platform.OS === 'ios' ? this.ios : this.android;
  },
} as const;

// Actual hex values extracted from global.css theme overrides.
// Used wherever CSS variables can't be used (native StyleSheet props,
// tab bar tint colors, React Navigation theme options).
export const NATIVE_THEME_COLORS: Record<
  ThemeType,
  { primary: string; muted: string; background: string; card: string }
> = {
  indigo: {
    primary: '#6366f1',
    muted: '#94a3b8',
    background: '#080d18',
    card: '#0f172a',
  },
  emerald: {
    primary: '#10b981',
    muted: '#6ee7b7',
    background: '#060907',
    card: '#0a0f0c',
  },
  amber: {
    primary: '#f59e0b',
    muted: '#fcd34d',
    background: '#0c0a09',
    card: '#1c1917',
  },
  amethyst: {
    primary: '#a855f7',
    muted: '#d8b4fe',
    background: '#0a0a0c',
    card: '#121216',
  },
  light: {
    primary: '#4f46e5',
    muted: '#475569',
    background: '#f8fafc',
    card: '#ffffff',
  },
  dark: {
    primary: '#a3a3a3',
    muted: '#737373',
    background: '#0a0a0a',
    card: '#171717',
  },
};
