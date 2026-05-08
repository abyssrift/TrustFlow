import React from 'react';
import { useWindowDimensions } from 'react-native';
import IntelligenceGraphsDesktop from './graphs.desktop';
import IntelligenceGraphsAdaptive from './graphs.adaptive';

export default function IntelligenceGraphsWebSwitcher() {
  const { width } = useWindowDimensions();
  const isDesktop = width >= 1024;

  if (isDesktop) {
    return <IntelligenceGraphsDesktop />;
  }

  return <IntelligenceGraphsAdaptive />;
}
