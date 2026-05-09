import React from 'react';
import { useWindowDimensions } from 'react-native';
import IntelligenceAnalyticsDesktop from './_analytics_desktop';
import IntelligenceAnalyticsAdaptive from './_analytics_adaptive';

export default function IntelligenceAnalyticsWebSwitcher() {
  const { width } = useWindowDimensions();
  const isDesktop = width >= 1024;

  if (isDesktop) {
    return <IntelligenceAnalyticsDesktop />;
  }

  return <IntelligenceAnalyticsAdaptive />;
}


