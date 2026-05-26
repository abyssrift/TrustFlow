import React from 'react';
import { useWindowDimensions } from 'react-native';
import FileHubDesktop from './_filehub_desktop';
import FileHubAdaptive from './_filehub_adaptive';

export default function FileHubWebSwitcher() {
  const { width } = useWindowDimensions();
  if (width >= 1024) return <FileHubDesktop />;
  return <FileHubAdaptive />;
}
