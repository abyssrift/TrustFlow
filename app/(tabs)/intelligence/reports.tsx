import React from 'react';
import { Platform } from 'react-native';
import WebComponent from '@/components/intelligence/_reports_web';
import AdaptiveComponent from '@/components/intelligence/_reports_adaptive';

export default function reportsScreen() {
  if (Platform.OS === 'web') {
    return <WebComponent />;
  }
  return <AdaptiveComponent />;
}
