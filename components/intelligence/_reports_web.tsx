import React from 'react';
import { useWindowDimensions } from 'react-native';
import IntelligenceReportsDesktop from './_reports_desktop';
import IntelligenceReportsAdaptive from './_reports_adaptive';

export default function IntelligenceReportsWebSwitcher() {
  const { width } = useWindowDimensions();
  const isDesktop = width >= 1024;

  if (isDesktop) {
    return <IntelligenceReportsDesktop />;
  }

  return <IntelligenceReportsAdaptive />;
}


