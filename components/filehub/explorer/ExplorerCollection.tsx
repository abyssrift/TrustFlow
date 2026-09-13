import React from 'react';
import MultiViewList from '@/components/common/MultiViewList';
import type { ExplorerCollectionProps } from './ExplorerTypes';

/** Shared collection shell. Callers own filtering and controlled toolbar state. */
export default function ExplorerCollection<T>(props: ExplorerCollectionProps<T>) {
  return <MultiViewList {...props} />;
}
