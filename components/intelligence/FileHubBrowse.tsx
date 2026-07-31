import { useAlert } from '@/contexts/AlertContext';
import { useFileHub } from '@/contexts/FileHubContext';
import { useDoubleTap } from '@/hooks/useDoubleTap';
import { useImageLightbox, type LightboxMedia } from '@/hooks/useImageLightbox';
import { useThemeColors } from '@/hooks/useThemeColors';
import { downloadFilesAsZip, openStorageFile } from '@/lib/storage';
import { supabase } from '@/lib/supabase';
import { isMultiSelectModifierActive, webModifierKeys } from '@/lib/webModifierKeys';
import { FontAwesome } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';

import { FilePreviewCard } from '../common/FilePreviewCard';
import Tooltip from '../common/Tooltip';
import FileHubDetailPane, { type DetailFile } from './FileHubDetailPane';
import { useShareFile } from '../common/ShareFile';
import { fileIcon, formatSize } from './TaskFileResults';

type BrowseItem = {
  source: 'filehub' | 'submission' | 'task_brief';
  file_id: string;
  bucket: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number;
  created_at: string;
  task_id: string | null;
  task_title: string | null;
  project_id: string | null;
  project_name: string | null;
  task_category: string | null;
  submission_id: string | null;
};

type Facets = {
  projects: { id: string; name: string; count: number }[];
  categories: { category: string; count: number }[];
  types: { type: string; count: number }[];
};

const PAGE = 60;
const SOURCE_TABS: { label: string; value: string[] | null }[] = [
  { label: 'All', value: null },
  { label: 'FileHub', value: ['filehub'] },
  { label: 'Submissions', value: ['submission'] },
  { label: 'Briefs', value: ['task_brief'] },
];

const isImage = (m: string | null) => !!m && m.toLowerCase().includes('image');
const idOf = (it: BrowseItem) => `${it.source}:${it.file_id}`;

