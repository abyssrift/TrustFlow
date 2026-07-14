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

const ANIM_MS = 300;
const LEAVE_GRACE_MS = 160; // brief exits (overshoot, crossing a gap) don't collapse

// Wraps TopBar with the retract behavior (item 6): the bar collapses to a
// centered "island" tab, and re-expands on click (persistent) or a gentle
// hover-peek. The whole subtree owns its stacking context so the pinned-picker
// dropdown isn't swallowed.
export default function RetractableTopBar({
  collapsed,
  onToggle,
  themeOpen,
  ...topBarProps
}: TopBarProps & { collapsed: boolean; onToggle: () => void; themeOpen: boolean }) {
  const [peek, setPeek] = useState(false);
  // Interaction lock: while any child interaction is live (theme popover, pinned
  // picker, focused search) the bar must never retract out from under it, even
  // if the cursor wanders off. This is the "won't collapse mid-task" guarantee.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const locked = themeOpen || pickerOpen || searchFocused;
  const expanded = !collapsed || peek || locked;

  // overflow must be hidden *during* the slide so the bar clips cleanly (and both
  // directions animate symmetrically), then visible once settled so the picker
  // dropdown can escape. Toggling it instantly would make expand a fade, not a slide.
  const [overflowVisible, setOverflowVisible] = useState(expanded);

  const wrapperRef = useRef<any>(null);
  const leaveTimer = useRef<any>(null);
  const suppressPeek = useRef(false); // set on click-collapse so a lingering hover can't re-peek

  useEffect(() => {
    if (expanded) {
      const t = setTimeout(() => setOverflowVisible(true), ANIM_MS + 20);
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
        // ponytail: maxHeight ~ the real bar height (h-16) so the slide is tight;
        // reflows the content pane each frame — swap to a transform overlay if a
        // heavy page (kanban) drops frames on collapse.
        style={{
          maxHeight: expanded ? 72 : 0,
          opacity: expanded ? 1 : 0,
          overflow: overflowVisible ? 'visible' : 'hidden',
        }}
        className="transition-all duration-300 ease-in-out"
      >
        <TopBar
          {...topBarProps}
          onPickerOpenChange={setPickerOpen}
          onSearchFocusChange={setSearchFocused}
        />
      </View>

      {/* Center "island" tab. box-none so the full-width container only catches
          clicks on the pill itself; its top animates in lockstep with the bar. */}
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
