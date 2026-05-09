import React from 'react';
import { Platform } from 'react-native';
import WebComponent from './_profile_web';
import AdaptiveComponent from './_profile_adaptive';

export default function profileScreen() {
  if (Platform.OS === 'web') {
    return <WebComponent />;
  }
  return <AdaptiveComponent />;
}
