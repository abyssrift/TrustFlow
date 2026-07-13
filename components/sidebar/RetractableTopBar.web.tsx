import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import type { Shortcut } from './constants';
import TopBar from './TopBar.web';
import TopBarPullTab from './TopBarPullTab.web';

type TopBarProps = {
  topSearch: string;
  setTopSearch: (value: string) => void;
  unreadCount: number;
  onToggleThemePopover: () => void;
  profileAvatarUrl: string | null;
  profileLabel: string;
  visibleShortcuts: Shortcut[];
  pipelines: { id: string; name: string }[];
};

// Wraps TopBar with the retract behavior (item 6): the bar collapses to a small
// pull-tab, and re-expands either on click (persistent) or on hover (a peek that
// snaps shut when the cursor leaves). The whole subtree sits in its own stacking
// context above the content pane so PinnedShortcuts' dropdown isn't swallowed.
export default function RetractableTopBar({
  collapsed,
  onToggle,
  ...topBarProps
}: TopBarProps & { collapsed: boolean; onToggle: () => void }) {
  const [peek, setPeek] = useState(false);
  const expanded = !collapsed || peek;
  const wrapperRef = useRef<any>(null);

  // Hover-peek: while collapsed, hovering the wrapper (which, collapsed, is just
  // the pull-tab strip) reveals the bar; the revealed bar keeps the cursor
  // inside the wrapper, so it stays open until the cursor actually leaves.
  useEffect(() => {
    const el = wrapperRef.current;
    const domNode = el instanceof Element ? el : (el as any)?.getDOMNode?.() ?? null;
    if (!domNode) return;
    const onEnter = () => setPeek(true);
    const onLeave = () => setPeek(false);
    domNode.addEventListener('mouseenter', onEnter);
    domNode.addEventListener('mouseleave', onLeave);
    return () => {
      domNode.removeEventListener('mouseenter', onEnter);
      domNode.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  return (
    <View ref={wrapperRef} style={{ position: 'relative', zIndex: 100 }}>
      <View
        // overflow visible only when fully open so the dropdown can escape;
        // hidden otherwise so the sliding bar is clipped cleanly as it retracts.
        style={{
          maxHeight: expanded ? 200 : 0,
          opacity: expanded ? 1 : 0,
          overflow: expanded ? 'visible' : 'hidden',
        }}
        className="transition-all duration-300 ease-in-out"
      >
        <TopBar {...topBarProps} />
      </View>

      <View style={{ alignItems: 'center' }}>
        <TopBarPullTab direction={collapsed ? 'down' : 'up'} onPress={onToggle} />
      </View>
    </View>
  );
}
