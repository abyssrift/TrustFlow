import React from 'react';
import { Platform } from 'react-native';
import WebComponent from './_reports_web';
import AdaptiveComponent from './_reports_adaptive';

export default function reportsScreen() {
  if (Platform.OS === 'web') {
    return <WebComponent />;
  }
  return <AdaptiveComponent />;
}
