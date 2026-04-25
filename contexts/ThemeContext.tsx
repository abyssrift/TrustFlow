import React, { createContext, useContext, useState, useEffect } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ThemeType = 'indigo' | 'emerald' | 'amber' | 'amethyst';
export type DensityType = 'compact' | 'normal' | 'comfort';
export type RoundnessType = 'sharp' | 'normal' | 'soft';

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
  density: DensityType;
  setDensity: (d: DensityType) => void;
  roundness: RoundnessType;
  setRoundness: (r: RoundnessType) => void;
  kanban: KanbanSettings;
  updateKanban: (updates: Partial<KanbanSettings>) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const STORAGE_KEYS = {
  THEME: 'theme_choice',
  DENSITY: 'density_choice',
  ROUNDNESS: 'roundness_choice',
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

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<ThemeType>('indigo');
  const [density, setDensityState] = useState<DensityType>('normal');
  const [roundness, setRoundnessState] = useState<RoundnessType>('normal');
  const [kanban, setKanbanState] = useState<KanbanSettings>(DEFAULT_KANBAN);

  // Load selection
  useEffect(() => {
    const load = async () => {
      try {
        const savedTheme = await AsyncStorage.getItem(STORAGE_KEYS.THEME);
        const savedDensity = await AsyncStorage.getItem(STORAGE_KEYS.DENSITY);
        const savedRoundness = await AsyncStorage.getItem(STORAGE_KEYS.ROUNDNESS);
        const savedKanban = await AsyncStorage.getItem(STORAGE_KEYS.KANBAN);

        if (savedTheme) setThemeState(savedTheme as ThemeType);
        if (savedDensity) setDensityState(savedDensity as DensityType);
        if (savedRoundness) setRoundnessState(savedRoundness as RoundnessType);
        if (savedKanban) setKanbanState(JSON.parse(savedKanban));
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
      root.setAttribute('data-density', density);
      root.setAttribute('data-roundness', roundness);
    }
  }, [theme, density, roundness]);

  const setTheme = (t: ThemeType) => {
    setThemeState(t);
    AsyncStorage.setItem(STORAGE_KEYS.THEME, t);
  };

  const setDensity = (d: DensityType) => {
    setDensityState(d);
    AsyncStorage.setItem(STORAGE_KEYS.DENSITY, d);
  };

  const setRoundness = (r: RoundnessType) => {
    setRoundnessState(r);
    AsyncStorage.setItem(STORAGE_KEYS.ROUNDNESS, r);
  };

  const updateKanban = (updates: Partial<KanbanSettings>) => {
    const newSettings = { ...kanban, ...updates };
    setKanbanState(newSettings);
    AsyncStorage.setItem(STORAGE_KEYS.KANBAN, JSON.stringify(newSettings));
  };

  return (
    <ThemeContext.Provider value={{ 
      theme, setTheme, 
      density, setDensity, 
      roundness, setRoundness, 
      kanban, updateKanban 
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
