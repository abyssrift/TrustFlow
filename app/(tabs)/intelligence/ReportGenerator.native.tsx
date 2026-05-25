import React from 'react';
import AdaptiveComponent from '@/components/intelligence/_ReportGenerator_adaptive';

export default function ReportGeneratorScreen() {
  return <AdaptiveComponent visible={true} onClose={() => {}} onReportGenerated={() => {}} isPage={true} />;
}
