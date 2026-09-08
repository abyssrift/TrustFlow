import { FileActivity } from '@/contexts/FileHubContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { formatRelative } from '@/lib/time';
import { formatActivityDate, formatActivityExactTime, formatActivitySummary, getActivityPresentation, groupActivities } from '@/lib/filehubActivityPresentation';
import { FontAwesome } from '@expo/vector-icons';
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import Popup from '../common/Popup';
import UserLink from '../common/UserLink';

type DetailEntry = FileActivity & { action: string };

function toneColor(tone: string, colors: ReturnType<typeof useThemeColors>) {
  return ({ success: colors.success, info: colors.info, warning: colors.warning, danger: colors.danger, muted: colors.textMuted }[tone] ?? colors.textMuted);
}

function toneBackground(tone: string) {
  return ({
    success: 'bg-state-success/10',
    info: 'bg-state-info/10',
    warning: 'bg-state-warning/10',
    danger: 'bg-state-danger/10',
    muted: 'bg-surface-background',
  }[tone] ?? 'bg-surface-background');
}

function ActivityDetailPopup({ entry, onClose }: { entry: DetailEntry | null; onClose: () => void }) {
  const colors = useThemeColors();
  if (!entry) return null;
  const meta = getActivityPresentation(entry.action);
  const summary = formatActivitySummary(entry.action, entry.metadata);
  const fields = [
    { label: 'Actor', value: entry.user.full_name || 'Unknown' },
    { label: 'Action', value: meta.label }, { label: 'Target', value: summary.target },
    { label: 'Exact time', value: formatActivityExactTime(entry.created_at) },
    { label: 'Location', value: summary.location }, { label: 'Change / Context', value: summary.change },
  ];
  const color = toneColor(meta.tone, colors);
  return (
    <Popup visible onClose={onClose} presentation="auto" maxWidth={760} title="Activity details" dimBackdrop>
      <View className="px-6 pb-6">
        <View className="flex-row items-center mb-5">
          <View className={`w-11 h-11 rounded-xl items-center justify-center mr-3 ${toneBackground(meta.tone)}`}>
            <FontAwesome name={meta.icon as any} size={18} color={color} />
          </View>
          <View className="flex-1"><Text className="text-lg font-black text-typography-main">{meta.label}</Text><Text className="text-xs text-typography-muted">{formatRelative(entry.created_at)}</Text></View>
        </View>
        <View className="flex-row flex-wrap gap-4">
          {fields.map(field => <View key={field.label} className="flex-1 min-w-[280px] rounded-xl border border-surface-border p-4">
            <Text className="text-[10px] font-black uppercase tracking-widest text-typography-muted mb-1">{field.label}</Text>
            {field.label === 'Actor' ? <UserLink userId={entry.user.id} name={field.value} tab="activity" className="text-sm font-bold text-typography-main" /> : <Text className="text-sm text-typography-main">{field.value}</Text>}
          </View>)}
        </View>
      </View>
    </Popup>
  );
}

export function FileActivityRows({ activity, loading = false, error = false, mobile = false }: { activity: FileActivity[] | null; loading?: boolean; error?: boolean; mobile?: boolean }) {
  const colors = useThemeColors();
  const [selected, setSelected] = useState<DetailEntry | null>(null);
  if (error) return <View className="py-10 items-center px-8"><FontAwesome name="exclamation-circle" size={mobile ? 28 : 24} color={colors.danger} /><Text className="text-state-danger text-sm mt-3 text-center">Activity couldn&apos;t be loaded. Please try again.</Text></View>;
  if (loading || activity === null) return <View className="py-10 items-center"><ActivityIndicator color={colors.primary} /></View>;
  if (!activity.length) return <View className="py-10 items-center px-8"><FontAwesome name="clock-o" size={mobile ? 28 : 24} color={colors.textDim} /><Text className="text-typography-muted text-sm mt-3 text-center">No activity recorded yet</Text></View>;
  return <><View>{groupActivities(activity).map(group => <View key={group.key}>
    <Text className="px-3 pt-5 pb-2 text-[10px] font-black uppercase tracking-widest text-typography-muted">{formatActivityDate(group.items[0].created_at)}</Text>
    {group.items.map((entry, index) => {
      const detailEntry = entry as DetailEntry;
      const meta = getActivityPresentation(detailEntry.action);
      const summary = formatActivitySummary(detailEntry.action, entry.metadata);
      const color = toneColor(meta.tone, colors);
      return <Pressable key={entry.id} accessibilityRole="button" accessibilityLabel={`${entry.user.full_name || 'Unknown'} ${meta.label} ${summary.target}, ${formatRelative(entry.created_at)}`} onPress={() => setSelected(detailEntry)} className={`min-h-[44px] flex-row items-start ${mobile ? 'px-6 py-3.5' : 'px-3 py-3'} ${index < group.items.length - 1 ? 'border-b border-surface-border/40' : ''} active:bg-surface-background`}>
        <View className={`${mobile ? 'w-8 h-8' : 'w-7 h-7'} rounded-full items-center justify-center mr-3 flex-shrink-0 mt-0.5 ${toneBackground(meta.tone)}`}><FontAwesome name={meta.icon as any} size={mobile ? 12 : 11} color={color} /></View>
        <View className="flex-1 min-w-0">
          <Text className={`${mobile ? 'text-sm' : 'text-xs'} text-typography-main font-bold`}>{entry.user.full_name || 'Unknown'} <Text className="text-typography-muted font-medium">{meta.label.toLowerCase()}</Text> <Text className="text-typography-main font-medium">{summary.target}</Text></Text>
          <Text className={`${mobile ? 'text-xs' : 'text-[10px]'} text-typography-dim mt-0.5`}>{summary.change !== 'Not recorded' ? `${summary.change} · ` : ''}{formatRelative(entry.created_at)}</Text>
        </View>
      </Pressable>;
    })}
  </View>)}</View><ActivityDetailPopup entry={selected} onClose={() => setSelected(null)} /></>;
}
