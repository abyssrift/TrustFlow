import React, { useEffect, useMemo, useRef } from 'react';
import { View } from 'react-native';
import { GuideAnchorHandle, useContextualGuide } from '@/contexts/ContextualGuideContext';
import type { GuideAnchorId } from '@/lib/contextualGuides';

export default function GuideAnchor({ id, children, className }: { id: GuideAnchorId; children?: React.ReactNode; className?: string }) {
  const viewRef = useRef<View>(null);
  const { registerAnchor } = useContextualGuide();
  const anchorHandle = useMemo<GuideAnchorHandle>(() => ({
    measure: () => new Promise((resolve) => {
      const node = viewRef.current;
      if (!node) { resolve(null); return; }
      node.measureInWindow((x, y, width, height) => resolve(width > 0 && height > 0 ? { x, y, width, height } : null));
    }),
  }), []);
  useEffect(() => registerAnchor(id, anchorHandle), [id, registerAnchor, anchorHandle]);
  return <View ref={viewRef} collapsable={false} className={className}>{children}</View>;
}
