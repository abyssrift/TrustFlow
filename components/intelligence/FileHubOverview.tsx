import { FileHubMode, useFileHub } from '@/contexts/FileHubContext';
import { useFileViewer, type ViewerMedia } from '@/hooks/useFileViewer';
import { useThemeColors } from '@/hooks/useThemeColors';
import { getRecentChannelIds } from '@/lib/filehubRecentChannels';
import { openStorageFile } from '@/lib/storage';
import { supabase } from '@/lib/supabase';
import { FontAwesome } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';

import { FilePreviewGrid, type FileTile } from '../common/FilePreviewCard';
import Tooltip from '../common/Tooltip';
import { useShareFile } from '../common/ShareFile';
import { fileIcon, formatSize } from './TaskFileResults';

type RecentFile = {
  file_id: string; original_name: string; mime_type: string | null; size_bytes: number;
  bucket: string; storage_path: string; caption: string | null; last_opened_at: string;
};
type AssignedFile = {
  source: string; file_id: string; file_name: string; mime_type: string | null; size_bytes: number;
  bucket: string; storage_path: string; task_id: string; task_title: string | null;
  project_name: string | null; task_category: string | null;
};
type InboxFile = {
  id: string; original_name: string; mime_type: string | null; size_bytes: number;
  bucket: string; storage_path: string; created_at: string;
  uploader?: { full_name?: string } | null;
};
type Overview = {
  recent_files: RecentFile[];
  recently_assigned: AssignedFile[];
  stats: { files_7d?: number; inbox_unread?: number; my_channels?: number };
};

const isImage = (m: string | null) => !!m && m.toLowerCase().includes('image');

function ago(iso: string | null): string {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return `${Math.floor(s / 604800)}w ago`;
}

