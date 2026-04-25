import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Link, Stack } from 'expo-router';
import { FontAwesome } from '@expo/vector-icons';

export default function NotFoundScreenWeb() {
  return (
    <>
      <Stack.Screen options={{ title: 'Protocol Error' }} />
      <View className="flex-1 bg-surface-background items-center justify-center p-10">
        <View className="items-center max-w-lg w-full bg-surface-card p-16 rounded-[48px] border border-surface-border premium-shadow">
          <View className="w-24 h-24 bg-state-danger/10 rounded-full items-center justify-center mb-10 border border-state-danger/20">
            <FontAwesome name="exclamation-triangle" size={40} className="text-state-danger" />
          </View>

          <Text className="text-brand-primary font-black uppercase tracking-[0.3em] text-[10px] mb-4">Signal Integrity Lost</Text>
          <Text className="text-typography-main text-5xl font-black tracking-tighter text-center mb-6">404: Node Missing</Text>

          <Text className="text-typography-muted text-center text-lg font-medium leading-relaxed mb-12">
            The requested tactical coordinates do not exist within the current operational matrix. The node may have been decommissioned or moved.
          </Text>

          <Link href="/" asChild>
            <TouchableOpacity className="bg-brand-primary px-10 py-5 rounded-2xl premium-shadow active:scale-95 transition-transform flex-row items-center">
              <FontAwesome name="home" size={16} color="white" className="mr-3" />
              <Text className="text-white font-black uppercase tracking-widest text-sm">Return to Command</Text>
            </TouchableOpacity>
          </Link>

          <View className="mt-12 pt-8 border-t border-surface-border w-full items-center">
            <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">TrustFlow Protocol v2.4.0</Text>
          </View>
        </View>
      </View>
    </>
  );
}
