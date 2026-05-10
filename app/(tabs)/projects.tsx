import React from 'react';
import { Platform } from 'react-native';
import WebComponent from '@/components/tabs/_projects_web';
import AdaptiveComponent from '@/components/tabs/_projects_adaptive';

export default function projectsScreen() {
  if (Platform.OS === 'web') {
    return <WebComponent />;
  }
  return <AdaptiveComponent />;
}
