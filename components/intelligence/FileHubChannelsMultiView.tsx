import { FontAwesome } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { Text, View } from 'react-native';

import MultiViewList from '@/components/common/MultiViewList';
import type { FileHubGroup } from '@/contexts/FileHubContext';
import { useThemeColors } from '@/hooks/useThemeColors';

import { getInitials } from './filehubShared';

function relativeDate(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / (86400 * 7))}w ago`;
  return `${Math.floor(diff / (86400 * 30))}mo ago`;
}

function MemberBadge({ group }: { group: FileHubGroup }) {
  return (
    <View className="bg-warning/15 border border-warning/30 rounded-md px-1.5 py-0.5">
      <Text className="text-warning text-[9px] font-black tracking-wide">NOT A MEMBER</Text>
    </View>
  );
}

function Avatar({ group, size = 'md' }: { group: FileHubGroup; size?: 'md' | 'lg' }) {
  const dims = size === 'lg' ? 'w-14 h-14 rounded-2xl' : 'w-10 h-10 rounded-xl';
  const font = size === 'lg' ? 'text-lg' : 'text-sm';
  return (
    <View className={`${dims} items-center justify-center flex-shrink-0`} style={{ backgroundColor: group.avatar_color + '22' }}>
      <Text style={{ color: group.avatar_color, fontWeight: '900' }} className={font}>
        {getInitials(group.name)}
      </Text>
    </View>
  );
}

function CountRow({ group }: { group: FileHubGroup }) {
  const c = useThemeColors();
  return (
    <View className="flex-row items-center gap-3">
      <View className="flex-row items-center gap-1.5">
        <FontAwesome name="users" size={10} color={c.textMuted} />
        <Text className="text-typography-dim text-xs">{group.member_count} member{group.member_count !== 1 ? 's' : ''}</Text>
      </View>
      <View className="flex-row items-center gap-1.5">
        <FontAwesome name="files-o" size={10} color={c.textMuted} />
        <Text className="text-typography-dim text-xs">{group.file_count} file{group.file_count !== 1 ? 's' : ''}</Text>
      </View>
    </View>
  );
}

export default function FileHubChannelsMultiView({
  groups,
  loading,
  searchValue = '',
  onPressGroup,
  onCreateChannel,
}: {
  groups: FileHubGroup[];
  loading?: boolean;
  /** Live value of the global header search box — used to filter channels and to
   *  pick the empty-state copy (no results vs nothing yet). The toolbar search
   *  box stays in the owning screen's header, so this primitive renders no
   *  search of its own. */
  searchValue?: string;
  onPressGroup: (g: FileHubGroup) => void;
  onCreateChannel: () => void;
}) {
  const c = useThemeColors();

  const visible = useMemo(() => {
    const q = searchValue.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(
      g => g.name.toLowerCase().includes(q) || (g.description ?? '').toLowerCase().includes(q),
    );
  }, [groups, searchValue]);

  return (
    <MultiViewList
      items={visible}
      keyExtractor={(g) => g.id}
      renderCard={(g) => (
        <View className="bg-surface-card w-full p-5 rounded-2xl border border-surface-border" style={{ gap: 12 }}>
          <View className="flex-row items-center gap-3">
            <Avatar group={g} size="lg" />
            <View className="flex-1 min-w-0">
              <View className="flex-row items-center gap-2 flex-wrap">
                <Text className="text-typography-main font-black text-base flex-shrink" numberOfLines={1}>{g.name}</Text>
                {g.is_override && <MemberBadge group={g} />}
              </View>
              <Text className="text-typography-muted text-xs mt-0.5" numberOfLines={1}>
                {g.description || 'No description provided.'}
              </Text>
            </View>
          </View>
          <View className="flex-row items-center gap-2">
            <View className="bg-surface-background px-3 py-1.5 rounded-lg border border-surface-border flex-row items-center">
              <FontAwesome name="users" size={10} color={c.textMuted} />
              <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest ml-2">
                {g.member_count} member{g.member_count !== 1 ? 's' : ''}
              </Text>
            </View>
            <View className="bg-surface-background px-3 py-1.5 rounded-lg border border-surface-border flex-row items-center">
              <FontAwesome name="files-o" size={10} color={c.primary} />
              <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest ml-2">
                {g.file_count} file{g.file_count !== 1 ? 's' : ''}
              </Text>
            </View>
            {g.last_activity && (
              <Text className="text-typography-dim text-[11px] ml-auto">{relativeDate(g.last_activity)}</Text>
            )}
          </View>
        </View>
      )}
      renderRow={(g) => (
        <View className="flex-row items-center gap-3">
          <Avatar group={g} />
          <View className="flex-1 min-w-0">
            <View className="flex-row items-center gap-2">
              <Text className="text-typography-main font-black text-sm flex-shrink" numberOfLines={1}>{g.name}</Text>
              {g.is_override && <MemberBadge group={g} />}
            </View>
            <Text className="text-typography-muted text-[11px]" numberOfLines={1}>
              {g.description || (g.last_activity ? `Active ${relativeDate(g.last_activity)}` : 'No description provided.')}
            </Text>
            <CountRow group={g} />
          </View>
          {g.last_activity && <Text className="text-typography-dim text-[11px] flex-shrink-0">{relativeDate(g.last_activity)}</Text>}
        </View>
      )}
      columns={[
        {
          key: 'channel',
          label: 'Channel',
          flex: 2.6,
          render: (g) => (
            <View className="flex-row items-center gap-3">
              <Avatar group={g} />
              <View className="min-w-0">
                <View className="flex-row items-center gap-2">
                  <Text className="text-typography-main font-black text-sm" numberOfLines={1}>{g.name}</Text>
                  {g.is_override && <MemberBadge group={g} />}
                </View>
                <Text className="text-typography-muted text-[10px] mt-0.5" numberOfLines={1}>
                  {g.description || 'No description provided.'}
                </Text>
              </View>
            </View>
          ),
        },
        {
          key: 'members',
          label: 'Members',
          flex: 1,
          render: (g) => (
            <View className="flex-row items-center gap-1.5">
              <FontAwesome name="users" size={10} color={c.textMuted} />
              <Text className="text-typography-muted text-xs">{g.member_count}</Text>
            </View>
          ),
        },
        {
          key: 'files',
          label: 'Files',
          flex: 0.9,
          render: (g) => (
            <View className="flex-row items-center gap-1.5">
              <FontAwesome name="files-o" size={10} color={c.primary} />
              <Text className="text-typography-muted text-xs">{g.file_count}</Text>
            </View>
          ),
        },
        {
          key: 'last-activity',
          label: 'Last Activity',
          flex: 1.2,
          align: 'right',
          render: (g) => (
            <Text className="text-typography-muted text-xs">
              {g.last_activity ? relativeDate(g.last_activity) : '—'}
            </Text>
          ),
        },
      ]}
      onItemPress={(g) => onPressGroup(g)}
      storageKey="filehub-channels"
      modes={['large', 'list', 'details']}
      defaultMode="large"
      loading={loading}
      emptyState={{
        icon: 'hashtag',
        title: searchValue.trim() ? 'No matching channels' : 'No channels yet',
        body: searchValue.trim()
          ? 'Try a different search.'
          : 'Create a channel to organize files and share them with your team.',
        actionLabel: 'New channel',
        onAction: onCreateChannel,
      }}
      style={{ flex: 1 }}
    />
  );
}