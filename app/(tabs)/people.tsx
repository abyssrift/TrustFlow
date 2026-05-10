import React from 'react';
import { Platform } from 'react-native';
import WebComponent from '@/components/tabs/_people_web';
import AdaptiveComponent from '@/components/tabs/_people_adaptive';

export default function peopleScreen() {
  if (Platform.OS === 'web') {
    return <WebComponent />;
  }
  return <AdaptiveComponent />;
}
