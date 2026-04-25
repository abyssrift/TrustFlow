import React from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { useRouter, Stack } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';

export default function ModalScreenWeb() {
  const router = useRouter();

  return (
    <View className="flex-1 bg-surface-background/80 items-center justify-center p-6">
      <Stack.Screen options={{ headerShown: false }} />
      
      <View className="w-full max-w-xl bg-surface-card rounded-[40px] border border-surface-border overflow-hidden premium-shadow glass-card">
        {/* Header */}
        <View className="px-10 py-8 border-b border-surface-border flex-row items-center justify-between">
          <View className="flex-row items-center">
            <View className="h-12 w-12 rounded-2xl bg-brand-primary/10 items-center justify-center mr-5">
              <FontAwesome name="bell" size={20} className="text-brand-primary" />
            </View>
            <View>
              <Text className="text-2xl font-black text-typography-main tracking-tight">Tactical Alerts</Text>
              <Text className="text-[10px] font-bold text-brand-primary uppercase tracking-[0.2em] mt-0.5">Real-time Telemetry Standby</Text>
            </View>
          </View>
          <TouchableOpacity 
            onPress={() => router.back()}
            className="h-10 w-10 items-center justify-center rounded-full bg-surface-background border border-surface-border hover:bg-surface-overlay active:scale-90 transition-all"
          >
            <FontAwesome name="close" size={14} className="text-typography-muted" />
          </TouchableOpacity>
        </View>

        {/* Content */}
        <ScrollView className="p-10 max-h-[60vh]" showsVerticalScrollIndicator={false}>
          <View className="items-center py-10">
            <View className="w-24 h-24 rounded-full bg-surface-background border border-surface-border items-center justify-center mb-8 relative">
              <FontAwesome name="wifi" size={32} className="text-surface-border" />
              <View className="absolute bottom-0 right-0 w-6 h-6 rounded-full bg-state-warning border-4 border-surface-card" />
            </View>
            
            <Text className="text-typography-main text-xl font-black text-center mb-4">Protocol in Standby</Text>
            <Text className="text-typography-muted text-center leading-7 font-medium px-4">
              The notification uplink is currently in a defensive standby state. 
              Signal integrity remains at 100%, but broadcast suppression is active until the next mission cycle.
            </Text>

            <View className="mt-12 w-full gap-4">
               <View className="p-6 bg-surface-background rounded-3xl border border-surface-border flex-row items-center">
                  <View className="w-2 h-2 rounded-full bg-state-success mr-4" />
                  <Text className="text-typography-muted text-xs font-bold uppercase tracking-widest flex-1">System Health: Optimal</Text>
                  <Text className="text-typography-main font-black">99.9%</Text>
               </View>
               <View className="p-6 bg-surface-background rounded-3xl border border-surface-border flex-row items-center">
                  <View className="w-2 h-2 rounded-full bg-brand-primary mr-4" />
                  <Text className="text-typography-muted text-xs font-bold uppercase tracking-widest flex-1">Uplink Latency</Text>
                  <Text className="text-typography-main font-black">12ms</Text>
               </View>
            </View>
          </View>
        </ScrollView>

        {/* Footer */}
        <View className="px-10 py-8 border-t border-surface-border bg-surface-card/50">
           <TouchableOpacity
            onPress={() => router.back()}
            className="w-full py-5 rounded-2xl bg-brand-primary premium-shadow active:scale-[0.98] transition-all items-center"
           >
             <Text className="text-white font-black uppercase tracking-widest text-xs">Acknowledge</Text>
           </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}
