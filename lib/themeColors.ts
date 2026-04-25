import { ThemeType } from '@/contexts/ThemeContext';

/**
 * Theme color palette system
 * Provides hex colors for icons and components based on the active theme
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

const THEME_COLORS: ThemeColorMap = {
  indigo: {
    primary: '#6366f1',      // indigo-500
    secondary: '#22c55e',    // green-500
    accent: '#fbbf24',       // amber-400
    danger: '#ef4444',       // red-500
    success: '#22c55e',      // green-500
    warning: '#f59e0b',      // amber-500
    info: '#3b82f6',         // blue-500
    muted: '#64748b',        // slate-500
    border: '#475569',       // slate-600
    overlay: '#94a3b8',      // slate-400
  },
  emerald: {
    primary: '#10b981',      // emerald-500
    secondary: '#3b82f6',    // blue-500
    accent: '#fbbf24',       // amber-400
    danger: '#ef4444',       // red-500
    success: '#10b981',      // emerald-500
    warning: '#f59e0b',      // amber-500
    info: '#3b82f6',         // blue-500
    muted: '#6b7280',        // gray-500
    border: '#4b5563',       // custom dark gray
    overlay: '#9ca3af',      // gray-400
  },
  amber: {
    primary: '#f59e0b',      // amber-500
    secondary: '#ec4899',    // pink-500
    accent: '#fbbf24',       // amber-400
    danger: '#ef4444',       // red-500
    success: '#22c55e',      // green-500
    warning: '#f59e0b',      // amber-500
    info: '#3b82f6',         // blue-500
    muted: '#78716c',        // stone-500
    border: '#5f5955',       // stone-600
    overlay: '#a8a29e',      // stone-400
  },
  amethyst: {
    primary: '#a855f7',      // purple-500
    secondary: '#22c55e',    // green-500
    accent: '#fbbf24',       // amber-400
    danger: '#ef4444',       // red-500
    success: '#22c55e',      // green-500
    warning: '#f59e0b',      // amber-500
    info: '#3b82f6',         // blue-500
    muted: '#6b7280',        // gray-500
    border: '#4b5563',       // gray-600
    overlay: '#9ca3af',      // gray-400
  },
};

/**
 * Get a theme color by name
 * @param theme - Active theme
 * @param colorName - Color property name
 * @returns Hex color string
 */
export function getThemeColor(theme: ThemeType, colorName: keyof typeof THEME_COLORS.indigo): string {
  return THEME_COLORS[theme][colorName];
}

/**
 * Convenience function to get primary brand color for current theme
 */
export function getPrimaryColor(theme: ThemeType): string {
  return THEME_COLORS[theme].primary;
}

/**
 * Convenience function to get secondary color for current theme
 */
export function getSecondaryColor(theme: ThemeType): string {
  return THEME_COLORS[theme].secondary;
}

/**
 * Convenience function to get accent color for current theme
 */
export function getAccentColor(theme: ThemeType): string {
  return THEME_COLORS[theme].accent;
}

/**
 * Convenience function to get muted/secondary text color for current theme
 */
export function getMutedColor(theme: ThemeType): string {
  return THEME_COLORS[theme].muted;
}

/**
 * Convenience function to get success state color for current theme
 */
export function getSuccessColor(theme: ThemeType): string {
  return THEME_COLORS[theme].success;
}

/**
 * Convenience function to get warning state color for current theme
 */
export function getWarningColor(theme: ThemeType): string {
  return THEME_COLORS[theme].warning;
}

/**
 * Convenience function to get danger state color for current theme
 */
export function getDangerColor(theme: ThemeType): string {
  return THEME_COLORS[theme].danger;
}

/**
 * Convenience function to get info state color for current theme
 */
export function getInfoColor(theme: ThemeType): string {
  return THEME_COLORS[theme].info;
}

/**
 * Convenience function to get border color for current theme
 */
export function getBorderColor(theme: ThemeType): string {
  return THEME_COLORS[theme].border;
}

/**
 * Convenience function to get overlay color for current theme
 */
export function getOverlayColor(theme: ThemeType): string {
  return THEME_COLORS[theme].overlay;
}

