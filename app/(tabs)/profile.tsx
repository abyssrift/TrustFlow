import React from 'react';
import { Platform } from 'react-native';
import WebComponent from '@/components/tabs/_profile_web';
import AdaptiveComponent from '@/components/tabs/_profile_adaptive';

export default function profileScreen() {
  if (Platform.OS === 'web') {
    return <WebComponent />;
  }
  return <AdaptiveComponent />;
}
