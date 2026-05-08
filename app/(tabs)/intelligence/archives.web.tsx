import React from 'react';
import { useWindowDimensions } from 'react-native';
import IntelligenceArchivesDesktop from './archives.desktop';
import IntelligenceArchivesAdaptive from './archives.adaptive';

export default function IntelligenceArchivesWebSwitcher() {
  const { width } = useWindowDimensions();
  const isDesktop = width >= 1024;

  if (isDesktop) {
    return <IntelligenceArchivesDesktop />;
  }

  return <IntelligenceArchivesAdaptive />;
}
