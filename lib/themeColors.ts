import { ThemeType } from '@/contexts/ThemeContext';
import { Platform } from 'react-native';
import { NATIVE_THEME_COLORS } from '@/lib/layout';

/**
 * Theme color palette system
 * Provides semantic tokens for icons and components
 * These rely on CSS variables defined in global.css on web,
 * and NATIVE_THEME_COLORS on native.
 */

type ThemeColorMap = {
  [key in ThemeType]: {
    primary: string;
    secondary: string;
    accent: string;
    danger: string;
    success: string;
    warning: string;
    info: string;
    muted: string;
    border: string;
    overlay: string;
  };
};

const SEMANTIC_MAP = {
  primary: 'var(--color-primary)',
  secondary: 'var(--color-secondary)',
  accent: 'var(--color-accent)',
  danger: 'var(--color-danger)',
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  info: 'var(--color-info)',
  muted: 'var(--color-text-muted)',
  border: 'var(--color-border)',
  overlay: 'rgb(var(--surface-overlay))',
};

const buildThemeColors = (theme: ThemeType) => {
  if (Platform.OS === 'web') {
    return { ...SEMANTIC_MAP };
  } else {
    const colors = NATIVE_THEME_COLORS[theme];
    return {
      primary: colors.primary,
      secondary: colors.secondary,
      accent: colors.accent,
      danger: colors.danger,
      success: colors.success,
      warning: colors.warning,
      info: colors.info,
      muted: colors.textMuted,
      border: colors.border,
      overlay: colors.card,
    };
  }
};

export const THEME_COLORS: ThemeColorMap = {
  indigo: buildThemeColors('indigo'),
  emerald: buildThemeColors('emerald'),
  amber: buildThemeColors('amber'),
  amethyst: buildThemeColors('amethyst'),
  light: buildThemeColors('light'),
  dark: buildThemeColors('dark'),
};

/**
 * Get a theme color by name using semantic tokens
 * @param theme - Active theme
 * @param colorName - Color property name
 * @returns Semantic color string
 */
export function getThemeColor(theme: ThemeType, colorName: keyof typeof THEME_COLORS.indigo): string {
  return THEME_COLORS[theme][colorName];
}

/**
 * Convenience functions to get colors for current theme
 */
export function getPrimaryColor(theme: ThemeType): string {
  return THEME_COLORS[theme].primary;
}

export function getSecondaryColor(theme: ThemeType): string {
  return THEME_COLORS[theme].secondary;
}

export function getAccentColor(theme: ThemeType): string {
  return THEME_COLORS[theme].accent;
}

export function getMutedColor(theme: ThemeType): string {
  return THEME_COLORS[theme].muted;
}

export function getSuccessColor(theme: ThemeType): string {
  return THEME_COLORS[theme].success;
}

export function getWarningColor(theme: ThemeType): string {
  return THEME_COLORS[theme].warning;
}

export function getDangerColor(theme: ThemeType): string {
  return THEME_COLORS[theme].danger;
}

export function getInfoColor(theme: ThemeType): string {
  return THEME_COLORS[theme].info;
}

export function getBorderColor(theme: ThemeType): string {
  return THEME_COLORS[theme].border;
}

export function getOverlayColor(theme: ThemeType): string {
  return THEME_COLORS[theme].overlay;
}
