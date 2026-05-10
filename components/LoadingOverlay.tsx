import React, { useEffect } from 'react';
import { View, Text, ActivityIndicator, Animated, Easing } from 'react-native';
import { useThemeColors } from '@/hooks/useThemeColors';

export default function LoadingOverlay({ message = 'Loading TrustFlow...' }: { message?: string }) {
  const colors = useThemeColors();
  const progress = React.useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(progress, {
          toValue: 1,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
        Animated.timing(progress, {
          toValue: 0,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
      ])
    ).start();
  }, []);

  const width = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['10%', '90%'],
  });

  return (
    <View className="absolute inset-0 z-[9999] flex-center bg-surface-background/80" style={{ backdropFilter: 'blur(8px)' } as any}>
      <View className="items-center px-8">
        <View className="mb-6 h-16 w-16 items-center justify-center rounded-2xl bg-brand-primary/10 border border-brand-primary/20">
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
        
        <Text className="text-typography-main text-lg font-black tracking-tight mb-2">{message}</Text>
        <Text className="text-typography-muted text-xs font-bold uppercase tracking-widest mb-6">Optimizing your workflow</Text>
        
        {/* Progress Bar */}
        <View className="h-1 w-48 bg-surface-border rounded-full overflow-hidden">
          <Animated.View 
            style={{ 
              width,
              height: '100%',
              backgroundColor: colors.primary,
              borderRadius: 4
            }} 
          />
        </View>
      </View>
    </View>
  );
}
