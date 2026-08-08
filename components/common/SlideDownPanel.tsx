import { useThemeColors } from '@/hooks/useThemeColors';
import React from 'react';
import { LayoutAnimation, Platform, ScrollView, UIManager, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { noticeReducedMotion } from '@/lib/reducedMotionNotice';

// Enable LayoutAnimation on Android/iOS for smooth expand/collapse. Native only —
// react-native-web's UIManager.configureNextLayoutAnimation is a no-op stub (it
// just fires the completion callback), so LayoutAnimation animates nothing on
// web. Web gets its own height-driven reanimated path below instead.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface SlideDownPanelProps {
  /** Fully controlled from outside — no internal open state. Lets desktop +
   *  mobile-web shells share one piece of state without the panel caring where
   *  that state lives. */
  isOpen: boolean;
  /** Escape hatch for parents that need the measured content height (e.g. to
   *  offset something below the panel during animation). */
  onMeasured?: (height: number) => void;
  /** Open/close duration in ms. Default 220. */
  duration?: number;
  /**
   * Lazy-mounts content on first open, then keeps it mounted so later toggles
   *  animate down instead of vanishing. Default true.
   */
  lazyMount?: boolean;
  /**
   * Max height of the animated region. When set, content scrolls internally
   *  once it exceeds this instead of the whole page scrolling past it. The
   *  panel animates up to `maxHeight` (clamped) but the inner ScrollView still
   *  lets the user reach everything.
   */
  maxHeight?: number;
  /** Container passthrough for width/padding — not animation-relevant. */
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

/**
 * The animation primitive for "a panel that slides open from a trigger" — a
 * controlled, animated expand/collapse container. Sibling to CollapsibleCard,
 * same platform split:
 *  - native: LayoutAnimation (the OS animates the height for us);
 *  - web:    height driven by reanimated `withTiming` against an
 *            `onLayout`-measured content height (the reference pattern in
 *            CollapsibleCard.tsx — reanimated `entering`/`exiting`/`layout`
 *            silently no-op on this app's web build, LayoutAnimation is a
 *            confirmed no-op there, see `.agents/rules/animation-consistency.md`).
 *
 * It owns *only* the animation: no trigger, no open/close callbacks. FilterPanel
 * composes this with a trigger and adds the footer/apply semantics.
 */
export default function SlideDownPanel({
  isOpen,
  onMeasured,
  duration = 220,
  lazyMount = true,
  maxHeight,
  style,
  children,
}: SlideDownPanelProps) {
  const colors = useThemeColors();
  const isWeb = Platform.OS === 'web';
  const reduceMotion = useReducedMotion();

  // Web: lazy-mount content on first open, then keep it mounted so later
  // toggles can animate down instead of vanishing — and so the height being
  // animated against is always the *current* rendered content.
  const [everOpened, setEverOpened] = React.useState(!lazyMount || isOpen);
  const [contentHeight, setContentHeight] = React.useState(0);
  const progress = useSharedValue(isOpen ? 1 : 0);

  React.useEffect(() => {
    if (isOpen) setEverOpened(true);
  }, [isOpen]);

  const handleMeasure = (h: number) => {
    if (h === contentHeight) return;
    setContentHeight(h);
    onMeasured?.(h);
  };

  // The animation proper. On web, drive a shared-value height from 0→measured
  // (open) or measured→0 (close); native delegates to LayoutAnimation.
  React.useEffect(() => {
    if (isWeb) {
      if (reduceMotion) {
        noticeReducedMotion();
        progress.value = isOpen ? 1 : 0;
      } else {
        progress.value = withTiming(isOpen ? 1 : 0, { duration });
      }
    } else {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    }
  }, [isOpen, isWeb, reduceMotion, duration, progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    height: contentHeight * progress.value,
    opacity: progress.value,
    // Web-only: clip while collapsing/expanding so nothing bleeds out mid-motion.
    // Once fully open the whole app already tolerates the panel's own content;
    // popovers rendered via the app's Calendar/Popup escape via their own
    // portal/overlay layer, so permanent overflow hidden is safe here.
    overflow: 'hidden',
  }));

  // Animated on web, plain conditional on native (LayoutAnimation reflows the
  // surrounding layout for us there).
  if (isWeb) {
    if (!everOpened) return null;
    return (
      <Animated.View style={[animatedStyle, style]}>
        <View
          onLayout={(e) => handleMeasure(e.nativeEvent.layout.height)}
          style={maxHeight ? { maxHeight } : undefined}
        >
          {maxHeight ? (
            <ScrollView style={{ maxHeight }} showsVerticalScrollIndicator={false} nestedScrollEnabled>
              {children}
            </ScrollView>
          ) : (
            children
          )}
        </View>
      </Animated.View>
    );
  }

  return (
    <View style={style}>
      {isOpen && (maxHeight ? <ScrollView style={{ maxHeight }}>{children}</ScrollView> : children)}
    </View>
  );
}