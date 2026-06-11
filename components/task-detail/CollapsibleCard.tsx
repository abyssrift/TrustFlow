import { useThemeColors } from '@/hooks/useThemeColors';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React from 'react';
import { LayoutAnimation, Platform, Text, TouchableOpacity, UIManager, View } from 'react-native';

// Enable LayoutAnimation on Android for smooth expand/collapse.
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

  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setCollapsed((c) => !c);
  };

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
          <TouchableOpacity onPress={toggle} activeOpacity={0.6} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
            <FontAwesome name={collapsed ? 'chevron-down' : 'chevron-up'} size={10} color={colors.muted} />
          </TouchableOpacity>
        </View>
      </View>

      {!collapsed && children}
    </View>
  );
}
