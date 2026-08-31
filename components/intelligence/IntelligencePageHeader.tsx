import React, { useState } from 'react';
import { Text, View } from 'react-native';
import Animated, { interpolate, useAnimatedStyle } from 'react-native-reanimated';
import { useCollapseProgress } from '@/hooks/useCollapsibleHeader';

// The fixed page header every Intelligence desktop page repeated by hand — an
// `px-10` border-b container with an "Intelligence Hub" eyebrow + a
// `text-4xl font-black` title, then a page-specific controls cluster, sitting
// above a `flex-1` ScrollView. One component now, with the #308 scroll-linked
// collapse baked in. Must render inside a <CollapsibleHeaderProvider>.
//
// Theme + motion are done the way every other header in the app does it (see
// components/task-detail/TaskHeader.tsx): the title is a PLAIN <Text> carrying
// the `text-typography-main` class so it picks up the theme token. NativeWind's
// className colour does NOT resolve on `Animated.Text` on this web build — it
// renders RNW-default black — so motion goes on an <Animated.View> wrapper
// (scale + left transformOrigin), never on the Text itself. The eyebrow /
// subtitle collapse via measured height; the container padding tightens.
export default function IntelligencePageHeader({
  eyebrow,
  title,
  subtitle,
  right,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  const collapse = useCollapseProgress();
  const [eyebrowH, setEyebrowH] = useState(0);
  const [subH, setSubH] = useState(0);

  // Rest values also hard-set as a static style below — an animated-only
  // paddingTop can lag a frame before `collapse` is first written on this web
  // build, which reads as "no header padding" on the first paint.
  const padStyle = useAnimatedStyle(() => ({
    paddingTop: interpolate(collapse.value, [0, 1], [32, 12]),
    paddingBottom: interpolate(collapse.value, [0, 1], [24, 12]),
  }));
  const titleScaleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(collapse.value, [0, 1], [1, 0.78]) }],
    transformOrigin: 'left center',
  }));
  const eyebrowStyle = useAnimatedStyle(() => ({
    height: eyebrowH ? eyebrowH * (1 - collapse.value) : undefined,
    opacity: interpolate(collapse.value, [0, 1], [1, 0]),
  }));
  const subtitleStyle = useAnimatedStyle(() => ({
    height: subH ? subH * (1 - collapse.value) : undefined,
    opacity: interpolate(collapse.value, [0, 1], [1, 0]),
  }));
  const rightRowStyle = useAnimatedStyle(() => ({
    marginTop: interpolate(collapse.value, [0, 1], [16, 8]),
  }));

  return (
    <Animated.View
      className="px-10 border-b border-surface-border flex-shrink-0"
      style={[{ alignSelf: 'stretch', width: '100%', paddingTop: 32, paddingBottom: 24 }, padStyle]}
    >
      {/* Identity block (collapses on scroll) */}
      <View className="min-w-0">
        {!!eyebrow && (
          <Animated.View style={[eyebrowStyle, { overflow: 'hidden' }]}>
            <View onLayout={(e) => { if (!eyebrowH) setEyebrowH(e.nativeEvent.layout.height); }}>
              <Text className="text-brand-primary font-black uppercase tracking-[0.3em] text-[9px] mb-1">{eyebrow}</Text>
            </View>
          </Animated.View>
        )}
        <Animated.View style={titleScaleStyle}>
          <Text className="text-typography-main text-4xl font-black tracking-tight">{title}</Text>
        </Animated.View>
        {!!subtitle && (
          <Animated.View style={[subtitleStyle, { overflow: 'hidden' }]}>
            <View onLayout={(e) => { if (!subH) setSubH(e.nativeEvent.layout.height); }}>
              <Text className="text-typography-muted text-sm mt-1">{subtitle}</Text>
            </View>
          </Animated.View>
        )}
      </View>

      {/* Full-width controls row. `width:100%` on the plain wrap <View> (not just
          the class) so its own flex-wrap engages under an Animated ancestor on
          RNW; the Animated wrapper only tweens marginTop. */}
      {!!right && (
        <Animated.View style={[{ alignSelf: 'stretch', width: '100%' }, rightRowStyle]}>
          <View className="flex-row flex-wrap items-center gap-3" style={{ width: '100%' }}>
            {right}
          </View>
        </Animated.View>
      )}
    </Animated.View>
  );
}
