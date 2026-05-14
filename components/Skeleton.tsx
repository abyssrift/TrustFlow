import React, { useEffect } from 'react';
import { Animated, View, StyleSheet } from 'react-native';

type SkeletonBlockProps = {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  style?: any;
};

export function SkeletonBlock({ width = '100%', height = 16, borderRadius = 8, style }: SkeletonBlockProps) {
  const anim = React.useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 700, useNativeDriver: false }),
        Animated.timing(anim, { toValue: 0, duration: 700, useNativeDriver: false }),
      ])
    ).start();
  }, [anim]);

  const backgroundColor = anim.interpolate({
    inputRange: [0, 1],
    outputRange: ['rgba(200,200,200,0.16)', 'rgba(200,200,200,0.06)']
  });

  return (
    <Animated.View
      style={[
        { width, height, borderRadius, backgroundColor },
        styles.block,
        style,
      ]}
    />
  );
}

export function SkeletonList({ count = 3, itemHeight = 80, gap = 12, style }: { count?: number; itemHeight?: number; gap?: number; style?: any }) {
  const items = Array.from({ length: count });
  return (
    <View style={[{ gap }, style as any]}>
      {items.map((_, idx) => (
        <SkeletonBlock key={idx} height={itemHeight} borderRadius={12} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    overflow: 'hidden'
  }
});

export default SkeletonBlock;
