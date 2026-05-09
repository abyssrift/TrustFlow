import React from 'react';
import { Platform } from 'react-native';
import WebComponent from './_projects_web';
import AdaptiveComponent from './_projects_adaptive';

export default function projectsScreen() {
  if (Platform.OS === 'web') {
    return <WebComponent />;
  }
  return <AdaptiveComponent />;
}
