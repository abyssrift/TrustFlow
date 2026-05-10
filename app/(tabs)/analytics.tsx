import React from 'react';
import { Platform } from 'react-native';
import WebComponent from '@/components/tabs/_analytics_web';
import AdaptiveComponent from '@/components/tabs/_analytics_adaptive';

export default function analyticsScreen() {
  if (Platform.OS === 'web') {
    return <WebComponent />;
  }
  return <AdaptiveComponent />;
}