export default function FileHubOverview({
  onUpload, onNewChannel, onGoTab, compact,
}: {
  onUpload: () => void;
  onNewChannel: () => void;
  onGoTab: (mode: FileHubMode) => void;
  compact?: boolean;
}) {
  const colors = useThemeColors();
  const router = useRouter();
  const { logActivity, groups, setActiveGroupId } = useFileHub();

  const [data, setData] = useState<Overview | null>(null);
  const [inbox, setInbox] = useState<InboxFile[]>([]);
  const [recentChannelIds, setRecentChannelIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getRecentChannelIds().then(ids => { if (!cancelled) setRecentChannelIds(ids); });
    Promise.all([
      supabase.rpc('rpc_filehub_overview', { p_recent_limit: 12 }),
      supabase.rpc('rpc_filehub_list', { p_mode: 'inbox', p_search: null, p_folder_id: null, p_tag: null }),
    ]).then(([ov, ib]) => {
      if (cancelled) return;
      if (ov.error) console.error('[FileHubOverview] overview error', ov.error);
      setData((ov.data as Overview) || { recent_files: [], recently_assigned: [], stats: {} });
      setInbox(((ib.data as InboxFile[]) || []).slice(0, 6));
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const recent = data?.recent_files || [];
  const assigned = data?.recently_assigned || [];

  // Unified viewer — images open in the lightbox, docs/pdf/sheets inline, else
  // download. Same rich experience as the rest of FileHub (fixes #146: clicks
  // used to just download). IDs are namespaced so the three lists don't collide.
  const media: ViewerMedia[] = useMemo(() => {
    const m: ViewerMedia[] = [];
    recent.forEach(f => m.push({ id: `r:${f.file_id}`, name: f.original_name, storagePath: f.storage_path, mimeType: f.mime_type, bucket: f.bucket, sizeBytes: f.size_bytes }));
    assigned.forEach(f => m.push({ id: `a:${f.file_id}`, name: f.file_name, storagePath: f.storage_path, mimeType: f.mime_type, bucket: f.bucket, sizeBytes: f.size_bytes }));
    inbox.forEach(f => m.push({ id: `i:${f.id}`, name: f.original_name, storagePath: f.storage_path, mimeType: f.mime_type, bucket: f.bucket, sizeBytes: f.size_bytes }));
    return m;
  }, [recent, assigned, inbox]);
  const { share, shareSheet } = useShareFile();
  // Share links only exist for filehub-native files; task-sourced rows still get
  // the OS share sheet, just no link fallback.
  const shareRow = (f: { file_id?: string; id?: string; source?: string; bucket: string; storage_path: string; name: string; mime_type: string | null; size_bytes: number }) =>
    share({
      fileId: !f.source || f.source === 'filehub' ? (f.file_id ?? f.id ?? null) : null,
      bucket: f.bucket,
      storagePath: f.storage_path,
      name: f.name,
      mimeType: f.mime_type,
      sizeBytes: f.size_bytes,
    });
  const { signedUrls, handlePress, viewer } = useFileViewer(media, 'filehub-files');

  // Channels ordered by recent visit, then by latest activity.
  const orderedChannels = useMemo(() => {
    const rank = (id: string) => { const i = recentChannelIds.indexOf(id); return i === -1 ? 999 : i; };
    return [...groups]
      .sort((a, b) => {
        const ra = rank(a.id), rb = rank(b.id);
        if (ra !== rb) return ra - rb;
        return (b.last_activity || '').localeCompare(a.last_activity || '');
      })
      .slice(0, 6);
  }, [groups, recentChannelIds]);

  if (loading) {
    return <View className="flex-1 items-center justify-center"><ActivityIndicator size="large" color={colors.primary} /></View>;
  }

  const stats = data?.stats || {};
  const px = compact ? 'px-6' : 'px-10';

  const previewRecent = (f: RecentFile) => { handlePress({ id: `r:${f.file_id}`, name: f.original_name, storagePath: f.storage_path, mimeType: f.mime_type, bucket: f.bucket, sizeBytes: f.size_bytes }); logActivity(f.file_id, 'view'); };
  const openChannel = (id: string) => { onGoTab('groups'); setActiveGroupId(id); };

  const recentTiles: FileTile[] = recent.map(f => ({
    key: f.file_id,
    fileName: f.original_name,
    mimeType: f.mime_type,
    subtitle: formatSize(f.size_bytes),
    imageUri: isImage(f.mime_type) ? signedUrls[`r:${f.file_id}`] : undefined,
    sizeBytes: f.size_bytes,
    onPress: () => previewRecent(f),
  }));

  const RecentlyOpened = (
    <Card icon="clock-o" title="Recently Opened" colors={colors}>
      {recent.length === 0
        ? <Empty text="Files you open show up here." />
        : <FilePreviewGrid items={recentTiles} minTileWidth={150} />}
    </Card>
  );

  const RecentlyAssigned = (
    <Card icon="user-o" title="Recently Assigned" colors={colors}>
      {assigned.length === 0 ? <Empty text="Files on tasks assigned to you show up here." /> : (
        <View className="gap-2">
          {assigned.map(r => (
            <FileRow
              key={`${r.source}-${r.file_id}`}
              icon={fileIcon(r.mime_type)}
              title={r.file_name}
              subtitle={[r.task_title, r.project_name, formatSize(r.size_bytes)].filter(Boolean).join(' · ')}
              onPress={() => handlePress({ id: `a:${r.file_id}`, name: r.file_name, storagePath: r.storage_path, mimeType: r.mime_type, bucket: r.bucket, sizeBytes: r.size_bytes })}
              actions={[
                { icon: 'download', label: 'Download', onPress: () => openStorageFile(r.bucket, r.storage_path, r.file_name, r.mime_type) },
                { icon: 'share', label: 'Share', onPress: () => shareRow({ ...r, name: r.file_name }) },
                { icon: 'external-link', label: 'View task', onPress: () => router.push(`/task/${r.task_id}` as any) },
              ]}
              colors={colors}
            />
          ))}
        </View>
      )}
    </Card>
  );

  const Channels = (
    <Card icon="hashtag" title="Your Channels" colors={colors} onAction={() => onGoTab('groups')} actionLabel="All">
      {orderedChannels.length === 0 ? (
        <Empty text="Channels you visit show up here.">
          <TouchableOpacity onPress={onNewChannel} className="mt-3 self-start flex-row items-center gap-2 bg-brand-primary px-4 py-2 rounded-xl">
            <FontAwesome name="plus" size={11} color="#fff" />
            <Text className="text-white font-black text-xs">New Channel</Text>
          </TouchableOpacity>
        </Empty>
      ) : (
        <View className="gap-2">
          {orderedChannels.map(g => (
            <TouchableOpacity
              key={g.id}
              onPress={() => openChannel(g.id)}
              className="flex-row items-center gap-3 rounded-2xl px-3 py-2.5 hover:bg-surface-overlay transition-colors"
            >
              <View className="w-9 h-9 rounded-xl items-center justify-center flex-shrink-0" style={{ backgroundColor: g.avatar_color || colors.primary }}>
                <Text className="text-white font-black text-sm">{(g.name || '?').charAt(0).toUpperCase()}</Text>
              </View>
              <View className="flex-1 min-w-0">
                <Text numberOfLines={1} className="text-typography-main text-sm font-bold">{g.name}</Text>
                <Text numberOfLines={1} className="text-typography-muted text-[11px] mt-0.5">
                  {[`${g.file_count} file${g.file_count === 1 ? '' : 's'}`, g.last_activity ? `active ${ago(g.last_activity)}` : null].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <FontAwesome name="angle-right" size={16} color={colors.textDim} />
            </TouchableOpacity>
          ))}
        </View>
      )}
    </Card>
  );

  const SharedWithYou = (
    <Card icon="inbox" title="Shared With You" colors={colors} onAction={() => onGoTab('inbox')} actionLabel="Inbox">
      {inbox.length === 0 ? <Empty text="Files sent directly to you show up here." /> : (
        <View className="gap-2">
          {inbox.map(f => (
            <FileRow
              key={f.id}
              icon={fileIcon(f.mime_type)}
              title={f.original_name}
              subtitle={[f.uploader?.full_name, formatSize(f.size_bytes), ago(f.created_at)].filter(Boolean).join(' · ')}
              onPress={() => { handlePress({ id: `i:${f.id}`, name: f.original_name, storagePath: f.storage_path, mimeType: f.mime_type, bucket: f.bucket, sizeBytes: f.size_bytes }); logActivity(f.id, 'view'); }}
              actions={[
                { icon: 'download', label: 'Download', onPress: () => openStorageFile(f.bucket, f.storage_path, f.original_name, f.mime_type) },
                { icon: 'share', label: 'Share', onPress: () => shareRow({ ...f, name: f.original_name }) },
              ]}
              colors={colors}
            />
          ))}
        </View>
      )}
    </Card>
  );

  return (
    <View className="flex-1">
    <ScrollView className="flex-1 no-scrollbar" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
      {/* Unread strip */}
      {(stats.inbox_unread ?? 0) > 0 && (
        <View className={`${px} pt-5`}>
          <TouchableOpacity onPress={() => onGoTab('inbox')} className="flex-row items-center justify-between gap-4 rounded-2xl border border-brand-primary/20 bg-brand-primary/5 px-5 py-3.5">
            <View className="flex-row items-center gap-3 min-w-0 flex-1">
              <FontAwesome name="inbox" size={15} color={colors.primary} />
              <Text className="text-typography-main text-sm font-black" numberOfLines={1}>
                {stats.inbox_unread} unread file{stats.inbox_unread === 1 ? '' : 's'} in your inbox
              </Text>
            </View>
            <FontAwesome name="angle-right" size={18} color={colors.primary} />
          </TouchableOpacity>
        </View>
      )}

      {/* Quick actions + stats strip */}
      <View className={`${px} pt-5 flex-row flex-wrap items-center gap-3`}>
        <QuickAction icon="upload" label="Upload" onPress={onUpload} colors={colors} primary />
        <QuickAction icon="plus" label="New Channel" onPress={onNewChannel} colors={colors} />
        <QuickAction icon="folder-open-o" label="Browse All" onPress={() => onGoTab('browse')} colors={colors} />
        <View className="flex-1" />
        <MiniStat value={String(stats.files_7d ?? 0)} label="this week" colors={colors} />
        <MiniStat value={String(stats.inbox_unread ?? 0)} label="unread" colors={colors} />
        <MiniStat value={String(stats.my_channels ?? 0)} label="channels" colors={colors} />
      </View>

      {/* Bento */}
      <View className={`${px} pt-6 ${compact ? 'flex-col' : 'flex-row'} gap-5`} style={{ alignItems: 'flex-start' }}>
        <View style={{ flexGrow: 1.6, flexBasis: 0, minWidth: 0 }} className="w-full gap-5">
          {RecentlyOpened}
          {RecentlyAssigned}
        </View>
        <View style={{ flexGrow: 1, flexBasis: 0, minWidth: 0 }} className="w-full gap-5">
          {Channels}
          {SharedWithYou}
        </View>
      </View>
    </ScrollView>
    {viewer}
    {shareSheet}
    </View>
  );
}

function Card({ icon, title, colors, children, onAction, actionLabel }: {
  icon: any; title: string; colors: any; children: React.ReactNode; onAction?: () => void; actionLabel?: string;
}) {
  return (
    <View className="w-full bg-surface-card border border-surface-border rounded-3xl p-5">
      <View className="flex-row items-center justify-between mb-4">
        <View className="flex-row items-center gap-2.5">
          <FontAwesome name={icon} size={13} color={colors.primary} />
          <Text className="text-typography-main text-[12px] font-black uppercase tracking-widest">{title}</Text>
        </View>
        {onAction && (
          <TouchableOpacity onPress={onAction} className="flex-row items-center gap-1.5">
            <Text className="text-brand-primary text-[11px] font-black uppercase tracking-wider">{actionLabel}</Text>
            <FontAwesome name="angle-right" size={13} color={colors.primary} />
          </TouchableOpacity>
        )}
      </View>
      {children}
    </View>
  );
}

function FileRow({ icon, title, subtitle, onPress, actions, colors }: {
  icon: any; title: string; subtitle: string; onPress: () => void;
  actions?: { icon: any; label: string; onPress: () => void }[]; colors: any;
}) {
  return (
    <TouchableOpacity onPress={onPress} className="flex-row items-center gap-3 rounded-2xl bg-surface-background border border-surface-border px-3.5 py-2.5 hover:bg-surface-overlay transition-colors">
      <FontAwesome name={icon} size={15} color={colors.textMuted} />
      <View className="flex-1 min-w-0">
        <Text numberOfLines={1} className="text-typography-main text-sm font-bold">{title}</Text>
        {!!subtitle && <Text numberOfLines={1} className="text-typography-muted text-[11px] mt-0.5">{subtitle}</Text>}
      </View>
      {(actions || []).map(a => (
        <Tooltip key={a.label} label={a.label}>
          <TouchableOpacity
            onPress={(e: any) => { e?.stopPropagation?.(); a.onPress(); }}
            className="w-8 h-8 rounded-lg items-center justify-center border border-surface-border flex-shrink-0"
          >
            <FontAwesome name={a.icon} size={12} color={colors.textMuted} />
          </TouchableOpacity>
        </Tooltip>
      ))}
    </TouchableOpacity>
  );
}

function QuickAction({ icon, label, onPress, colors, primary }: { icon: any; label: string; onPress: () => void; colors: any; primary?: boolean }) {
  return (
    <TouchableOpacity onPress={onPress} className={`flex-row items-center gap-2 px-4 py-2.5 rounded-xl ${primary ? 'bg-brand-primary' : 'bg-surface-card border border-surface-border'}`}>
      <FontAwesome name={icon} size={12} color={primary ? '#fff' : colors.primary} />
      <Text className={`font-black text-[13px] ${primary ? 'text-white' : 'text-typography-main'}`}>{label}</Text>
    </TouchableOpacity>
  );
}

function MiniStat({ value, label, colors }: { value: string; label: string; colors: any }) {
  return (
    <View className="items-center px-3">
      <Text className="text-typography-main text-lg font-black leading-none">{value}</Text>
      <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest mt-1">{label}</Text>
    </View>
  );
}

function Empty({ text, children }: { text: string; children?: React.ReactNode }) {
  return (
    <View className="py-2">
      <Text className="text-typography-muted text-sm">{text}</Text>
      {children}
    </View>
  );
}
