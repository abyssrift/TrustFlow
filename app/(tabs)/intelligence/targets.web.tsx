import React from 'react';
import { useWindowDimensions } from 'react-native';
import IntelligenceTargetsDesktop from './targets.desktop';
import IntelligenceTargetsAdaptive from './targets.adaptive';

export default function IntelligenceTargetsWebSwitcher() {
  const { width } = useWindowDimensions();
  const isDesktop = width >= 1024;

  if (isDesktop) {
    return <IntelligenceTargetsDesktop />;
  }

  return <IntelligenceTargetsAdaptive />;
}
