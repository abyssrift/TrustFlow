import { useTheme } from '@/contexts/ThemeContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { addAlpha } from '@/lib/layout';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { BlurView } from 'expo-blur';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

const H_PAD = 10;

export default function FloatingTabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  const colors = useThemeColors();
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const visibleRoutes = state.routes.filter(
    (r) => (descriptors[r.key].options.tabBarItemStyle as { display?: string } | undefined)?.display !== 'none'
  );
  const focusedRoute = state.routes[state.index];
  const activeIndex = visibleRoutes.findIndex((r) => r.key === focusedRoute.key);

  const [barWidth, setBarWidth] = useState(0);
  const slotWidth = barWidth > 0 ? (barWidth - H_PAD * 2) / visibleRoutes.length : 0;
  const indicatorX = useRef(new Animated.Value(0)).current;
  const indicatorOpacity = useRef(new Animated.Value(0)).current;
  const hasPositioned = useRef(false);

  useEffect(() => {
    if (slotWidth === 0) return;
    if (activeIndex >= 0) {
      if (!hasPositioned.current) {
        hasPositioned.current = true;
        indicatorX.setValue(activeIndex * slotWidth);
      } else {
        Animated.spring(indicatorX, { toValue: activeIndex * slotWidth, useNativeDriver: true, friction: 9, tension: 90 }).start();
      }
      Animated.timing(indicatorOpacity, { toValue: 1, duration: 150, useNativeDriver: true }).start();
    } else {
      Animated.timing(indicatorOpacity, { toValue: 0, duration: 150, useNativeDriver: true }).start();
    }
  }, [activeIndex, slotWidth, indicatorX, indicatorOpacity]);

  return (
    <View
      style={{
        position: 'absolute',
        left: 16,
        right: 16,
        bottom: Math.max(insets.bottom, Platform.OS === 'ios' ? 24 : 16),
        borderRadius: 28,
        shadowColor: '#000',
        shadowOpacity: 0.22,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 8 },
        elevation: 8,
      }}
    >
      {/* Shadow needs an un-clipped wrapper; the glass itself clips to the pill. */}
      <View style={{ borderRadius: 28, overflow: 'hidden' }} onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}>
        <BlurView intensity={70} tint={isLight ? 'light' : 'dark'} style={StyleSheet.absoluteFill} />
        {/* Liquid tint: a saturated wash over the blur, the same trick as the web bar's backdrop-filter saturate(). */}
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: addAlpha(colors.card, isLight ? 0.62 : 0.58) }]} />
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: addAlpha(colors.primary, 0.08) }]} />
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: H_PAD, paddingVertical: 10 }}>
          {slotWidth > 0 && (
            <Animated.View
              pointerEvents="none"
              style={{
                position: 'absolute',
                left: H_PAD,
                top: 8,
                bottom: 8,
                width: slotWidth,
                borderRadius: 20,
                backgroundColor: addAlpha(colors.primary, isLight ? 0.16 : 0.22),
                opacity: indicatorOpacity,
                transform: [{ translateX: indicatorX }],
              }}
            />
          )}
          {visibleRoutes.map((route) => {
            const { options } = descriptors[route.key];
            const isFocused = route.key === focusedRoute.key;
            const color = isFocused ? colors.primary : colors.muted;

            const onPress = () => {
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!isFocused && !event.defaultPrevented) {
                navigation.navigate(route.name, route.params);
              }
            };

            const badge = options.tabBarBadge;

            return (
              <Pressable
                key={route.key}
                onPress={onPress}
                style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 6 }}
              >
                <View>
                  {options.tabBarIcon?.({ focused: isFocused, color, size: 22 })}
                  {(badge || badge === 0) && (
                    <View
                      style={{
                        position: 'absolute', top: -4, right: -10, minWidth: 16, height: 16,
                        borderRadius: 8, paddingHorizontal: 3, backgroundColor: colors.danger,
                        alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      <Text style={{ fontSize: 9, fontWeight: '900', color: 'white', lineHeight: 11 }}>{badge}</Text>
                    </View>
                  )}
                </View>
                <Text style={{ fontSize: 10, fontWeight: '700', marginTop: 2, color }}>
                  {typeof options.title === 'string' ? options.title : route.name}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}
