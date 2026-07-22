import { useAlert } from '@/contexts/AlertContext';
import { useAuth } from '@/contexts/AuthContext';
import { useFileHub, type FileHubFile } from '@/contexts/FileHubContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { FontAwesome } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Platform, Text, TouchableOpacity, View } from 'react-native';
import DraggableSheet from '@/components/common/DraggableSheet';
import UserLink from '@/components/common/UserLink';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function getMimeIcon(mimeType: string | null): { icon: string; color: string } {
  if (!mimeType) return { icon: 'file-o', color: '#94a3b8' };
  const t = mimeType.toLowerCase();
  if (t.includes('pdf')) return { icon: 'file-pdf-o', color: '#e53e3e' };
  if (t.includes('image')) return { icon: 'file-image-o', color: '#38a169' };
  if (t.includes('spreadsheet') || t.includes('excel') || t.includes('csv')) return { icon: 'file-excel-o', color: '#2f855a' };
  if (t.includes('word') || t.includes('wordprocessing')) return { icon: 'file-word-o', color: '#2b6cb0' };
  if (t.includes('zip') || t.includes('compressed')) return { icon: 'file-zip-o', color: '#d69e2e' };
  if (t.includes('video')) return { icon: 'file-video-o', color: '#805ad5' };
  if (t.includes('audio')) return { icon: 'file-audio-o', color: '#dd6b20' };
  if (t.includes('text')) return { icon: 'file-text-o', color: '#4a5568' };
  return { icon: 'file-o', color: '#94a3b8' };
}

