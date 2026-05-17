import React, { Platform } from 'react';
import { type ManualTimeApprovalEntry } from '@/contexts/TaskDetailContext';
import MobileCard from './ManualTimeApprovalCard.mobile';
import WebCard from './ManualTimeApprovalCard.web';

type Props = { entries: ManualTimeApprovalEntry[] };

export default function ManualTimeApprovalCard({ entries }: Props) {
  if (Platform.OS === 'web') {
    return <WebCard entries={entries} />;
  }
  return <MobileCard entries={entries} />;
}
