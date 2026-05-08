import React from 'react';
import { useWindowDimensions } from 'react-native';
import IntelligenceOverviewDesktop from './index.desktop';
import IntelligenceOverviewAdaptive from './index.adaptive';

export default function IntelligenceWebSwitcher() {
  const { width } = useWindowDimensions();
  const isDesktop = width >= 1024;

  if (isDesktop) {
    return <IntelligenceOverviewDesktop />;
  }

  return <IntelligenceOverviewAdaptive />;
}
