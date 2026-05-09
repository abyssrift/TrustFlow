import React from 'react';
import { Platform } from 'react-native';
import WebComponent from './_archives_web';
import AdaptiveComponent from './_archives_adaptive';

export default function archivesScreen() {
  if (Platform.OS === 'web') {
    return <WebComponent />;
  }
  return <AdaptiveComponent />;
}