function daysRemaining(expiresAt: string | undefined): number {
  if (!expiresAt) return 0;
  const ms = new Date(expiresAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

function formatDateTime(iso: string | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function initials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
}

type BinNode = { item: FileHubFile; children: BinNode[] };

// The Bin's own list is flat (every deleted file + folder as siblings), but
// most of them ARE actually nested — a deleted folder's files are deleted
// items too. Group each item under its parent folder's node when that parent
// is also present in the Bin, so the tree matches what FileHub itself looks
// like instead of dumping a folder's contents next to it as unrelated rows.
function buildBinTree(items: FileHubFile[]): BinNode[] {
  const folderIds = new Set(items.filter(i => i.item_type === 'folder').map(i => i.id));
  const byParent = new Map<string, FileHubFile[]>();
  for (const it of items) {
    const parentId = it.folder?.id;
    if (parentId && folderIds.has(parentId)) {
      if (!byParent.has(parentId)) byParent.set(parentId, []);
      byParent.get(parentId)!.push(it);
    }
  }
  const buildNode = (item: FileHubFile): BinNode => ({
    item,
    children: item.item_type === 'folder' ? (byParent.get(item.id) || []).map(buildNode) : [],
  });
  const roots = items.filter(i => !i.folder || !folderIds.has(i.folder.id));
  return roots.map(buildNode);
}

function countNodes(nodes: BinNode[]): number {
  return nodes.reduce((sum, n) => sum + 1 + countNodes(n.children), 0);
}

type FlatRow = { node: BinNode; depth: number };

// Depth-first flatten of the tree into the rows currently VISIBLE (children of
// a collapsed folder are skipped). Feeding this flat list to a virtualized
// FlatList means only the ~dozen on-screen rows ever mount — a 1500-item bin
// no longer renders 1500 row subtrees at once (which is what killed the tab).
function flattenVisible(nodes: BinNode[], expanded: Set<string>, depth = 0, out: FlatRow[] = []): FlatRow[] {
  for (const node of nodes) {
    out.push({ node, depth });
    if (node.item.item_type === 'folder' && node.children.length > 0 && expanded.has(node.item.id)) {
      flattenVisible(node.children, expanded, depth + 1, out);
    }
  }
  return out;
}

export default function FileHubBin({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const c = useThemeColors();
  const { hasPermission } = useAuth();
  const { showConfirm } = useAlert();
  const { binFiles, binLoading, fetchBin, restoreFromBin, restoreFolder, emptyBin } = useFileHub();
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [emptying, setEmptying] = useState(false);

  useEffect(() => {
    if (visible) fetchBin();
  }, [visible, fetchBin]);

  const tree = useMemo(() => buildBinTree(binFiles), [binFiles]);
  const visibleRows = useMemo(() => flattenVisible(tree, expanded), [tree, expanded]);

  // Default every folder open so the nested hierarchy is visible on sight
  // (the whole point of #55) rather than a wall of collapsed folders.
  useEffect(() => {
    setExpanded(new Set(binFiles.filter(i => i.item_type === 'folder').map(i => i.id)));
  }, [binFiles]);
  const canEmptyBin = hasPermission('filehub:bin_empty');

  const handleRestore = async (item: FileHubFile) => {
    setRestoringId(item.id);
    try {
      if (item.item_type === 'folder') {
        await restoreFolder(item.id);
      } else {
        await restoreFromBin(item.id);
      }
    } catch {
      // error surfaced by context
    } finally {
      setRestoringId(null);
    }
  };

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleEmptyBin = () => {
    const total = countNodes(tree);
    showConfirm(
      'Empty Bin Permanently?',
      `This will permanently delete all ${total} item${total === 1 ? '' : 's'} in the Bin right now — every file, every version, and every folder. This cannot be undone and does not wait for the 15-day grace period.`,
      async () => {
        setEmptying(true);
        try {
          // Progress + completion are surfaced by the dynamic island (same as
          // uploads); no extra alert needed here.
          await emptyBin();
        } catch {
          // error surfaced by the island
        } finally {
          setEmptying(false);
        }
      },
      undefined,
      'Empty Bin',
      'Cancel',
      'destructive'
    );
  };

  const isWeb = Platform.OS === 'web';

  // Renders ONE row. Hierarchy/indentation comes from `depth` (computed by
  // flattenVisible); children are separate FlatList rows, not nested here, so
  // the list can virtualize every row independently.
  const renderRow = (node: BinNode, depth: number): React.ReactNode => {
    const { item } = node;
    const isFolder = item.item_type === 'folder';
    const hasChildren = node.children.length > 0;
    const isExpanded = expanded.has(item.id);
    const { icon, color } = isFolder
      ? { icon: 'folder-o', color: '#d69e2e' }
      : getMimeIcon(item.mime_type);
    const days = daysRemaining(item.expires_at);
    const subtitle = isFolder
      ? `Deleted folder · ${days === 0 ? 'Expires today' : `Expires in ${days}d`}`
      : `${formatFileSize(item.size_bytes)} · ${item.trash_type === 'deleted' ? 'Deleted by you' : 'Hidden from your view'} · ${days === 0 ? 'Expires today' : `Expires in ${days}d`}`;

    return (
        <View
          className="flex-row items-center px-7 py-3.5 border-b"
          style={{ borderColor: c.border + '60', paddingLeft: 28 + depth * 28 }}
        >
          {isFolder ? (
            <TouchableOpacity
              onPress={() => hasChildren && toggleExpand(item.id)}
              disabled={!hasChildren}
              className="w-5 h-5 items-center justify-center mr-1.5 flex-shrink-0"
            >
              {hasChildren && (
                <FontAwesome name={isExpanded ? 'chevron-down' : 'chevron-right'} size={10} color={c.textMuted} />
              )}
            </TouchableOpacity>
          ) : (
            <View style={{ width: 20 }} className="mr-1.5 flex-shrink-0" />
          )}

          <View
            className="w-10 h-10 rounded-xl items-center justify-center mr-3.5 flex-shrink-0 border"
            style={{ backgroundColor: c.background, borderColor: c.border }}
          >
            <FontAwesome name={icon as any} size={16} color={color} />
          </View>
          <View className="flex-1 min-w-0 mr-3">
            <Text numberOfLines={1} className="text-sm font-bold" style={{ color: c.textMain }}>{item.original_name}</Text>
            <Text numberOfLines={1} className="text-[11px] mt-0.5" style={{ color: c.textMuted }}>
              {subtitle}
            </Text>
            {isWeb && (
              <View className="flex-row items-center mt-1.5 gap-1.5 flex-wrap">
                <View className="w-4 h-4 rounded-full items-center justify-center" style={{ backgroundColor: c.primary + '25' }}>
                  <Text style={{ color: c.primary, fontSize: 8, fontWeight: '900' }}>{initials(item.uploader?.full_name)}</Text>
                </View>
                <UserLink userId={item.uploader?.id} name={item.uploader?.full_name} fallback="Unknown" numberOfLines={1} className="text-[11px] font-semibold" style={{ color: c.textMuted }} />
                <Text style={{ color: c.border }}>·</Text>
                <FontAwesome name="folder-o" size={9} color={c.textMuted} />
                <Text numberOfLines={1} className="text-[11px]" style={{ color: c.textMuted }}>
                  {item.folder?.name || 'Root'}
                </Text>
                <Text style={{ color: c.border }}>·</Text>
                <Text numberOfLines={1} className="text-[11px]" style={{ color: c.textMuted }}>
                  Trashed {formatDateTime(item.trashed_at)}
                </Text>
              </View>
            )}
          </View>
          <TouchableOpacity
            onPress={() => handleRestore(item)}
            disabled={restoringId === item.id}
            className="flex-row items-center gap-1.5 px-3.5 py-2 rounded-lg"
            style={{ backgroundColor: c.primary }}
          >
            {restoringId === item.id
              ? <ActivityIndicator size="small" color="#fff" />
              : <FontAwesome name="undo" size={11} color="#fff" />}
            <Text className="text-white text-xs font-black">Restore</Text>
          </TouchableOpacity>
        </View>
    );
  };

  const body = (
    <>
          {/* Header */}
          <View className="px-7 pt-6 pb-4 flex-row items-start justify-between border-b" style={{ borderColor: c.border }}>
            <View className="flex-1 pr-3">
              <Text className="text-[9px] font-black uppercase tracking-[0.3em] mb-1" style={{ color: c.primary }}>Intelligence Hub</Text>
              <Text className="text-2xl font-black tracking-tight" style={{ color: c.textMain }}>Bin</Text>
              <Text className="text-xs font-medium mt-0.5" style={{ color: c.textMuted }}>Deleted files & folders — restorable for 15 days</Text>
            </View>
            <View className="flex-row items-center gap-3">
              {canEmptyBin && binFiles.length > 0 && (
                <TouchableOpacity
                  onPress={handleEmptyBin}
                  disabled={emptying}
                  className="flex-row items-center gap-2 h-10 px-4 rounded-full border"
                  style={{ borderColor: c.danger, backgroundColor: c.danger + '15' }}
                >
                  {emptying
                    ? <ActivityIndicator size="small" color={c.danger} />
                    : <FontAwesome name="trash" size={12} color={c.danger} />}
                  <Text className="text-xs font-black uppercase tracking-wider" style={{ color: c.danger }}>Empty Bin</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={onClose} className="h-10 w-10 items-center justify-center rounded-full border" style={{ borderColor: c.border, backgroundColor: c.card }}>
                <FontAwesome name="times" size={16} color={c.textMuted} />
              </TouchableOpacity>
            </View>
          </View>

          {binLoading ? (
            <View className="flex-1 items-center justify-center py-20">
              <ActivityIndicator size="large" color={c.primary} />
            </View>
          ) : binFiles.length === 0 ? (
            <View className="flex-1 items-center justify-center py-20 px-8">
              <FontAwesome name="trash-o" size={28} color={c.textMuted} />
              <Text className="text-sm font-bold mt-3 text-center" style={{ color: c.textMuted }}>Bin is empty</Text>
            </View>
          ) : (
            <FlatList
              data={visibleRows}
              keyExtractor={r => r.node.item.id}
              renderItem={({ item: r }) => renderRow(r.node, r.depth) as React.ReactElement}
              style={isWeb ? { flex: 1 } : { maxHeight: 480 }}
              contentContainerStyle={{ paddingVertical: 8 }}
              showsVerticalScrollIndicator={false}
              // Virtualization: render a dozen rows up front, more as the user
              // scrolls, and drop off-screen rows on native. This is what keeps
              // a 1500-item bin from mounting 1500 row subtrees at once.
              initialNumToRender={12}
              maxToRenderPerBatch={12}
              windowSize={7}
              removeClippedSubviews={!isWeb}
              ListFooterComponent={<View style={{ height: 12 }} />}
            />
          )}
    </>
  );

  if (!isWeb) {
    return (
      <DraggableSheet
        visible={visible}
        onClose={onClose}
        dimBackdrop
        maxHeight="85%"
        containerClassName="overflow-hidden border-t rounded-t-3xl"
        containerStyle={{ backgroundColor: c.background, borderColor: c.border }}
      >
        {body}
      </DraggableSheet>
    );
  }

  // Desktop web: fullscreen, not the small centered dialog it used to be (#59)
  // — a 15-day-restorable bin holding potentially hundreds of items needs the
  // room, and the per-row detail line above needs it too.
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View className="flex-1" style={{ backgroundColor: c.background }}>
        {body}
      </View>
    </Modal>
  );
}
