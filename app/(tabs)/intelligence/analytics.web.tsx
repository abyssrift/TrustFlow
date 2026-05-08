import React from 'react';
import { useWindowDimensions } from 'react-native';
import IntelligenceAnalyticsDesktop from './analytics.desktop';
import IntelligenceAnalyticsAdaptive from './analytics.adaptive';

export default function IntelligenceAnalyticsWebSwitcher() {
  const { width } = useWindowDimensions();
  const isDesktop = width >= 1024;

  if (isDesktop) {
    return <IntelligenceAnalyticsDesktop />;
  }

  return <IntelligenceAnalyticsAdaptive />;
}
