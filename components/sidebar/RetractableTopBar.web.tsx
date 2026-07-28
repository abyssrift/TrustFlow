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

// Retractable top bar. Peek (hover-to-glance) is now deliberately DECOUPLED
// from the island: hovering the island pill morphs the island open and does
// NOT slide the bar; the bar only peeks when you hover its own body or the
// thin top-edge strip beside the pill. Clicking the chevron pins/unpins it.
// That double-motion (peek + island both firing on one hover) was the finicky
// thing — killing it is the whole point here.
export default function RetractableTopBar({
  collapsed,
  onToggle,
  ...topBarProps
}: TopBarProps & { collapsed: boolean; onToggle: () => void }) {
  const [peek, setPeek] = useState(false);
  // An open shortcut picker pins the bar — otherwise leaving the bar to reach
  // the picker (which hangs below it) collapses the bar out from under it.
  const [pickerOpen, setPickerOpen] = useState(false);
  const expanded = !collapsed || peek || pickerOpen;

  const leaveTimer = useRef<any>(null);
  const suppressPeek = useRef(false); // set on click-collapse so a lingering hover can't re-peek

  const clearTimer = () => {
    if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null; }
  };
  const peekOn = () => { clearTimer(); if (!suppressPeek.current) setPeek(true); };
  const peekOff = () => {
    clearTimer();
    leaveTimer.current = setTimeout(() => { setPeek(false); suppressPeek.current = false; }, LEAVE_GRACE_MS);
  };
  useEffect(() => clearTimer, []);

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

  // Clicking the island to collapse must actually collapse even though the cursor
  // is still near it — suppress the re-peek until the cursor genuinely leaves.
  const handleToggle = () => {
    if (!collapsed) {
      suppressPeek.current = true;
      setPeek(false);
    }
    onToggle();
  };

  return (
    <View style={{ position: 'relative', zIndex: 100 }}>
      {/* Top-edge peek trigger — only while collapsed. Lets you glance the bar by
          nudging the cursor to the screen top; the island pill (centered, higher
          z-index) sits above this and catches its own hover, so hovering the pill
          expands the island WITHOUT peeking the bar. */}
      {collapsed && (
        <div
          onMouseEnter={peekOn}
          onMouseLeave={peekOff}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 10, zIndex: 105 }}
        />
      )}

      {/* The bar itself is a peek region too, so once it's open, staying on it
          keeps it open. */}
      <div onMouseEnter={peekOn} onMouseLeave={peekOff}>
        <View
          style={{
            maxHeight: expanded ? 72 : 0,
            opacity: expanded ? 1 : 0,
            overflow: overflowVisible ? 'visible' : 'hidden',
          }}
          className="transition-all duration-300 ease-in-out"
        >
          <TopBar {...topBarProps} onPickerOpenChange={setPickerOpen} />
        </View>
      </div>

      {/* Center island. box-none so only the pill catches clicks; its top animates
          in lockstep with the bar (straddles the bottom edge open, floats top
          when collapsed). NOT a peek trigger — its own hover expands the island. */}
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
