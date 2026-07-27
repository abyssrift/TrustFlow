import { useTheme } from '@/contexts/ThemeContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { cssInterop } from 'react-native-css-interop';
import Tooltip from '../common/Tooltip';
import { THEME_OPTIONS } from './constants';

cssInterop(FontAwesome, {
  className: {
    target: 'style',
    nativeStyleToProp: { color: true, size: true },
  },
} as any);

// Self-contained theme selector: trigger + anchored dropdown in one wrapper, so
// it opens on hover exactly like PinnedShortcuts' "+" picker (same mouseenter/
// mouseleave escape hatch + click-latch + outside-click close).
export default function ThemeButton() {
  const colors = useThemeColors();
  const { theme, setTheme } = useTheme();
  const [isHovered, setIsHovered] = useState(false);
  const [clickedOpen, setClickedOpen] = useState(false);
  const open = isHovered || clickedOpen;
  const wrapperRef = useRef<any>(null);

  useEffect(() => {
    const el = wrapperRef.current;
    const domNode = el instanceof Element ? el : (el as any)?.getDOMNode?.() ?? null;
    if (!domNode) return;
    const onEnter = () => setIsHovered(true);
    const onLeave = () => setIsHovered(false);
    domNode.addEventListener('mouseenter', onEnter);
    domNode.addEventListener('mouseleave', onLeave);
    return () => {
      domNode.removeEventListener('mouseenter', onEnter);
      domNode.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  useEffect(() => {
    if (!clickedOpen) return;
    const handleClick = (e: MouseEvent) => {
      const el = wrapperRef.current;
      const domNode = el instanceof Element ? el : (el as any)?.getDOMNode?.() ?? null;
      if (domNode && !domNode.contains(e.target as Node)) setClickedOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [clickedOpen]);

  return (
    <View ref={wrapperRef} style={{ position: 'relative', zIndex: open ? 100 : undefined }}>
      <Tooltip label="Display & theme" side="left">
        <Pressable
          onPress={() => setClickedOpen((v) => !v)}
          accessibilityLabel="Theme settings"
          className="h-9 w-9 items-center justify-center rounded-xl border border-surface-border bg-surface-card transition-all duration-200 ease-out hover:border-brand-primary/40 hover:bg-surface-overlay active:scale-95"
        >
          <FontAwesome name="paint-brush" size={14} color={colors.textDim} />
        </Pressable>
      </Tooltip>

      {/* top-9 + transparent pt-2 bridges the gap so hovering into the dropdown
          never fires the wrapper's mouseleave. Right-anchored under the button. */}
      <View
        pointerEvents={open ? 'auto' : 'none'}
        style={{
          opacity: open ? 1 : 0,
          transform: [{ scale: open ? 1 : 0.96 }, { translateY: open ? 0 : -6 }],
          zIndex: 100,
        }}
        className="absolute right-0 top-9 w-80 pt-2 transition-all duration-300 ease-in-out"
      >
        <View className="rounded-2xl border border-surface-border bg-surface-card/95 p-4 premium-shadow glass-card">
          <Text className="mb-3 px-1 text-[10px] font-black uppercase tracking-widest text-typography-dim">
            Display & Theme
          </Text>

          <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
            <View className="gap-1.5">
              {THEME_OPTIONS.map((option) => (
                <Pressable
                  key={option.id}
                  onPress={() => setTheme(option.id)}
                  className={`h-11 flex-row items-center rounded-xl border px-3 transition-all duration-150 ${theme === option.id
                    ? 'border-brand-primary bg-brand-primary/10'
                    : 'border-surface-border bg-surface-background/50 hover:bg-surface-overlay'
                    }`}
                >
                  <View className={`h-7 w-7 items-center justify-center rounded-lg ${theme === option.id ? 'bg-brand-primary/20' : 'bg-surface-overlay'}`}>
                    <FontAwesome name={option.icon} size={13} color={theme === option.id ? colors.primary : colors.textDim} />
                  </View>
                  <Text className={`ml-3 text-xs font-bold ${theme === option.id ? 'text-brand-primary' : 'text-typography-muted'}`}>{option.label}</Text>
                  {theme === option.id && (
                    <View className="ml-auto">
                      <FontAwesome name="check-circle" size={13} color={colors.primary} />
                    </View>
                  )}
                </Pressable>
              ))}
            </View>


          </ScrollView>
        </View>
      </View>
    </View>
  );
}
