import React, { useEffect, useRef } from 'react';
import { View, Text, Image, Animated, Easing } from 'react-native';

/**
 * Full-screen branded loading screen shown while fonts/assets boot.
 * Replaces the bare "Loading TrustFlow..." text with a logo + wordmark and a
 * "flow" loader — a highlight that sweeps a track, echoing the pipeline motif.
 *
 * Uses only transform/opacity animations so useNativeDriver works everywhere
 * (web + native). Lives outside providers, so it takes no context/theme deps.
 */
export default function BrandSplash({ label = 'Getting things ready' }: { label?: string }) {
  const breathe = useRef(new Animated.Value(0)).current;
  const sweep = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Gentle entrance so the screen never "pops" in.
    Animated.timing(fade, {
      toValue: 1,
      duration: 450,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    // Logo tile breathes.
    Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, {
          toValue: 1,
          duration: 1600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(breathe, {
          toValue: 0,
          duration: 1600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();

    // Highlight sweeps across the track, pauses, repeats.
    Animated.loop(
      Animated.timing(sweep, {
        toValue: 1,
        duration: 1400,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      })
    ).start();
  }, []);

  const scale = breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });

  const TRACK_WIDTH = 208;
  const HIGHLIGHT_WIDTH = 72;
  const translateX = sweep.interpolate({
    inputRange: [0, 1],
    outputRange: [-HIGHLIGHT_WIDTH, TRACK_WIDTH],
  });

  return (
    <View className="flex-1 bg-brand-primary items-center justify-center">
      {/* Depth: darken toward the edges without a gradient dependency. */}
      <View className="absolute inset-0 bg-black/20" />

      <Animated.View style={{ opacity: fade, alignItems: 'center' }}>
        {/* Glass logo tile — matches the auth visual language. */}
        <Animated.View
          className="w-24 h-24 bg-white/10 rounded-[2rem] items-center justify-center border border-white/20 mb-8"
          style={{ transform: [{ scale }], backdropFilter: 'blur(12px)' } as any}
        >
          <Image
            source={require('../assets/images/logo-mark-white.png')}
            style={{ width: 52, height: 52 }}
            resizeMode="contain"
          />
        </Animated.View>

        <Text className="text-4xl font-black text-white tracking-tighter mb-2">TrustFlow</Text>
        <Text className="text-white/70 text-[11px] font-black uppercase tracking-[0.2em] mb-8">
          {label}
        </Text>

        {/* Flow loader: a highlight sweeps a translucent track. */}
        <View
          className="h-1 rounded-full bg-white/15 overflow-hidden"
          style={{ width: TRACK_WIDTH }}
        >
          <Animated.View
            style={{
              width: HIGHLIGHT_WIDTH,
              height: '100%',
              borderRadius: 999,
              backgroundColor: 'rgba(255,255,255,0.9)',
              transform: [{ translateX }],
            }}
          />
        </View>
      </Animated.View>
    </View>
  );
}
