import React, { useState } from 'react';
import { Text, View } from 'react-native';
import Animated, { interpolate, useAnimatedStyle } from 'react-native-reanimated';
import { useCollapseProgressOptional } from '@/hooks/useCollapsibleHeader';

// The eyebrow + title + actions block that RoleBuilder / TeamAssignmentGrid /
// UserAssignmentGrid each rendered by hand above their MultiViewList. One
// component now, with the scroll-linked collapse baked in: the grids feed
// `progress` via useCollapsibleHeaderScroll() on their MultiViewList, this
// reads it and shrinks the eyebrow (to zero height) + title (scale) as the
// list scrolls. Outside a <CollapsibleHeaderProvider> it just renders static.
//
// Theme + motion follow the app's standard (see components/task-detail/
// TaskHeader.tsx): the title is a PLAIN <Text> with `text-typography-main` for
// colour — NativeWind's className colour does NOT resolve on `Animated.Text`
// on this web build — and motion goes on an <Animated.View> wrapper.
export default function GridSectionHeader({
  eyebrow,
  title,
  right,
}: {
  eyebrow: string;
  title: string;
  right?: React.ReactNode;
}) {
  const collapse = useCollapseProgressOptional();
  const [eyebrowH, setEyebrowH] = useState(0);

  const eyebrowStyle = useAnimatedStyle(() => ({
    height: eyebrowH ? eyebrowH * (1 - collapse.value) : undefined,
    opacity: interpolate(collapse.value, [0, 1], [1, 0]),
  }));
  const titleScaleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(collapse.value, [0, 1], [1, 0.8]) }],
    transformOrigin: 'left center',
  }));

  return (
    <View className="flex-row items-center justify-between mb-4 px-1">
      <View className="flex-1 mr-3 min-w-0">
        <Animated.View style={[eyebrowStyle, { overflow: 'hidden' }]}>
          <View onLayout={(e) => { if (!eyebrowH) setEyebrowH(e.nativeEvent.layout.height); }}>
            <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.25em] mb-1">{eyebrow}</Text>
          </View>
        </Animated.View>
        <Animated.View style={titleScaleStyle}>
          <Text className="text-typography-main text-2xl font-black tracking-tight" numberOfLines={1}>{title}</Text>
        </Animated.View>
      </View>
      {right}
    </View>
  );
}