export default function FileHubBrowse({ compact }: { compact?: boolean }) {
  const colors = useThemeColors();
  const { searchDebounced, deleteFile } = useFileHub();
  const { showConfirm } = useAlert();

  const [sourceTab, setSourceTab] = useState(0);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [type, setType] = useState<string | null>(null);

  const [items, setItems] = useState<BrowseItem[]>([]);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  // Selection + detail
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [anchorIdx, setAnchorIdx] = useState<number | null>(null);
  const [detail, setDetail] = useState<BrowseItem | null>(null);
  const [fastPreview, setFastPreview] = useState(false);
  const isDoubleTap = useDoubleTap();
  const [zipping, setZipping] = useState(false);
  const [gridW, setGridW] = useState(0);

  const sources = SOURCE_TABS[sourceTab].value;

  // Image thumbnails (no viewer here — preview happens in the detail pane).
  const media: LightboxMedia[] = useMemo(
    () => items.map(it => ({ id: idOf(it), name: it.file_name, storagePath: it.storage_path, mimeType: it.mime_type, bucket: it.bucket, sizeBytes: it.size_bytes })),
    [items],
  );
  const { signedUrls } = useImageLightbox(media, 'filehub-files');
  const { share, shareSheet } = useShareFile();

  // Only filehub-native rows have a share-link row to fall back to; task-sourced
  // files still get the OS share sheet.
  const shareItem = (it: BrowseItem) => share({
    fileId: it.source === 'filehub' ? it.file_id : null,
    bucket: it.bucket,
    storagePath: it.storage_path,
    name: it.file_name,
    mimeType: it.mime_type,
    sizeBytes: it.size_bytes,
  });

  const fetchPage = useCallback(async (before: string | null, withFacets: boolean) => {
    const { data, error } = await supabase.rpc('rpc_filehub_browse', {
      p_query: searchDebounced || null,
      p_sources: sources,
      p_project_id: projectId,
      p_category: category,
      p_type: type,
      p_before: before,
      p_limit: PAGE,
      p_include_facets: withFacets,
    });
    if (error) { console.error('[FileHubBrowse] error', error); return { items: [] as BrowseItem[], has_more: false, facets: null }; }
    return data as { items: BrowseItem[]; has_more: boolean; facets: Facets | null };
  }, [searchDebounced, sources, projectId, category, type]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSelectedIds(new Set()); setAnchorIdx(null); setDetail(null);
    fetchPage(null, true).then(res => {
      if (cancelled) return;
      setItems(res.items);
      setHasMore(res.has_more);
      if (res.facets) setFacets(res.facets);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [fetchPage]);

  const loadMore = async () => {
    if (loadingMore || items.length === 0) return;
    setLoadingMore(true);
    const res = await fetchPage(items[items.length - 1].created_at, false);
    setItems(prev => [...prev, ...res.items]);
    setHasMore(res.has_more);
    setLoadingMore(false);
  };

  // Click = open detail pane; double-click = fullscreen preview;
  // Ctrl/Cmd-click = toggle selection; Shift-click = range.
  const onItemClick = (it: BrowseItem, idx: number) => {
    if (webModifierKeys.shift && anchorIdx !== null) {
      const [a, b] = [anchorIdx, idx].sort((x, y) => x - y);
      const next = new Set(selectedIds);
      for (let i = a; i <= b; i++) next.add(idOf(items[i]));
      setSelectedIds(next);
      return;
    }
    if (isMultiSelectModifierActive()) { toggleOne(it, idx); return; }
    // Shift is range-select here, so double-click is the only fast-track on
    // this surface — the detail pane opens it via its autoPreview prop.
    setFastPreview(isDoubleTap(idOf(it)));
    setDetail(it); setAnchorIdx(idx);
  };

  const toggleOne = (it: BrowseItem, idx: number) => {
    const id = idOf(it);
    const next = new Set(selectedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedIds(next);
    setAnchorIdx(idx);
  };

  const selectedItems = items.filter(it => selectedIds.has(idOf(it)));
  const allFilehub = selectedItems.length > 0 && selectedItems.every(it => it.source === 'filehub');

  const downloadSelected = async () => {
    if (selectedItems.length === 0 || zipping) return;
    setZipping(true);
    try {
      await downloadFilesAsZip(
        selectedItems.map(it => ({ storage_path: it.storage_path, bucket: it.bucket, original_name: it.file_name, mime_type: it.mime_type })),
        `filehub-${selectedItems.length}-files.zip`,
      );
    } finally { setZipping(false); }
  };

  const deleteSelected = () => {
    if (!allFilehub) return;
    showConfirm(
      `Delete ${selectedItems.length} file${selectedItems.length === 1 ? '' : 's'}?`,
      'They will be moved to the bin.',
      async () => {
        const ids = new Set(selectedItems.map(it => it.file_id));
        await Promise.all(selectedItems.map(it => deleteFile(it.file_id)));
        setItems(prev => prev.filter(it => !(it.source === 'filehub' && ids.has(it.file_id))));
        setSelectedIds(new Set());
        if (detail && ids.has(detail.file_id)) setDetail(null);
      },
      undefined, 'Delete', 'Cancel', 'destructive',
    );
  };

  const px = compact ? 'px-6' : 'px-10';

  // Measured grid columns (custom so tiles can carry a selection ring/checkbox).
  const gap = 10, minTileWidth = 150;
  const avail = gridW > 0 ? gridW : 320;
  const cols = Math.max(1, Math.floor((avail + gap) / (minTileWidth + gap)));
  const tileW = Math.floor((avail - gap * (cols - 1)) / cols);

  const Filters = (
    <>
      <View className={`${px} pt-5 flex-row items-center gap-2`}>
        {SOURCE_TABS.map((t, i) => (
          <TouchableOpacity
            key={t.label}
            onPress={() => { setSourceTab(i); setProjectId(null); setCategory(null); setType(null); }}
            className={`px-4 py-2 rounded-xl border ${sourceTab === i ? 'bg-brand-primary/10 border-brand-primary/30' : 'bg-surface-card border-surface-border'}`}
          >
            <Text className={`text-xs font-black ${sourceTab === i ? 'text-brand-primary' : 'text-typography-muted'}`}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <FacetRow label="Project" chips={(facets?.projects || []).map(p => ({ key: p.id, label: p.name || 'Untitled', count: p.count, active: projectId === p.id }))} onToggle={(k) => setProjectId(projectId === k ? null : k)} px={px} colors={colors} />
      <FacetRow label="Category" chips={(facets?.categories || []).map(c => ({ key: c.category, label: c.category, count: c.count, active: category === c.category }))} onToggle={(k) => setCategory(category === k ? null : k)} px={px} colors={colors} />
      <FacetRow label="Type" chips={(facets?.types || []).map(t => ({ key: t.type, label: t.type, count: t.count, active: type === t.type }))} onToggle={(k) => setType(type === k ? null : k)} px={px} colors={colors} />
    </>
  );

  const Results = (
    <ScrollView className="flex-1 no-scrollbar" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 48 }}>
      {Filters}

      {/* Selection toolbar */}
      {selectedIds.size > 0 && (
        <View className={`${px} pt-4`}>
          <View className="flex-row items-center gap-3 rounded-2xl border border-brand-primary/30 bg-brand-primary/5 px-4 py-2.5">
            <Text className="text-brand-primary text-xs font-black">{selectedIds.size} selected</Text>
            <View className="flex-1" />
            <Tooltip label="Download as ZIP">
              <TouchableOpacity onPress={downloadSelected} disabled={zipping} className="flex-row items-center gap-1.5 bg-brand-primary px-3 py-2 rounded-xl">
                {zipping ? <ActivityIndicator size="small" color="#fff" /> : <FontAwesome name="download" size={11} color="#fff" />}
                <Text className="text-white font-black text-[11px]">Download</Text>
              </TouchableOpacity>
            </Tooltip>
            {allFilehub && (
              <Tooltip label="Delete selected">
                <TouchableOpacity onPress={deleteSelected} className="flex-row items-center gap-1.5 bg-state-danger/10 border border-state-danger/20 px-3 py-2 rounded-xl">
                  <FontAwesome name="trash-o" size={11} color={colors.danger} />
                  <Text className="text-state-danger font-black text-[11px]">Delete</Text>
                </TouchableOpacity>
              </Tooltip>
            )}
            <TouchableOpacity onPress={() => setSelectedIds(new Set())} className="w-8 h-8 items-center justify-center">
              <FontAwesome name="times" size={13} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {loading ? (
        <View className="py-16 items-center justify-center"><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : items.length === 0 ? (
        <View className="py-16 items-center justify-center px-8">
          <FontAwesome name="folder-open-o" size={28} color={colors.textMuted} />
          <Text className="text-typography-main text-base font-black mt-3">No files found</Text>
          <Text className="text-typography-muted text-sm mt-1 text-center">
            {searchDebounced ? `Nothing matches "${searchDebounced}" with these filters.` : 'Try a different filter.'}
          </Text>
        </View>
      ) : compact ? (
        <View className={`${px} pt-4`}>
          {items.map((it, idx) => {
            const sel = selectedIds.has(idOf(it));
            return (
              <TouchableOpacity
                key={idOf(it)}
                onPress={() => onItemClick(it, idx)}
                className={`flex-row items-center gap-3 rounded-2xl px-4 py-3 mb-2 border ${sel ? 'bg-brand-primary/10 border-brand-primary/40' : 'bg-surface-card border-surface-border'}`}
              >
                <TouchableOpacity onPress={() => toggleOne(it, idx)} className="w-6 h-6 rounded-md items-center justify-center border flex-shrink-0" style={{ borderColor: sel ? colors.primary : colors.border, backgroundColor: sel ? colors.primary : 'transparent' }}>
                  {sel && <FontAwesome name="check" size={11} color="#fff" />}
                </TouchableOpacity>
                <FontAwesome name={fileIcon(it.mime_type)} size={16} color={colors.textMuted} />
                <View className="flex-1 min-w-0">
                  <Text numberOfLines={1} className="text-typography-main text-sm font-bold">{it.file_name}</Text>
                  <Text numberOfLines={1} className="text-typography-muted text-[11px] mt-0.5">
                    {[it.project_name || it.task_title, formatSize(it.size_bytes)].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <Tooltip label="Download">
                  <TouchableOpacity onPress={(e: any) => { e?.stopPropagation?.(); openStorageFile(it.bucket, it.storage_path, it.file_name, it.mime_type); }} className="w-8 h-8 rounded-lg items-center justify-center border border-surface-border flex-shrink-0">
                    <FontAwesome name="download" size={11} color={colors.textMuted} />
                  </TouchableOpacity>
                </Tooltip>
                <Tooltip label="Share file">
                  <TouchableOpacity onPress={(e: any) => { e?.stopPropagation?.(); shareItem(it); }} className="w-8 h-8 rounded-lg items-center justify-center border border-surface-border flex-shrink-0">
                    <FontAwesome name="share" size={11} color={colors.textMuted} />
                  </TouchableOpacity>
                </Tooltip>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : (
        <View className={`${px} pt-4`} onLayout={e => setGridW(e.nativeEvent.layout.width)}>
          <View className="flex-row flex-wrap" style={{ gap }}>
            {items.map((it, idx) => {
              const sel = selectedIds.has(idOf(it));
              const active = detail && idOf(detail) === idOf(it);
              return (
                <View key={idOf(it)} style={{ width: tileW }} className="relative">
                  <View style={{ borderRadius: 12 }} className={sel || active ? 'border-2 border-brand-primary rounded-xl overflow-hidden' : ''}>
                    <FilePreviewCard
                      fileName={it.file_name}
                      mimeType={it.mime_type}
                      subtitle={[it.project_name || it.task_title, formatSize(it.size_bytes)].filter(Boolean).join(' · ')}
                      imageUri={isImage(it.mime_type) ? signedUrls[idOf(it)] : undefined}
                      sizeBytes={it.size_bytes}
                      onPress={() => onItemClick(it, idx)}
                    />
                  </View>
                  <TouchableOpacity
                    onPress={() => toggleOne(it, idx)}
                    className="absolute top-1.5 left-1.5 w-5 h-5 rounded-md items-center justify-center"
                    style={{ backgroundColor: sel ? colors.primary : 'rgba(0,0,0,0.45)' }}
                  >
                    {sel && <FontAwesome name="check" size={10} color="#fff" />}
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        </View>
      )}

      {hasMore && !loading && (
        <View className={`${px} pt-4 items-center`}>
          <TouchableOpacity onPress={loadMore} disabled={loadingMore} className="px-6 py-3 rounded-xl bg-surface-card border border-surface-border flex-row items-center gap-2">
            {loadingMore && <ActivityIndicator size="small" color={colors.primary} />}
            <Text className="text-typography-main font-black text-sm">Load more</Text>
          </TouchableOpacity>
        </View>
      )}
      {shareSheet}
    </ScrollView>
  );

  const detailFile: DetailFile | null = detail && {
    source: detail.source, file_id: detail.file_id, bucket: detail.bucket, storage_path: detail.storage_path,
    file_name: detail.file_name, mime_type: detail.mime_type, size_bytes: detail.size_bytes, created_at: detail.created_at,
    task_id: detail.task_id, task_title: detail.task_title, project_name: detail.project_name, task_category: detail.task_category,
    submission_id: detail.submission_id,
  };

  const onDeleted = (fileId: string) => setItems(prev => prev.filter(it => !(it.source === 'filehub' && it.file_id === fileId)));

  // Compact: detail replaces the list as a full overlay.
  if (compact && detailFile) {
    return (
      <View className="flex-1 p-4">
        <FileHubDetailPane file={detailFile} onClose={() => setDetail(null)} onDeleted={onDeleted} compact autoPreview={fastPreview} />
      </View>
    );
  }

  // Wide: two columns (results left, preview-biased detail right).
  if (detailFile) {
    return (
      <View className="flex-1 flex-row" style={{ minHeight: 0 }}>
        <View style={{ flex: 1, minWidth: 0 }} className="border-r border-surface-border">{Results}</View>
        <View style={{ flexGrow: 1.5, flexBasis: 0, minWidth: 0, padding: 20 }}>
          <FileHubDetailPane file={detailFile} onClose={() => setDetail(null)} onDeleted={onDeleted} autoPreview={fastPreview} />
        </View>
      </View>
    );
  }

  return Results;
}

function FacetRow({
  label, chips, onToggle, px, colors,
}: {
  label: string;
  chips: { key: string; label: string; count: number; active: boolean }[];
  onToggle: (key: string) => void;
  px: string;
  colors: any;
}) {
  if (chips.length === 0) return null;
  return (
    <View className="pt-4">
      <Text className={`${px} text-typography-muted text-[9px] font-black uppercase tracking-widest mb-2`}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="no-scrollbar" contentContainerStyle={{ paddingHorizontal: px === 'px-6' ? 24 : 40, gap: 8 }}>
        {chips.map(c => (
          <TouchableOpacity
            key={c.key}
            onPress={() => onToggle(c.key)}
            className={`px-3 py-1.5 rounded-full border flex-row items-center gap-1.5 ${c.active ? 'bg-brand-primary/10 border-brand-primary/30' : 'bg-surface-card border-surface-border'}`}
          >
            <Text className={`text-[11px] font-bold ${c.active ? 'text-brand-primary' : 'text-typography-muted'}`}>{c.label}</Text>
            <Text className="text-[9px] font-black" style={{ color: colors.textDim }}>{c.count}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}
