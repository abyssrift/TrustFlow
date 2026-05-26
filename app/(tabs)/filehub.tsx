import React from 'react';
import { Platform } from 'react-native';
import WebComponent from '@/components/intelligence/_filehub_web';
import AdaptiveComponent from '@/components/intelligence/_filehub_adaptive';

export default function FileHubScreen() {
  if (Platform.OS === 'web') {
    return <WebComponent />;
  }
  return <AdaptiveComponent />;
}
