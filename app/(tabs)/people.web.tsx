import React from 'react';
import { useWindowDimensions } from 'react-native';
import PeopleDesktop from './people.desktop';
import PeopleAdaptive from './people.adaptive';

export default function PeopleWebSwitcher() {
  const { width } = useWindowDimensions();
  const isDesktop = width >= 1024;

  if (isDesktop) {
    return <PeopleDesktop />;
  }

  return <PeopleAdaptive />;
}
