import React from 'react';
import { useWindowDimensions } from 'react-native';
import ReportGeneratorDesktop from './_ReportGenerator_desktop';
import ReportGeneratorAdaptive from './_ReportGenerator_adaptive';
import { Stack } from 'expo-router';

export default function ReportGeneratorWeb() {
  const { width } = useWindowDimensions();
  const isDesktop = width >= 1024;

  if (isDesktop) {
    return <ReportGeneratorDesktop />;
  }

  // On Mobile Web, we render the adaptive version as a page
  // We need to provide the props it expects, or refactor it to handle 'page' mode
  return (
    <>
      <Stack.Screen options={{ title: 'Report Architect', headerShown: true }} />
      <ReportGeneratorAdaptive 
        visible={true} 
        onClose={() => {}} 
        onReportGenerated={() => {}} 
        isPage={true} 
      />
    </>
  );
}


