import React from 'react';
import { useWindowDimensions } from 'react-native';
import AnalyticsDesktop from './analytics.desktop';
import AnalyticsAdaptive from './analytics.adaptive';

export default function AnalyticsWeb() {
  const { width } = useWindowDimensions();
  const isDesktop = width >= 1024;

  if (isDesktop) {
    return <AnalyticsDesktop />;
  }

  return <AnalyticsAdaptive />;
}
