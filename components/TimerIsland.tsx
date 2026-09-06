import Popup from '@/components/common/Popup';
import Tooltip from '@/components/common/Tooltip';
import { useTimer } from '@/contexts/TimerContext';
import { useToast } from '@/contexts/ToastContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { useTicker } from '@/hooks/useTicker';
import { formatStopwatch } from '@/lib/time';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, PanResponder, Text, TouchableOpacity, View } from 'react-native';

const SCREEN_WIDTH = Dimensions.get('window').width;

const MIN_ISLAND_WIDTH = Math.min(140, SCREEN_WIDTH - 40);
const MAX_ISLAND_WIDTH = Math.min(300, SCREEN_WIDTH - 40);
const ISLAND_WIDTH_DELTA = MAX_ISLAND_WIDTH - MIN_ISLAND_WIDTH;
const EDGE_MARGIN = 8;

// `floating` draws the draggable pill (mobile). On desktop web the topbar's
// morphing island shows the timer instead, so we pass floating={false} there —
// but still mount for the idle-warning modal, which is platform-agnostic.
export default function TimerIsland({ floating = true }: { floating?: boolean }) {
  const { isActive, activeSession, stopWork, serverTimeOffset, smartTimer } = useTimer();
  const { successToast, errorToast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const router = useRouter();
  const colors = useThemeColors();

  // Animation values
  const pan = useRef(new Animated.ValueXY({ x: (SCREEN_WIDTH / 2) - 80, y: 20 })).current;
  const scale = useRef(new Animated.Value(0)).current;
  const expandAnim = useRef(new Animated.Value(0)).current;

  // Track dragging state to prevent clicks during drag
  const isDragging = useRef(false);

  useEffect(() => {
    if (isActive) {
      Animated.spring(scale, {
        toValue: 1,
        useNativeDriver: false,
        tension: 50,
        friction: 7,
      }).start();
    } else {
      Animated.timing(scale, {
        toValue: 0,
        duration: 300,
        useNativeDriver: false,
      }).start();
      setExpanded(false);
      // Reset the width/height driver too — otherwise the next session starts
      // scaled in at whatever expanded/collapsed size this one ended on, while
      // `expanded` (and the buttons gated on it) reset to collapsed.
      expandAnim.setValue(0);
    }
  }, [isActive]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        isDragging.current = false;
        pan.setOffset({
          x: (pan.x as any)._value,
          y: (pan.y as any)._value
        });
        pan.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: (e, gesture) => {
        if (Math.abs(gesture.dx) > 5 || Math.abs(gesture.dy) > 5) {
          isDragging.current = true;
        }
        return Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false })(e, gesture);
      },
      onPanResponderRelease: () => {
        pan.flattenOffset();
        // Only keep the *collapsed* pill on screen here — this fires on every
        // drag, so reserving room for the expanded width (below) made the
        // legal zone a sliver near one edge and everything snapped back there.
        const minX = EDGE_MARGIN;
        const maxX = SCREEN_WIDTH - MIN_ISLAND_WIDTH - EDGE_MARGIN;
        const currentX = (pan.x as any)._value;
        const clampedX = Math.min(Math.max(currentX, minX), maxX);
        if (clampedX !== currentX) {
          Animated.spring(pan.x, { toValue: clampedX, useNativeDriver: false, friction: 8, tension: 40 }).start();
        }
        // Was only ever reset in onPanResponderGrant (gesture start) — after a
        // real drag this stayed `true` forever, permanently no-op'ing
        // toggleExpand() and the task-name press on every tap from then on.
        isDragging.current = false;
      },
    })
  ).current;

  const toggleExpand = () => {
    if (isDragging.current) return;
    const opening = !expanded;
    Animated.spring(expandAnim, {
      toValue: opening ? 1 : 0,
      useNativeDriver: false,
      friction: 8,
      tension: 40,
    }).start();
    if (opening) {
      // Reserve room for the expanded width only when actually expanding
      // (rare, deliberate) rather than on every drag release (frequent) —
      // the expanded pill's left edge ends up at pan.x - ISLAND_WIDTH_DELTA/2
      // once centerOffsetX reaches its max, so keep that within bounds.
      const currentX = (pan.x as any)._value;
      const minPanX = EDGE_MARGIN + ISLAND_WIDTH_DELTA / 2;
      const maxPanX = SCREEN_WIDTH - MAX_ISLAND_WIDTH - EDGE_MARGIN + ISLAND_WIDTH_DELTA / 2;
      const clampedX = Math.min(Math.max(currentX, minPanX), maxPanX);
      if (clampedX !== currentX) {
        Animated.spring(pan.x, { toValue: clampedX, useNativeDriver: false, friction: 8, tension: 40 }).start();
      }
    }
    setExpanded(opening);
  };

  if (!isActive) return null;

  const islandWidth = expandAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [MIN_ISLAND_WIDTH, MAX_ISLAND_WIDTH],
  });

  const islandHeight = expandAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [38, 70],
  });

  // Grow symmetrically from the pill's current center (like the iPhone
  // Dynamic Island) instead of anchoring at the left edge and only pushing
  // rightward, which could push trailing controls off-screen.
  const centerOffsetX = expandAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -ISLAND_WIDTH_DELTA / 2],
  });

  return (
    <>
    <IdleWarning smartTimer={smartTimer} stopWork={stopWork} colors={colors} />
    {floating && (
    <Animated.View
      {...panResponder.panHandlers}
      style={{
        position: 'absolute',
        left: Animated.add(pan.x, centerOffsetX),
        top: pan.y,
        transform: [{ scale }],
        width: islandWidth,
        height: islandHeight,
        zIndex: 9999,
      }}
      className="bg-surface-card rounded-full shadow-2xl border border-surface-border/50 items-center justify-center overflow-hidden"
    >
      <View className="flex-row items-center px-3 w-full h-full">
        {/* Left: Pulse & Timer */}
        <TouchableOpacity
          onPress={toggleExpand}
          activeOpacity={0.8}
          className="flex-row items-center"
        >
           <View className="w-2 h-2 rounded-full bg-brand-primary animate-pulse mr-2.5 ml-1" />
           {!expanded && (
             <TimerElapsed startedAt={activeSession?.started_at ?? null} offsetMs={serverTimeOffset} className="text-typography-main font-mono text-xs font-black mr-2" />
           )}
        </TouchableOpacity>

        {/* Info (Expanded) */}
        {expanded && (
          <View className="flex-1 px-1">
            <Text className="text-typography-muted text-[7px] font-black uppercase tracking-tighter opacity-60">
              {activeSession?.id === 'pending' ? 'Committing...' : 'Active Session'}
            </Text>
            <TouchableOpacity onPress={() => !isDragging.current && router.push(`/task/${activeSession?.task_id}`)}>
              <Text className="text-typography-main text-[10px] font-bold" numberOfLines={1}>
                {activeSession?.task?.title || 'Task Details'}
              </Text>
            </TouchableOpacity>
            <TimerElapsed startedAt={activeSession?.started_at ?? null} offsetMs={serverTimeOffset} className="text-brand-primary font-mono text-[9px] font-black mt-0.5" />
          </View>
        )}

        {/* Right: Controls */}
        <View className="flex-row items-center gap-1.5 pr-1">
          {expanded && (
            <Tooltip label="Stop timer">
              <TouchableOpacity
                 onPress={async () => {
                   try {
                     await stopWork();
                     successToast('Work session stopped.');
                   } catch (err: any) {
                     errorToast(err?.message || 'Could not stop work session.');
                   }
                 }}
                 className="w-7 h-7 rounded-full bg-state-danger/10 items-center justify-center border border-state-danger/20 active:bg-state-danger/30"
               >
                 <FontAwesome name="stop" size={9} color={colors.danger} />
              </TouchableOpacity>
            </Tooltip>
          )}

          <Tooltip label={expanded ? 'Collapse' : 'Expand'}>
            <TouchableOpacity
              onPress={toggleExpand}
              className="w-7 h-7 rounded-full bg-white/10 items-center justify-center active:bg-white/20"
            >
              <FontAwesome name={expanded ? 'compress' : 'expand'} size={9} color={colors.textMain} />
            </TouchableOpacity>
          </Tooltip>
        </View>
      </View>
    </Animated.View>
    )}
    </>
  );
}

