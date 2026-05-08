import React from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { FontAwesome } from '@expo/vector-icons';
import NotificationRules from '@/components/admin/NotificationRules';

export default function AdminNotificationsScreenWeb() {
  const router = useRouter();

  return (
    <ScrollView className="flex-1 bg-surface-background" showsVerticalScrollIndicator={false}>
      <Stack.Screen options={{ headerShown: false }} />

      <View className="max-w-[900px] mx-auto w-full px-10 py-12">
        {/* Breadcrumb */}
        <View className="flex-row items-center gap-2 mb-10">
          <TouchableOpacity onPress={() => router.back()} className="flex-row items-center gap-2">
            <FontAwesome name="chevron-left" size={11} color="var(--color-text-muted)" />
            <Text className="text-typography-muted font-bold text-sm">Back</Text>
          </TouchableOpacity>
          <Text className="text-typography-muted text-sm">/</Text>
          <Text className="text-typography-muted font-bold text-sm">Admin</Text>
          <Text className="text-typography-muted text-sm">/</Text>
          <Text className="text-typography-main font-bold text-sm">Notification Rules</Text>
        </View>

        {/* Page header */}
        <View className="mb-10 flex-row items-end justify-between">
          <View>
            <Text className="text-brand-primary font-black uppercase tracking-[0.3em] text-[10px] mb-2">
              Signal Engine
            </Text>
            <Text className="text-typography-main text-4xl font-black tracking-tighter">
              Notification Rules
            </Text>
            <Text className="text-typography-muted text-base mt-2 font-medium">
              Configure which events trigger notifications and who receives them.
            </Text>
          </View>

          <View className="bg-brand-primary/10 px-4 py-2 rounded-xl border border-brand-primary/20">
            <Text className="text-brand-primary text-[10px] font-black uppercase tracking-widest">
              Admin Only
            </Text>
          </View>
        </View>

        {/* Rules component */}
        <View className="bg-surface-card rounded-[32px] border border-surface-border p-8 premium-shadow">
          <NotificationRules />
        </View>
      </View>
    </ScrollView>
  );
}
