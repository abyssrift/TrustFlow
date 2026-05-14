import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Link } from 'expo-router';
import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

export default function DevTool() {
  if (!process.env.EXPO_PUBLIC_SUPABASE_URL) return null;

  return (
    <View className="bg-surface-card p-4 rounded-xl border border-brand-primary/50 mb-6 border-dashed">
      <View className="flex-row items-center mb-3">
        <FontAwesome name="code" size={16} color="#6366f1" />
        <Text className="text-typography-main font-bold ml-2">Dev Tools</Text>
      </View>
      <Link href="/admin/dev-tools" asChild>
        <TouchableOpacity className="bg-brand-primary/20 border border-brand-primary/30 py-2 px-3 rounded-lg items-center flex-row justify-between">
          <Text className="text-brand-primary font-bold text-xs flex-1">Seeding & Data Management</Text>
          <FontAwesome name="chevron-right" size={11} color="#6366f1" />
        </TouchableOpacity>
      </Link>
      <Text className="text-typography-dim text-[10px] mt-2">
        Access comprehensive seeding tools, progress monitoring, and data management from the dedicated admin panel.
      </Text>
    </View>
  );
}
