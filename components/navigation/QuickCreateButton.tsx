import { useAuth } from '@/contexts/AuthContext';
import { useModalDispatch } from '@/contexts/ModalDispatchContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

export const FAB_SIZE = 52;
const MENU_WIDTH = 210;
const MENU_GAP = 12;

type IconName = React.ComponentProps<typeof FontAwesome>['name'];

const SHADOW = {
  shadowColor: '#000',
  shadowOpacity: 0.24,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 8 },
  elevation: 10,
} as const;

/**
 * The floating `+`, rendered inline with the tab bar (same row, separate
 * pill) rather than stacked above it. Its quick-create menu pops upward from
 * directly above the button via absolute positioning, so opening it never
 * reflows the row.
 *
 * Native only — it renders inside FloatingTabBar, and
 * `app/(tabs)/_layout.web.tsx` never mounts that.
 *
 * The menu is a plain animated View, not a Modal: FloatingTabBar's container
 * expands to full screen while `open` so its backdrop Pressable stays inside
 * that parent's bounds (Android drops touches on out-of-bounds children).
 */
export default function QuickCreateButton({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const colors = useThemeColors();
  const router = useRouter();
  const { hasPermission } = useAuth();
  const { summon } = useModalDispatch();
  // Kept mounted through the closing animation, then dropped.
  const [rendered, setRendered] = useState(open);

  const progress = useSharedValue(0);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const duration = reduceMotion ? 0 : 180;
    if (open) {
      setRendered(true);
      progress.value = withTiming(1, { duration });
    } else {
      progress.value = withTiming(0, { duration }, (finished) => {
        if (finished) runOnJS(setRendered)(false);
      });
    }
  }, [open, progress, reduceMotion]);

  const menuStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 12 }, { scale: 0.92 + progress.value * 0.08 }],
  }));

  // The + rotates into an × while the menu is up.
  const plusStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${progress.value * 45}deg` }] }));

  // ponytail: flat list, one row each. Projects/portfolios are still in dev —
  // add a row + its permission key here when they ship.
  // Task, report and upload all go through the global modal dispatcher (#323 /
  // #340); ModalHost owns the actual modals. (On native the upload modal is a
  // stub that redirects to /filehub — see components/filehub/UploadComposerModal.tsx.)
  const actions: { id: string; icon: IconName; label: string; permission?: string; run: () => void }[] = [
    { id: 'task', icon: 'check-square-o', label: 'New Task', permission: 'task.create', run: () => summon('create-task') },
    { id: 'report', icon: 'file-text-o', label: 'New Report', permission: 'report.view', run: () => summon('generate-report') },
    { id: 'upload', icon: 'cloud-upload', label: 'Upload File', permission: 'filehub:view', run: () => summon('upload') },
    { id: 'search', icon: 'search', label: 'Search', run: () => router.push('/search') },
    { id: 'deadlines', icon: 'calendar-o', label: 'Deadlines', run: () => router.push('/deadlines') },
  ];

  const items = actions.filter((a) => !a.permission || hasPermission(a.permission));

  // Relative wrapper sized exactly to the FAB — the menu is absolutely
  // positioned off of it, so it never participates in the tab bar's row layout
  // or shifts the pill next to it.
  return (
      <View style={{ position: 'relative', width: FAB_SIZE, height: FAB_SIZE }}>
        {/* Shadow on the outer view, clipping on the inner — iOS drops the
            shadow when the same view has `overflow: hidden`. */}
        {rendered && (
          <Animated.View
            style={[
              { position: 'absolute', bottom: FAB_SIZE + MENU_GAP, left: (FAB_SIZE - MENU_WIDTH) / 2, width: MENU_WIDTH, borderRadius: 20, ...SHADOW },
              menuStyle,
            ]}
          >
            <View
              style={{ borderRadius: 20, overflow: 'hidden', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}
            >
              {items.map((a, i) => (
                <Pressable
                  key={a.id}
                  onPress={() => {
                    onOpenChange(false);
                    a.run();
                  }}
                  className={`flex-row items-center px-4 py-3 active:bg-brand-primary/10 ${i !== items.length - 1 ? 'border-b border-surface-border/50' : ''}`}
                >
                  <View className="h-8 w-8 items-center justify-center rounded-lg bg-brand-primary/10">
                    <FontAwesome name={a.icon} size={14} color={colors.primary} />
                  </View>
                  <Text className="ml-3 font-bold text-sm text-typography-main">{a.label}</Text>
                </Pressable>
              ))}
            </View>
          </Animated.View>
        )}

        <Pressable
          onPress={() => onOpenChange(!open)}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel="Quick create"
          style={({ pressed }) => ({
            width: FAB_SIZE,
            height: FAB_SIZE,
            borderRadius: FAB_SIZE / 2,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.primary,
            transform: [{ scale: pressed ? 0.94 : 1 }],
            ...SHADOW,
          })}
        >
          <Animated.View style={plusStyle}>
            <FontAwesome name="plus" size={20} color="#fff" />
          </Animated.View>
        </Pressable>
      </View>
  );
}
