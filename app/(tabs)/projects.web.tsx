import React from 'react';
import { useWindowDimensions } from 'react-native';
import ProjectsDesktop from './projects.desktop';
import ProjectsAdaptive from './projects.adaptive';

export default function ProjectsWebSwitcher() {
  const { width } = useWindowDimensions();
  const isDesktop = width >= 1024;

  if (isDesktop) {
    return <ProjectsDesktop />;
  }

  return <ProjectsAdaptive />;
}
