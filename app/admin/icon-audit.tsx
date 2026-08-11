import { BackButton } from '@/components/common/BackButton';
import IconAuditList from '@/components/devtools/IconAuditList';
import React from 'react';
import { Platform, SafeAreaView, ScrollView, StatusBar, Text, View } from 'react-native';

export default function IconAuditScreen() {
  return (
    <SafeAreaView className="flex-1 bg-surface-background" style={Platform.OS === 'android' ? { paddingTop: StatusBar.currentHeight } : {}}>
      <View className="bg-surface-card border-b border-surface-border px-4 pt-6 pb-4">
        <View className="flex-row items-center gap-3 flex-1">
          <BackButton />
          <View>
            <Text className="text-typography-main font-black text-lg">Icon Audit</Text>
            <Text className="text-typography-muted text-xs">Every FontAwesome glyph used in the app, and where</Text>
          </View>
        </View>
      </View>

      <ScrollView className="flex-1" showsVerticalScrollIndicator>
        <View className="p-5 pb-12">
          <IconAuditList />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
