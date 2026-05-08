import React from 'react';
import { View, Text, TouchableOpacity, SafeAreaView } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { FontAwesome } from '@expo/vector-icons';
import NotificationRules from '@/components/admin/NotificationRules';

export default function AdminNotificationsScreen() {
  const router = useRouter();

  return (
    <SafeAreaView className="flex-1 bg-surface-background">
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View className="bg-surface-card px-4 pt-4 pb-6 border-b border-surface-border rounded-b-3xl">
        <View className="flex-row items-center justify-between mb-6">
          <TouchableOpacity
            onPress={() => router.back()}
            className="flex-row items-center h-11 pr-4"
          >
            <FontAwesome name="chevron-left" size={14} color="var(--color-text-muted)" />
            <Text className="text-typography-muted font-bold text-sm ml-2">Back</Text>
          </TouchableOpacity>
          <View className="bg-brand-primary/10 px-3 py-1.5 rounded-full border border-brand-primary/20">
            <Text className="text-brand-primary text-[9px] font-black uppercase tracking-widest">
              Admin
            </Text>
          </View>
        </View>

        <View className="px-2">
          <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.25em] mb-1">
            Signal Engine
          </Text>
          <Text className="text-typography-main text-3xl font-black tracking-tight">
            Notification Rules
          </Text>
          <Text className="text-typography-muted text-sm mt-2 leading-5">
            Configure which events trigger notifications and who receives them.
          </Text>
        </View>
      </View>

      <View className="flex-1 pt-4">
        <NotificationRules />
      </View>
    </SafeAreaView>
  );
}
