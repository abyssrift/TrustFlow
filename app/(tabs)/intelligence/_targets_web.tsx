import React from 'react';
import { useWindowDimensions } from 'react-native';
import IntelligenceTargetsDesktop from './_targets_desktop';
import IntelligenceTargetsAdaptive from './_targets_adaptive';

export default function IntelligenceTargetsWebSwitcher() {
  const { width } = useWindowDimensions();
  const isDesktop = width >= 1024;

  if (isDesktop) {
    return <IntelligenceTargetsDesktop />;
  }

  return <IntelligenceTargetsAdaptive />;
}


