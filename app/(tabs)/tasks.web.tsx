import React from 'react';
import { useWindowDimensions } from 'react-native';
import TasksDesktop from './tasks.desktop';
import TasksAdaptive from './tasks.adaptive';

export default function TasksWebSwitcher() {
  const { width } = useWindowDimensions();
  // We use 1024px as the breakpoint for high-density desktop board
  const isDesktop = width >= 1024;

  if (isDesktop) {
    return <TasksDesktop />;
  }

  return <TasksAdaptive />;
}
