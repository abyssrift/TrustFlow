import React, { createContext, useContext, useState, useEffect } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { vars } from 'nativewind';
import { NATIVE_THEME_COLORS } from '@/lib/layout';

export type ThemeType = 'indigo' | 'emerald' | 'amber' | 'amethyst' | 'light' | 'dark';

interface KanbanSettings {
  showPulse: boolean;
  showStageTotals: boolean;
  showAvatars: boolean;
  backgroundUrl: string | null;
  bgBlur: number;
  bgOverlay: number; // 0 to 1
  isVibrant: boolean;
}

interface ThemeContextType {
  theme: ThemeType;
  setTheme: (t: ThemeType) => void;
  kanban: KanbanSettings;
  updateKanban: (updates: Partial<KanbanSettings>) => void;
  themeVariables: any;
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const STORAGE_KEYS = {
  THEME: 'theme_choice',
  KANBAN: 'kanban_settings',
};

const DEFAULT_KANBAN: KanbanSettings = {
  showPulse: true,
  showStageTotals: true,
  showAvatars: true,
  backgroundUrl: null,
  bgBlur: 10,
  bgOverlay: 0.4,
  isVibrant: false,
};

// Helper to convert hex to RGB string for NativeWind variables
const hexToRgb = (hex: string) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r}, ${g}, ${b}`;
};

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<ThemeType>('light');
  const [kanban, setKanbanState] = useState<KanbanSettings>(DEFAULT_KANBAN);
  const [isLoading, setIsLoading] = useState(false);

  // Load selection
  useEffect(() => {
    const load = async () => {
      try {
        const savedTheme = await AsyncStorage.getItem(STORAGE_KEYS.THEME);
        const savedKanban = await AsyncStorage.getItem(STORAGE_KEYS.KANBAN);

        if (savedTheme) setThemeState(savedTheme as ThemeType);
        if (savedKanban) {
          const parsed = JSON.parse(savedKanban);
          if (parsed.backgroundUrl?.startsWith('blob:') || parsed.backgroundUrl?.startsWith('file:')) parsed.backgroundUrl = null;
          setKanbanState(parsed);
        }
      } catch (e) {
        console.error('Failed to load theme settings', e);
      }
    };
    load();
  }, []);

  // Sync to root attributes (Web only)
  useEffect(() => {
    if (Platform.OS === 'web') {
      const root = document.documentElement;
      root.setAttribute('data-theme', theme);
    }
  }, [theme]);

  const setTheme = (t: ThemeType) => {
    setThemeState(t);
    AsyncStorage.setItem(STORAGE_KEYS.THEME, t);
  };

  const updateKanban = (updates: Partial<KanbanSettings>) => {
    const newSettings = { ...kanban, ...updates };
    setKanbanState(newSettings);
    AsyncStorage.setItem(STORAGE_KEYS.KANBAN, JSON.stringify(newSettings));
  };

  // Generate NativeWind variables for the current theme
  const themeVariables = React.useMemo(() => {
    const colors = NATIVE_THEME_COLORS[theme];
    return vars({
      '--brand-primary': hexToRgb(colors.primary),
      '--brand-secondary': hexToRgb(colors.secondary),
      '--brand-accent': hexToRgb(colors.accent),
      '--surface-background': hexToRgb(colors.background),
      '--surface-card': hexToRgb(colors.card),
      '--surface-border': hexToRgb(colors.border),
      '--surface-overlay': hexToRgb(colors.card), // fallback
      '--text-main': hexToRgb(colors.textMain),
      '--text-muted': hexToRgb(colors.textMuted),
      '--text-dim': hexToRgb(colors.textDim),
      '--state-success': hexToRgb(colors.success),
      '--state-warning': hexToRgb(colors.warning),
      '--state-danger': hexToRgb(colors.danger),
      '--state-info': hexToRgb(colors.info),
    });
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ 
      theme, setTheme,
      kanban, updateKanban,
      themeVariables,
      isLoading, setIsLoading
    }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within ThemeProvider');
  return context;
};
