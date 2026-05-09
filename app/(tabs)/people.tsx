import React from 'react';
import { Platform } from 'react-native';
import WebComponent from './_people_web';
import AdaptiveComponent from './_people_adaptive';

export default function peopleScreen() {
  if (Platform.OS === 'web') {
    return <WebComponent />;
  }
  return <AdaptiveComponent />;
}
