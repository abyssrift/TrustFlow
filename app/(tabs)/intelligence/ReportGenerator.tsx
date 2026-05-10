import React from 'react';
import { Platform } from 'react-native';
import WebComponent from '@/components/intelligence/_ReportGenerator_web';
import AdaptiveComponent from '@/components/intelligence/_ReportGenerator_adaptive';

export default function ReportGeneratorScreen() {
  if (Platform.OS === 'web') {
    return <WebComponent />;
  }
  return <AdaptiveComponent />;
}
