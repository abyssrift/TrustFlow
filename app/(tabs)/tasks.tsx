import React from 'react';
import { Platform } from 'react-native';
import WebComponent from '@/components/tabs/_tasks_web';
import AdaptiveComponent from '@/components/tabs/_tasks_adaptive';

export default function tasksScreen() {
  if (Platform.OS === 'web') {
    return <WebComponent />;
  }
  return <AdaptiveComponent />;
}
