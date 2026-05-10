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
  { 
    primary: string; 
    secondary: string;
    accent: string;
    muted: string; 
    background: string; 
    card: string;
    border: string;
    textMain: string;
    textMuted: string;
    textDim: string;
    success: string;
    warning: string;
    danger: string;
    info: string;
  }
> = {
  indigo: {
    primary: '#6366f1',
    secondary: '#a855f7',
    accent: '#fbbf24',
    muted: '#94a3b8',
    background: '#080d18',
    card: '#0f172a',
    border: '#334155',
    textMain: '#f8fafc',
    textMuted: '#94a3b8',
    textDim: '#64728b',
    success: '#22c55e',
    warning: '#fbbf24',
    danger: '#ef4444',
    info: '#3b82f6',
  },
  emerald: {
    primary: '#10b981',
    secondary: '#14b8a6',
    accent: '#bef264',
    muted: '#6ee7b7',
    background: '#060907',
    card: '#0a0f0c',
    border: '#166534',
    textMain: '#ecfdf5',
    textMuted: '#6ee7b7',
    textDim: '#34d399',
    success: '#22c55e',
    warning: '#fbbf24',
    danger: '#ef4444',
    info: '#3b82f6',
  },
  amber: {
    primary: '#f59e0b',
    secondary: '#fbbf24',
    accent: '#0ea5e9',
    muted: '#fcd34d',
    background: '#0c0a09',
    card: '#1c1917',
    border: '#78716c',
    textMain: '#fffbeb',
    textMuted: '#fcd34d',
    textDim: '#d97706',
    success: '#22c55e',
    warning: '#fbbf24',
    danger: '#ef4444',
    info: '#3b82f6',
  },
  amethyst: {
    primary: '#a855f7',
    secondary: '#c084fc',
    accent: '#22d1ee',
    muted: '#d8b4fe',
    background: '#0a0a0c',
    card: '#121216',
    border: '#6b21a8',
    textMain: '#faf5ff',
    textMuted: '#d8b4fe',
    textDim: '#a855f7',
    success: '#22c55e',
    warning: '#fbbf24',
    danger: '#ef4444',
    info: '#3b82f6',
  },
  light: {
    primary: '#4f46e5',
    secondary: '#7c3aed',
    accent: '#f59e0b',
    muted: '#475569',
    background: '#f8fafc',
    card: '#ffffff',
    border: '#e2e3e6',
    textMain: '#0f172a',
    textMuted: '#475569',
    textDim: '#64728b',
    success: '#16a34a',
    warning: '#ca8a04',
    danger: '#dc2626',
    info: '#2563eb',
  },
  dark: {
    primary: '#a3a3a3',
    secondary: '#737373',
    accent: '#3b82f6',
    muted: '#737373',
    background: '#0a0a0a',
    card: '#171717',
    border: '#262626',
    textMain: '#fafafa',
    textMuted: '#a3a3a3',
    textDim: '#737373',
    success: '#22c55e',
    warning: '#fbbf24',
    danger: '#ef4444',
    info: '#3b82f6',
  },
};
// Helper to add alpha to hex colors
export const addAlpha = (hex: string, opacity: number) => {
  const op = Math.round(opacity * 255).toString(16).padStart(2, '0');
  return `${hex}${op}`;
};
