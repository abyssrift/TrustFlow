import React from 'react';
import { useWindowDimensions } from 'react-native';
import IntelligenceOverviewDesktop from './_index_desktop';
import IntelligenceOverviewAdaptive from './_index_adaptive';

export default function IntelligenceWebSwitcher() {
  const { width } = useWindowDimensions();
  const isDesktop = width >= 1024;

  if (isDesktop) {
    return <IntelligenceOverviewDesktop />;
  }

  return <IntelligenceOverviewAdaptive />;
}


