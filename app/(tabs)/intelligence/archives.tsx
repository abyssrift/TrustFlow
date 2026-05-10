import React from 'react';
import { Platform } from 'react-native';
import WebComponent from '@/components/intelligence/_archives_web';
import AdaptiveComponent from '@/components/intelligence/_archives_adaptive';

export default function archivesScreen() {
  if (Platform.OS === 'web') {
    return <WebComponent />;
  }
  return <AdaptiveComponent />;
}
