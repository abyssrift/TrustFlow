import { useAuth } from '@/contexts/AuthContext';
import { useBillingPlan } from '@/hooks/useBillingPlan';
import { useThemeColors } from '@/hooks/useThemeColors';
import { formatFileSize } from '@/lib/taskFileHelpers';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Link } from 'expo-router';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { cssInterop } from 'react-native-css-interop';
import Tooltip from '@/components/common/Tooltip';

cssInterop(FontAwesome, {
  className: {
    target: 'style',
    nativeStyleToProp: { color: true, size: true },
  },
} as any);

const STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  trialing: 'Trial',
  past_due: 'Past due',
  canceled: 'Canceled',
  none: 'No plan',
};

export default function BillingMeter({ isExpanded }: { isExpanded: boolean }) {
  const colors = useThemeColors();
  const { profile, hasPermission } = useAuth();
  const canManage = !!profile?.is_owner || hasPermission('company.billing');
  const { loading, planName, status, storageUsedBytes, storageLimitBytes } = useBillingPlan();

  if (loading) return null;

  const pct = storageLimitBytes ? Math.min(100, (storageUsedBytes / storageLimitBytes) * 100) : 0;
  const statusColor =
    status === 'past_due' ? colors.danger
      : status === 'trialing' ? colors.warning
        : status === 'canceled' || status === 'none' ? colors.textDim
          : colors.success;
  const barColor = storageLimitBytes && pct >= 95 ? colors.danger : storageLimitBytes && pct >= 80 ? colors.warning : colors.primary;

  const body = (
    <View
      className={`group relative min-h-11 flex-row items-center overflow-hidden rounded-xl border border-surface-border p-3 ${canManage ? 'hover:bg-surface-card' : ''
        }`}
    >
      <View className={`${isExpanded ? 'w-8' : 'w-full'} items-center`}>
        <FontAwesome name="credit-card" size={16} color={statusColor} />
      </View>
      {isExpanded && (
        <View className="ml-2 flex-1">
          <View className="flex-row items-center justify-between">
            <Text className="font-bold text-typography-main text-xs whitespace-nowrap" numberOfLines={1}>
              {planName}
            </Text>
            <Text className="ml-2 text-[9px] font-black uppercase tracking-wide whitespace-nowrap" style={{ color: statusColor }}>
              {STATUS_LABEL[status] ?? status}
            </Text>
          </View>
          <View className="mt-2 h-1.5 w-full rounded-full bg-surface-overlay overflow-hidden">
            <View style={{ width: `${storageLimitBytes ? pct : 100}%`, backgroundColor: barColor }} className="h-full rounded-full" />
          </View>
          <Text className="mt-1 text-[10px] text-typography-muted whitespace-nowrap" numberOfLines={1}>
            {storageLimitBytes
              ? `${formatFileSize(storageUsedBytes)} of ${formatFileSize(storageLimitBytes)} used`
              : `${formatFileSize(storageUsedBytes)} used · Unlimited`}
          </Text>
        </View>
      )}
    </View>
  );

  if (!canManage) {
    return (
      <Tooltip label="Billing & storage" side="right" disabled={isExpanded}>
        <View className="mt-2">{body}</View>
      </Tooltip>
    );
  }

  return (
    <Tooltip label="Billing & storage" side="right" disabled={isExpanded}>
      <Link href="/people?section=billing" asChild>
        <Pressable className="mt-2" accessibilityLabel="Billing & storage">
          {body}
        </Pressable>
      </Link>
    </Tooltip>
  );
}
