import React from 'react';
import { Platform } from 'react-native';
import WebComponent from './_index_web';
import AdaptiveComponent from './_index_adaptive';

export default function indexScreen() {
  if (Platform.OS === 'web') {
    return <WebComponent />;
  }
  return <AdaptiveComponent />;
}
