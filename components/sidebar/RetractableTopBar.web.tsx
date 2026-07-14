import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import type { Shortcut } from './constants';
import TopBar from './TopBar.web';
import TopBarPullTab from './TopBarPullTab.web';

type TopBarProps = {
  topSearch: string;
  setTopSearch: (value: string) => void;
  unreadCount: number;
  profileAvatarUrl: string | null;
  profileLabel: string;
  visibleShortcuts: Shortcut[];
  pipelines: { id: string; name: string }[];
};

const LEAVE_GRACE_MS = 160; // brief exits (overshoot, crossing a gap) don't collapse

// Retractable top bar (item 6). Toggles on click, and hover-peeks open while the
// cursor is over the bar/tab. The finicky part was never the peek — it was the
// timer island *revealing* controls on hover; that's gone (controls are static
// now), so peek is the only thing hover does: one clear behavior.
export default function RetractableTopBar({
  collapsed,
  onToggle,
  ...topBarProps
}: TopBarProps & { collapsed: boolean; onToggle: () => void }) {
  const [peek, setPeek] = useState(false);
  const expanded = !collapsed || peek;

  const wrapperRef = useRef<any>(null);
  const leaveTimer = useRef<any>(null);
  const suppressPeek = useRef(false); // set on click-collapse so a lingering hover can't re-peek

  // overflow stays hidden during the slide so the bar clips cleanly, then goes
  // visible once settled so the pinned-picker dropdown can escape the clip.
  const [overflowVisible, setOverflowVisible] = useState(expanded);
  useEffect(() => {
    if (expanded) {
      const t = setTimeout(() => setOverflowVisible(true), 320);
      return () => clearTimeout(t);
    }
    setOverflowVisible(false);
  }, [expanded]);

  useEffect(() => {
    const el = wrapperRef.current;
    const domNode = el instanceof Element ? el : (el as any)?.getDOMNode?.() ?? null;
    if (!domNode) return;
    const clearTimer = () => {
      if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null; }
    };
    const onEnter = () => {
      clearTimer();
      if (!suppressPeek.current) setPeek(true);
    };
    const onLeave = () => {
      clearTimer();
      leaveTimer.current = setTimeout(() => {
        setPeek(false);
        suppressPeek.current = false;
      }, LEAVE_GRACE_MS);
    };
    domNode.addEventListener('mouseenter', onEnter);
    domNode.addEventListener('mouseleave', onLeave);
    return () => {
      clearTimer();
      domNode.removeEventListener('mouseenter', onEnter);
      domNode.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  // Clicking the island to collapse must actually collapse even though the cursor
  // is still on it — suppress the re-peek until the cursor genuinely leaves.
  const handleToggle = () => {
    if (!collapsed) {
      suppressPeek.current = true;
      setPeek(false);
    }
    onToggle();
  };

  return (
    <View ref={wrapperRef} style={{ position: 'relative', zIndex: 100 }}>
      <View
        style={{
          maxHeight: expanded ? 72 : 0,
          opacity: expanded ? 1 : 0,
          overflow: overflowVisible ? 'visible' : 'hidden',
        }}
        className="transition-all duration-300 ease-in-out"
      >
        <TopBar {...topBarProps} />
      </View>

      {/* Center island. box-none so only the pill catches clicks; its top animates
          in lockstep with the bar (straddles the bottom edge open, floats top
          when collapsed). */}
      <View
        pointerEvents="box-none"
        style={{ position: 'absolute', left: 0, right: 0, top: expanded ? 52 : 4, alignItems: 'center', zIndex: 110 }}
        className="transition-all duration-300 ease-in-out"
      >
        <TopBarPullTab collapsed={collapsed} onPress={handleToggle} />
      </View>
    </View>
  );
}