// Ticks once a second in its own leaf so the 1s re-render doesn't hit the
// rest of the island (buttons, pulse dot, drag layout) — see useTicker's doc.
function TimerElapsed({ startedAt, offsetMs, className }: { startedAt: string | null; offsetMs: number; className?: string }) {
  const elapsedSeconds = useTicker(startedAt, { offsetMs });
  return <Text className={className}>{formatStopwatch(elapsedSeconds)}</Text>;
}

const IdleWarning = ({ smartTimer, stopWork, colors }: any) => (
  <Popup
    visible={smartTimer.showIdleModal}
    onClose={() => smartTimer.setShowIdleModal(false)}
    presentation="centered"
    forceCenteredOnNative
    dismissible={false}
    maxWidth={384}
    containerClassName="rounded-2xl p-6 shadow-2xl"
  >
    <View className="items-center mb-4">
      <View
        className="w-12 h-12 rounded-full items-center justify-center mb-3"
        style={{ backgroundColor: `${colors.warning}26` }}
      >
        <FontAwesome name="clock-o" size={22} color={colors.warning} />
      </View>
      <Text className="font-bold text-base text-center" style={{ color: colors.textMain }}>Are you still working?</Text>
      <Text className="text-sm text-center mt-1" style={{ color: colors.textMuted }}>
        No activity detected for 30 minutes. The timer will stop automatically in 2 minutes.
      </Text>
    </View>
    <View className="flex-row gap-3">
      <TouchableOpacity
        onPress={() => { smartTimer.setShowIdleModal(false); smartTimer.recordActivity(); }}
        className="flex-1 rounded-xl py-3 items-center border"
        style={{ backgroundColor: `${colors.primary}1a`, borderColor: `${colors.primary}4d` }}
      >
        <Text className="font-semibold text-sm" style={{ color: colors.primary }}>Keep Working</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => { smartTimer.setShowIdleModal(false); stopWork(); }}
        className="flex-1 rounded-xl py-3 items-center border"
        style={{ backgroundColor: `${colors.danger}1a`, borderColor: `${colors.danger}4d` }}
      >
        <Text className="font-semibold text-sm" style={{ color: colors.danger }}>Stop Timer</Text>
      </TouchableOpacity>
    </View>
  </Popup>
);
