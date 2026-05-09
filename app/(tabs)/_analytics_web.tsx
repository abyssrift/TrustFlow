import React from 'react';
import { useWindowDimensions } from 'react-native';
import AnalyticsDesktop from './_analytics_desktop';
import AnalyticsAdaptive from './_analytics_adaptive';

export default function AnalyticsWeb() {
  const { width } = useWindowDimensions();
  const isDesktop = width >= 1024;

  if (isDesktop) {
    return <AnalyticsDesktop />;
  }

  return <AnalyticsAdaptive />;
}


