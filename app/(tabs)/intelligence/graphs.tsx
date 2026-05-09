import React from 'react';
import { Platform } from 'react-native';
import WebComponent from './_graphs_web';
import AdaptiveComponent from './_graphs_adaptive';

export default function graphsScreen() {
  if (Platform.OS === 'web') {
    return <WebComponent />;
  }
  return <AdaptiveComponent />;
}
