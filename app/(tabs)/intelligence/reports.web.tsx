import React from 'react';
import { useWindowDimensions } from 'react-native';
import IntelligenceReportsDesktop from './reports.desktop';
import IntelligenceReportsAdaptive from './reports.adaptive';

export default function IntelligenceReportsWebSwitcher() {
  const { width } = useWindowDimensions();
  const isDesktop = width >= 1024;

  if (isDesktop) {
    return <IntelligenceReportsDesktop />;
  }

  return <IntelligenceReportsAdaptive />;
}
