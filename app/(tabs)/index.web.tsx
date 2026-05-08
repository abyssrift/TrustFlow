import React from 'react';
import { useWindowDimensions } from 'react-native';
import DashboardDesktop from './index.desktop';
import DashboardAdaptive from './index.adaptive';

export default function DashboardWebSwitcher() {
  const { width } = useWindowDimensions();
  const isDesktop = width >= 1024;

  if (isDesktop) {
    return <DashboardDesktop />;
  }

  return <DashboardAdaptive />;
}
