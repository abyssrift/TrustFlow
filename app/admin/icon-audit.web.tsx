import IconAuditList from '@/components/devtools/IconAuditList';
import { Stack } from 'expo-router';
import React from 'react';
import { ScrollView, Text, View } from 'react-native';

export default function IconAuditScreenWeb() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View className="flex-1 bg-surface-background flex-row">
        <View className="flex-1">
          <View className="bg-surface-card border-b border-surface-border px-8 py-4 flex-row items-center justify-between">
            <Text className="text-typography-main font-black text-lg">Icon Audit</Text>
            <Text className="text-typography-muted text-xs">
              Every FontAwesome glyph used in the app, and where
            </Text>
          </View>

          <ScrollView className="flex-1" showsVerticalScrollIndicator contentContainerStyle={{ padding: 32, paddingBottom: 48 }}>
            <IconAuditList />
          </ScrollView>
        </View>
      </View>
    </>
  );
}
