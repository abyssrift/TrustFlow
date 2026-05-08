import React from 'react';
import { useWindowDimensions } from 'react-native';
import ProfileDesktop from './profile.desktop';
import ProfileAdaptive from './profile.adaptive';

export default function ProfileWebSwitcher() {
  const { width } = useWindowDimensions();
  const isDesktop = width >= 1024;

  if (isDesktop) {
    return <ProfileDesktop />;
  }

  return <ProfileAdaptive />;
}
