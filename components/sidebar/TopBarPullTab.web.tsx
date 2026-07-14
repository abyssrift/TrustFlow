import { useTimer } from '@/contexts/TimerContext';
import { useToast } from '@/contexts/ToastContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { useTicker } from '@/hooks/useTicker';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { cssInterop } from 'react-native-css-interop';

cssInterop(FontAwesome, {
  className: {
    target: 'style',
    nativeStyleToProp: { color: true, size: true },
  },
} as any);

function fmt(total: number): string {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const p = (n: number) => n.toString().padStart(2, '0');
  return `${p(h)}:${p(m)}:${p(s)}`;
}

// Center "island" tab — a single Dynamic-Island element that morphs by context:
//  • no timer  → a chevron pill that widens to a "Hide/Show" label on hover.
//  • timer live → pulse + tabular elapsed; chevron toggles the bar, the time
//    opens the task, and hover reveals the task title + a stop button.
// useTicker lives HERE (a leaf), so the 1s tick never re-renders the topbar.
export default function TopBarPullTab({
  collapsed,
  onPress,
  style,
}: {
  collapsed: boolean;
  onPress: () => void;
  style?: any;
}) {
  const colors = useThemeColors();
  const [hover, setHover] = useState(false);
  const { isActive, activeSession, stopWork, serverTimeOffset } = useTimer();
  const elapsed = useTicker(isActive ? activeSession?.started_at ?? null : null, { offsetMs: serverTimeOffset });
  const router = useRouter();
  const { successToast, errorToast } = useToast();

  const chevron = collapsed ? 'chevron-down' : 'chevron-up';

  // No active session → the plain pull tab.
  if (!isActive) {
    return (
      <Pressable
        onPress={onPress}
        onHoverIn={() => setHover(true)}
        onHoverOut={() => setHover(false)}
        accessibilityLabel={collapsed ? 'Show top bar' : 'Hide top bar'}
        className="h-7 flex-row items-center justify-center rounded-full border border-surface-border bg-surface-card/95 px-2.5 premium-shadow glass-card hover:bg-surface-overlay transition-all duration-300 ease-in-out"
        style={style}
      >
        <FontAwesome name={chevron} size={10} color={colors.textDim} />
        <View
          style={{ overflow: 'hidden', maxWidth: hover ? 48 : 0, opacity: hover ? 1 : 0, marginLeft: hover ? 6 : 0 }}
          className="transition-all duration-300 ease-in-out"
        >
          <Text numberOfLines={1} className="text-[10px] font-bold text-typography-muted" style={{ whiteSpace: 'nowrap' } as any}>
            {collapsed ? 'Show' : 'Hide'}
          </Text>
        </View>
      </Pressable>
    );
  }

  // Active session → morphing timer island.
  const openTask = () => {
    if (activeSession?.task_id) router.push(`/task/${activeSession.task_id}` as any);
  };
  const stop = async () => {
    try {
      await stopWork();
      successToast('Timer stopped.');
    } catch (err: any) {
      errorToast(err?.message || 'Could not stop the timer.');
    }
  };

  return (
    <Pressable
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      className="h-7 flex-row items-center rounded-full border border-brand-primary/30 bg-surface-card/95 pl-1 pr-1.5 premium-shadow glass-card transition-all duration-300 ease-in-out"
      style={style}
    >
      {/* Chevron — toggles the bar. */}
      <Pressable
        onPress={onPress}
        accessibilityLabel={collapsed ? 'Show top bar' : 'Hide top bar'}
        className="h-5 w-5 items-center justify-center rounded-full hover:bg-surface-overlay transition-colors duration-150"
      >
        <FontAwesome name={chevron} size={9} color={colors.textDim} />
      </Pressable>

      {/* Pulse + elapsed — opens the task. tabular-nums keeps width steady. */}
      <Pressable onPress={openTask} accessibilityLabel="Open active task" className="flex-row items-center gap-1.5 px-1.5">
        <View className="h-2 w-2 rounded-full bg-brand-primary pulse-animation" />
        <Text
          className="font-mono text-[11px] font-black text-typography-main"
          style={{ fontVariant: ['tabular-nums'] } as any}
        >
          {fmt(elapsed)}
        </Text>
      </Pressable>

      {/* Hover reveal — task title + stop. */}
      <View
        style={{ overflow: 'hidden', maxWidth: hover ? 190 : 0, opacity: hover ? 1 : 0 }}
        className="flex-row items-center transition-all duration-300 ease-in-out"
      >
        <Text
          numberOfLines={1}
          className="mr-2 max-w-[120px] text-[10px] font-bold text-typography-muted"
          style={{ whiteSpace: 'nowrap' } as any}
        >
          {activeSession?.task?.title || 'Active session'}
        </Text>
        <Pressable
          onPress={stop}
          accessibilityLabel="Stop timer"
          className="h-5 w-5 items-center justify-center rounded-full border border-state-danger/20 bg-state-danger/10 hover:bg-state-danger/25 transition-colors duration-150"
        >
          <FontAwesome name="stop" size={8} color={colors.danger} />
        </Pressable>
      </View>
    </Pressable>
  );
}
