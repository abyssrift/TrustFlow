import React from 'react';
import { useWindowDimensions } from 'react-native';
import IntelligenceGraphsDesktop from './_graphs_desktop';
import IntelligenceGraphsAdaptive from './_graphs_adaptive';

export default function IntelligenceGraphsWebSwitcher() {
  const { width } = useWindowDimensions();
  const isDesktop = width >= 1024;

  if (isDesktop) {
    return <IntelligenceGraphsDesktop />;
  }

  return <IntelligenceGraphsAdaptive />;
}


