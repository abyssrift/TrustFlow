import Tooltip from '@/components/common/Tooltip';
import { useThemeColors } from '@/hooks/useThemeColors';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React from 'react';
import { LayoutAnimation, Platform, Text, TouchableOpacity, UIManager, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

// Enable LayoutAnimation on Android/iOS for smooth expand/collapse. Native only —
// react-native-web's UIManager.configureNextLayoutAnimation is a no-op stub (it
// just fires the completion callback), so LayoutAnimation animates nothing on
// web. Web gets its own height-driven reanimated path below instead.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface CollapsibleCardProps {
  /** Section title shown in the header (include any count, e.g. "People (3)"). */
  title: string;
  /** Optional FontAwesome icon rendered before the title. */
  icon?: string;
  /** Optional node rendered on the right side of the header, before the chevron. */
  headerRight?: React.ReactNode;
  /** Whether the card starts collapsed. Defaults to false (expanded). */
  defaultCollapsed?: boolean;
  children: React.ReactNode;
}

/**
 * Card chrome + a tappable header that collapses/expands its body.
 * Centralizes the look of every task-detail section so the screen can keep
 * secondary blocks tucked away by default and reduce visual clutter.
 */
export default function CollapsibleCard({
  title,
  icon,
  headerRight,
  defaultCollapsed = false,
  children,
}: CollapsibleCardProps) {
  const colors = useThemeColors();
  const [collapsed, setCollapsed] = React.useState(defaultCollapsed);
  const isWeb = Platform.OS === 'web';

  // Web: height-driven reanimated instead of LayoutAnimation (see the no-op
  // note above). Lazy-mounts children on first expand — same cost profile as
  // native's `!collapsed && children`, so a default-collapsed card doesn't
  // pay to render content nobody has opened yet — then keeps them mounted so
  // later collapses can animate closed instead of vanishing.
  const [everOpened, setEverOpened] = React.useState(!defaultCollapsed);
  const [contentHeight, setContentHeight] = React.useState(0);
  const reduceMotion = useReducedMotion();
  const openProgress = useSharedValue(defaultCollapsed ? 0 : 1);

  const toggle = () => {
    const willOpen = collapsed; // collapsed now => about to open
    if (isWeb) {
      if (willOpen) setEverOpened(true);
      openProgress.value = reduceMotion ? (willOpen ? 1 : 0) : withTiming(willOpen ? 1 : 0, { duration: 220 });
    } else {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    }
    setCollapsed(!willOpen);
  };

  const animatedBodyStyle = useAnimatedStyle(() => ({
    height: contentHeight * openProgress.value,
    opacity: openProgress.value,
  }));

  return (
    <View className="bg-surface-card rounded-2xl border border-surface-border p-4">
      <View className={`flex-row items-center justify-between ${collapsed ? '' : 'mb-3'}`}>
        {/* Title area — tapping this toggles the card */}
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={toggle}
          className="flex-row items-center flex-1 mr-2 py-0.5"
        >
          {icon && (
            <FontAwesome name={icon as any} size={12} color={colors.primary} style={{ marginRight: 8 }} />
          )}
          <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.15em]" numberOfLines={1}>
            {title}
          </Text>
        </TouchableOpacity>

        {/* Right area — headerRight has its own touch target; chevron also toggles */}
        <View className="flex-row items-center gap-2">
          {headerRight}
          <Tooltip label={collapsed ? 'Expand' : 'Collapse'} side="left">
            <TouchableOpacity onPress={toggle} activeOpacity={0.6} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
              <FontAwesome name={collapsed ? 'chevron-down' : 'chevron-up'} size={10} color={colors.muted} />
            </TouchableOpacity>
          </Tooltip>
        </View>
      </View>

      {isWeb ? (
        everOpened && (
          <Animated.View style={[animatedBodyStyle, { overflow: 'hidden' }]}>
            <View onLayout={(e) => setContentHeight(e.nativeEvent.layout.height)}>
              {children}
            </View>
          </Animated.View>
        )
      ) : (
        !collapsed && children
      )}
    </View>
  );
}
