import React from 'react';
import { useWindowDimensions } from 'react-native';
import ProjectsDesktop from './_projects_desktop';
import ProjectsAdaptive from './_projects_adaptive';

export default function ProjectsWebSwitcher() {
  const { width } = useWindowDimensions();
  const isDesktop = width >= 1024;

  if (isDesktop) {
    return <ProjectsDesktop />;
  }

  return <ProjectsAdaptive />;
}


