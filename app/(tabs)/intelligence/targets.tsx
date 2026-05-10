import React from 'react';
import { Platform } from 'react-native';
import WebComponent from '@/components/intelligence/_targets_web';
import AdaptiveComponent from '@/components/intelligence/_targets_adaptive';

export default function targetsScreen() {
  if (Platform.OS === 'web') {
    return <WebComponent />;
  }
  return <AdaptiveComponent />;
}
