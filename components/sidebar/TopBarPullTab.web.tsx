import React from 'react';
import DynamicIsland from '../island/DynamicIsland.web';

// The center island. Its show/hide-topbar chevron is the island's permanent
// leading control; everything else it displays (timer, uploads, report
// generation) is published to IslandContext and rendered by DynamicIsland.
// The timer used to be wired in HERE directly — it now arrives through the
// registry like any other activity (see IslandTimerBridge), so this component
// is just the chevron + a mount point.
export default function TopBarPullTab({
  collapsed,
  onPress,
}: {
  collapsed: boolean;
  onPress: () => void;
  style?: any;
}) {
  return (
    <DynamicIsland
      leading={{
        icon: collapsed ? 'chevron-down' : 'chevron-up',
        label: collapsed ? '' : '',
        accessibilityLabel: collapsed ? 'Show top bar' : 'Hide top bar',
        onPress,
      }}
    />
  );
}
