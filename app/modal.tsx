import { StatusBar } from 'expo-status-bar';
import { Platform, View, Text } from 'react-native';

import EditScreenInfo from '@/components/EditScreenInfo';

export default function ModalScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-surface-background">
      <Text className="text-xl font-black text-typography-main">Notifications</Text>
      <View className="my-8 h-[1px] w-4/5 bg-surface-border" />
      
      <View className="px-10 items-center">
        <Text className="text-typography-muted text-center leading-6">
          The notification protocol is currently in standby mode. 
          Real-time telemetry will resume upon the next synchronization.
        </Text>
      </View>

      {/* Use a light status bar on iOS to account for the black space above the modal */}
      <StatusBar style={Platform.OS === 'ios' ? 'light' : 'auto'} />
    </View>
  );
}

