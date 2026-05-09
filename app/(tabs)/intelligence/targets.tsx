import React from 'react';
import { Platform } from 'react-native';
import WebComponent from './_targets_web';
import AdaptiveComponent from './_targets_adaptive';

export default function targetsScreen() {
  if (Platform.OS === 'web') {
    return <WebComponent />;
  }
  return <AdaptiveComponent />;
}
