import React from 'react';
import { Platform } from 'react-native';
import WebComponent from './_ReportGenerator_web';
import AdaptiveComponent from './_ReportGenerator_adaptive';

export default function ReportGeneratorScreen() {
  if (Platform.OS === 'web') {
    return <WebComponent />;
  }
  return <AdaptiveComponent />;
}
