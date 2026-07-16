import { useAlert } from '@/contexts/AlertContext';
import { useAuth } from '@/contexts/AuthContext';
import { FileActivity, FileHubFile, FileHubFolder, FileHubFolderScope, FileHubGroup, FileHubGroupMember, FileHubMode, FileHubProvider, FileHubShareLink, FileVersion, folderAncestors, folderPath, shareLinkUrl, useFileHub } from '@/contexts/FileHubContext';
import { useToast } from '@/contexts/ToastContext';
import * as Clipboard from 'expo-clipboard';
import { useFileSizeLimit } from '@/hooks/useFileSizeLimit';
import { useImageLightbox } from '@/hooks/useImageLightbox';
import { useThemeColors } from '@/hooks/useThemeColors';
import { useDragSource, useDropTarget, useMarqueeSelect } from '@/hooks/useWebDnd';
import { FilePreviewModal, FilePreviewTeaser, getPreviewKind, type PreviewKind } from './../common/FilePreview';
import FileHubAnalytics from './FileHubAnalytics';
import FileHubBin from './FileHubBin';
import { ensureFolderTree, groupPickedFiles, relDir } from '@/lib/filehubFolderTree';
import { downloadFilesAsZip, openStorageFile } from '@/lib/storage';
import TaskFileResults from './TaskFileResults';
import { supabase } from '@/lib/supabase';
import { FontAwesome } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function relativeDate(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / (86400 * 7))}w ago`;
  return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Whole days from now until `expires_at`. Returns null when missing/already past.
function expiresInDays(expiresAt: string | null): number | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return null;
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

function getMimeIcon(mimeType: string | null): { icon: string; color: string } {
  if (!mimeType) return { icon: 'file-o', color: '#94a3b8' };
  const t = mimeType.toLowerCase();
  if (t.includes('pdf')) return { icon: 'file-pdf-o', color: '#e53e3e' };
  if (t.includes('image')) return { icon: 'file-image-o', color: '#38a169' };
  if (t.includes('spreadsheet') || t.includes('excel') || t.includes('csv')) return { icon: 'file-excel-o', color: '#2f855a' };
  if (t.includes('word') || t.includes('wordprocessing')) return { icon: 'file-word-o', color: '#2b6cb0' };
  if (t.includes('zip') || t.includes('compressed') || t.includes('archive')) return { icon: 'file-zip-o', color: '#d69e2e' };
  if (t.includes('video')) return { icon: 'file-video-o', color: '#805ad5' };
  if (t.includes('audio')) return { icon: 'file-audio-o', color: '#dd6b20' };
  if (t.includes('text')) return { icon: 'file-text-o', color: '#4a5568' };
  return { icon: 'file-o', color: '#94a3b8' };
}

async function computeSHA256(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await (crypto as any).subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b: number) => b.toString(16).padStart(2, '0'))
    .join('');
}

function getInitials(name: string): string {
  return name.trim().split(/\s+/).map(w => w[0]?.toUpperCase() ?? '').slice(0, 2).join('');
}

const GROUP_COLORS = [
  '#6366f1', '#0ea5e9', '#10b981', '#f59e0b',
  '#ef4444', '#8b5cf6', '#06b6d4', '#f97316',
];

const TAG_PALETTE = [
  { bg: '#fef3c7', text: '#92400e', border: '#fde68a' },
  { bg: '#dcfce7', text: '#166534', border: '#bbf7d0' },
  { bg: '#dbeafe', text: '#1e40af', border: '#bfdbfe' },
  { bg: '#f3e8ff', text: '#6b21a8', border: '#e9d5ff' },
  { bg: '#ffe4e6', text: '#9f1239', border: '#fecdd3' },
  { bg: '#ccfbf1', text: '#134e4a', border: '#99f6e4' },
  { bg: '#ffedd5', text: '#7c2d12', border: '#fed7aa' },
  { bg: '#e0e7ff', text: '#3730a3', border: '#c7d2fe' },
];

function getTagColor(tag: string): { bg: string; text: string; border: string } {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = (hash * 31 + tag.charCodeAt(i)) >>> 0;
  return TAG_PALETTE[hash % TAG_PALETTE.length];
}

const ACTIVITY_META: Record<string, { icon: string; color: string; label: string }> = {
  upload:   { icon: 'upload',   color: '#10b981', label: 'Uploaded'   },
  download: { icon: 'download', color: '#3b82f6', label: 'Downloaded' },
  view:     { icon: 'eye',      color: '#8b5cf6', label: 'Viewed'     },
  delete:   { icon: 'trash-o',  color: '#ef4444', label: 'Deleted'    },
  share:    { icon: 'share',    color: '#f59e0b', label: 'Shared'     },
};

// ─── Upload helpers ───────────────────────────────────────────────────────────

const ALLOWED_EXTENSIONS = new Set([
  'pdf','doc','docx','xls','xlsx','ppt','pptx','csv','txt','rtf','odt','ods','odp',
  'jpg','jpeg','png','gif','webp','svg','bmp','tiff','tif','heic','heif','avif',
  'mp4','mov','avi','mkv','webm','m4v','wmv','flv','ogv',
  'mp3','wav','aac','ogg','flac','m4a','wma','opus',
  'zip','rar','7z','tar','gz','tgz','bz2','xz',
  'json','xml','yaml','yml','toml','sql','md','html','css','js','ts','jsx','tsx',
]);

const ALLOWED_TYPES_MESSAGE =
  '• Documents: PDF, Word, Excel, PowerPoint, CSV, TXT, RTF\n' +
  '• Images: JPG, PNG, GIF, WEBP, SVG, HEIC\n' +
  '• Video: MP4, MOV, AVI, MKV, WEBM\n' +
  '• Audio: MP3, WAV, AAC, OGG, FLAC\n' +
  '• Archives: ZIP, RAR, 7Z, TAR, GZ\n' +
  '• Data: JSON, XML, YAML, SQL, HTML, JS, TS';

function isAllowedFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return ALLOWED_EXTENSIONS.has(ext);
}

// ─── Adaptive File Grid ───────────────────────────────────────────────────────

function AdaptiveFileGrid({
  files,
  onRemove,
  onAddMore
}: {
  files: File[];
  onRemove: (indices: number[]) => void;
  onAddMore: () => void;
}) {
  // Since this renders inside a modal restricted to max-w-[560px] with 32px padding,
  // we can use a baseline width of ~496px before onLayout accurately fires.
  const [containerWidth, setContainerWidth] = useState(496);

  const gap = 12;
  const minSquareSize = 100;

  let numCols = Math.floor((containerWidth + gap) / (minSquareSize + gap));
  if (numCols < 2) numCols = 2;
  const exactSquareSize = Math.floor((containerWidth - (gap * (numCols - 1))) / numCols);

  if (files.length === 0) return null;

  // A picked folder renders as one tile, not one per nested file.
  const entries = groupPickedFiles(files, f => (f as any).webkitRelativePath, f => f.size);

  return (
    <View
      onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
      className="flex-row flex-wrap w-full bg-surface-card border border-surface-border rounded-2xl p-4"
      style={{ gap }}
    >
      {entries.map(entry => {
        if (entry.kind === 'folder') {
          return (
            <View
              key={`dir-${entry.name}`}
              style={{ width: exactSquareSize, height: exactSquareSize }}
              className="rounded-xl overflow-hidden border border-surface-border bg-surface-background relative"
            >
              <View className="flex-1 items-center justify-center p-2" style={{ backgroundColor: '#f59e0b12' }}>
                <FontAwesome name="folder" size={exactSquareSize > 100 ? 36 : 28} color="#f59e0b" />
                <View className="mt-3 bg-surface-background px-2 py-1 rounded-md border border-surface-border shadow-sm" style={{ maxWidth: '90%' }}>
                  <Text className="text-[10px] font-black text-typography-muted" numberOfLines={1}>
                    {entry.name}
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                onPress={() => onRemove(entry.indices)}
                className="absolute top-1.5 right-1.5 w-6 h-6 bg-black/50 rounded-full items-center justify-center hover:bg-black/70 transition-colors"
                style={{ cursor: 'pointer' } as any}
              >
                <FontAwesome name="times" size={10} color="#fff" />
              </TouchableOpacity>
              <View className="absolute bottom-0 left-0 right-0 bg-black/60 px-2 py-1 backdrop-blur-md">
                <Text className="text-white text-[9px] font-bold text-center" numberOfLines={1}>
                  {entry.count} files · {formatFileSize(entry.size)}
                </Text>
              </View>
            </View>
          );
        }
        const pf = entry.item;
        const idx = entry.index;
        const isImage = pf.type?.toLowerCase().startsWith('image/');
        const { icon, color } = getMimeIcon(pf.type || null);
        
        // Convert the native DOM File into a temporary blob URL for the web <Image>
        const imageSource = isImage ? URL.createObjectURL(pf) : '';

        return (
          <View
            key={`${pf.name}-${idx}`}
            style={{ width: exactSquareSize, height: exactSquareSize }}
            className="rounded-xl overflow-hidden border border-surface-border bg-surface-background relative"
          >
            {isImage ? (
              <Image
                source={{ uri: imageSource }}
                style={{ flex: 1, width: '100%', height: '100%', position: 'absolute' }}
                resizeMode="cover"
              />
            ) : (
              <View className="flex-1 items-center justify-center p-2" style={{ backgroundColor: color + '12' }}>
                <FontAwesome name={icon as any} size={exactSquareSize > 100 ? 36 : 28} color={color} />
                <View className="mt-3 bg-surface-background px-2 py-1 rounded-md border border-surface-border shadow-sm">
                  <Text className="text-[10px] font-black uppercase text-typography-muted" numberOfLines={1}>
                    {pf.name.split('.').pop() || 'FILE'}
                  </Text>
                </View>
              </View>
            )}

            <TouchableOpacity
              onPress={() => onRemove([idx])}
              className="absolute top-1.5 right-1.5 w-6 h-6 bg-black/50 rounded-full items-center justify-center hover:bg-black/70 transition-colors"
              style={{ cursor: 'pointer' } as any}
            >
              <FontAwesome name="times" size={10} color="#fff" />
            </TouchableOpacity>

            <View className="absolute bottom-0 left-0 right-0 bg-black/60 px-2 py-1 backdrop-blur-md">
              <Text className="text-white text-[9px] font-bold text-center" numberOfLines={1}>
                {formatFileSize(pf.size)}
              </Text>
            </View>
          </View>
        );
      })}

      <TouchableOpacity
        onPress={onAddMore}
        style={{ width: exactSquareSize, height: exactSquareSize }}
        className="rounded-xl border-2 border-dashed border-surface-border bg-surface-background items-center justify-center hover:bg-surface-overlay transition-colors"
      >
        <FontAwesome name="plus" size={20} color="#94a3b8" />
        <Text className="text-typography-muted text-[10px] font-black mt-2 tracking-wide uppercase">Add More</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Upload Modal ─────────────────────────────────────────────────────────────

type UploadDraft = {
  files: File[];
  visibility: 'direct' | 'broadcast' | 'group';
  recipientIds: string[];
  folderId: string | null;
  tags: string[];
  tagInput: string;
  caption: string;
};

const EMPTY_DRAFT = (defaultVisibility: 'direct' | 'group' = 'direct'): UploadDraft => ({
  files: [],
  visibility: defaultVisibility,
  recipientIds: [],
  folderId: null,
  tags: [],
  tagInput: '',
  caption: '',
});

function UploadModal({
  visible,
  folders,
  onClose,
  onUploaded,
  checkDuplicate,
  checkNameConflict,
  replaceFile,
  hasPermission,
  profile,
  activeGroup,
}: {
  visible: boolean;
  folders: FileHubFolder[];
  onClose: () => void;
  onUploaded: () => void;
  checkDuplicate: (hash: string, folderId: string | null) => Promise<any[]>;
  checkNameConflict: (
    name: string,
    visibility: 'direct' | 'broadcast' | 'group',
    groupId: string | null,
    folderId: string | null
  ) => Promise<any | null>;
  replaceFile: (
    targetId: string,
    args: { storagePath: string; size: number; hash: string | null; mime: string | null; caption?: string | null }
  ) => Promise<void>;
  hasPermission: (key: string) => boolean;
  profile: any;
  activeGroup?: { id: string; name: string; avatar_color: string } | null;
}) {
  const { refreshFolders } = useFileHub();
  const fileInputRef = useRef<any>(null);
  const folderInputRef = useRef<any>(null);
  const [draft, setDraft] = useState<UploadDraft>(EMPTY_DRAFT(activeGroup ? 'group' : 'direct'));
  const [uploading, setUploading] = useState(false);
  const maxFileSizeBytes = useFileSizeLimit();
  const [uploadingIndex, setUploadingIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [recipientSearch, setRecipientSearch] = useState('');
  const [memberResults, setMemberResults] = useState<any[]>([]);
  const [searchingMembers, setSearchingMembers] = useState(false);
  const [tagSuggestResults, setTagSuggestResults] = useState<string[]>([]);
  // Web-safe replacement for Alert.alert multi-button prompts (RN Alert.alert
  // does not render usable buttons on web, which hung uploads at the conflict
  // / duplicate check). Renders an in-modal dialog and resolves on press.
  type DecisionOption = { label: string; value: string; style?: 'primary' | 'cancel' | 'default' };
  const [pendingDecision, setPendingDecision] = useState<
    { title: string; message: string; options: DecisionOption[]; resolve: (v: string) => void } | null
  >(null);
  const askDecision = (title: string, message: string, options: DecisionOption[]) =>
    new Promise<string>(resolve => setPendingDecision({ title, message, options, resolve }));

  const patch = (updates: Partial<UploadDraft>) => setDraft(prev => ({ ...prev, ...updates }));

  // Folders are scoped: a channel's folders never appear outside it, and
  // Direct/Broadcast are separate trees too — so the picker only ever offers
  // folders matching whatever this upload will actually target.
  const uploadScope: FileHubFolderScope = activeGroup ? 'group' : (draft.visibility === 'broadcast' ? 'broadcast' : 'direct');
  const scopedFolders = useMemo(
    () => folders.filter(f => f.scope === uploadScope && (f.group_id ?? null) === (activeGroup?.id ?? null)),
    [folders, uploadScope, activeGroup?.id]
  );

  useEffect(() => {
    if (!visible) {
      setDraft(EMPTY_DRAFT(activeGroup ? 'group' : 'direct'));
      setProgress(0);
      setUploadingIndex(0);
      setRecipientSearch('');
      setMemberResults([]);
    } else if (activeGroup) {
      setDraft(prev => ({ ...prev, visibility: 'group' }));
    }
  }, [visible, activeGroup?.id]);

  const searchMembers = useCallback(async (query: string) => {
    setRecipientSearch(query);
    if (!query.trim()) { setMemberResults([]); return; }
    setSearchingMembers(true);
    try {
      const { data } = await supabase.from('users').select('id, full_name, avatar_url').ilike('full_name', `%${query}%`).limit(8);
      setMemberResults(data || []);
    } finally {
      setSearchingMembers(false);
    }
  }, []);

  const fetchTagSuggestions = useCallback(async (prefix: string) => {
    if (!prefix.trim()) { setTagSuggestResults([]); return; }
    const { data } = await supabase.rpc('rpc_filehub_tag_suggestions', { p_prefix: prefix, p_limit: 8 });
    setTagSuggestResults((data || []).filter((t: string) => !draft.tags.includes(t)));
  }, [draft.tags]);

  const toggleRecipient = (id: string) => {
    patch({ recipientIds: draft.recipientIds.includes(id) ? draft.recipientIds.filter(r => r !== id) : [...draft.recipientIds, id] });
  };

  const addTag = (tag: string) => {
    const clean = tag.trim().toLowerCase().replace(/\s+/g, '-');
    if (!clean || draft.tags.includes(clean)) return;
    patch({ tags: [...draft.tags, clean], tagInput: '' });
    setTagSuggestResults([]);
  };

  const handleTagKeyPress = (e: any) => {
    if (e.nativeEvent?.key === 'Enter' || e.nativeEvent?.key === ',') {
      e.preventDefault?.();
      addTag(draft.tagInput);
    }
  };

  const processWebFiles = (fileList: FileList | null): File[] => {
    if (!fileList || fileList.length === 0) return [];
    const valid: File[] = [];
    const rejected: string[] = [];
    Array.from(fileList)
      .filter(f => !f.name.startsWith('.'))
      .forEach(file => {
        if (isAllowedFile(file.name)) {
          valid.push(file);
        } else {
          rejected.push(file.name);
        }
      });
    if (rejected.length > 0) {
      Alert.alert(
        'Unsupported File Type',
        `${rejected.length === 1 ? `"${rejected[0]}" is` : `${rejected.length} files are`} not supported.\n\nSupported types:\n${ALLOWED_TYPES_MESSAGE}`,
      );
    }
    return valid;
  };

  const handleFileChange = (e: any) => {
    const valid = processWebFiles(e.target?.files);
    if (valid.length > 0) patch({ files: [...draft.files, ...valid] });
    e.target.value = '';
  };

  const handleFolderChange = (e: any) => {
    const valid = processWebFiles(e.target?.files);
    if (valid.length > 0) patch({ files: [...draft.files, ...valid] });
    e.target.value = '';
  };

  const handleUpload = async () => {
    if (draft.files.length === 0 || uploading) return;
    const companyId = profile?.company_id;
    if (!companyId) { Alert.alert('Error', 'Company not found.'); return; }
    if (draft.visibility === 'group' && !activeGroup?.id) {
      Alert.alert('Error', 'No channel selected.'); return;
    }

    setUploading(true);
    const errors: string[] = [];
    // Remembered "…for all" answers so a 700-file batch needs one click, not 700.
    let dupeAll: string | null = null;
    let conflictAll: string | null = null;

    // Folder uploads keep their Explorer structure: every distinct directory
    // in the batch (from webkitRelativePath) becomes a FileHub folder under
    // the chosen target, merged into existing same-name folders.
    let folderIdByDir = new Map<string, string>();
    const dirs = [...new Set(draft.files.map(f => relDir((f as any).webkitRelativePath)))].filter(Boolean);
    if (dirs.length > 0) {
      try {
        folderIdByDir = await ensureFolderTree(dirs, draft.folderId, scopedFolders, async (name, parentId) => {
          const { data, error } = await supabase.rpc('rpc_filehub_folder_create', {
            p_name: name,
            p_parent_id: parentId,
            p_scope: uploadScope,
            p_group_id: uploadScope === 'group' ? (activeGroup?.id ?? null) : null,
          });
          if (error) throw error;
          return data as string;
        });
        refreshFolders();
      } catch (e: any) {
        setUploading(false);
        Alert.alert('Upload Failed', `Could not create folders: ${e.message || e}`);
        return;
      }
    }

    // Only one decision dialog can be on screen at a time; workers queue
    // behind this chain, and re-check the remembered batch answer once it's
    // their turn so an "…for all" click also covers dialogs already waiting.
    let dialogQueue: Promise<unknown> = Promise.resolve();
    const askQueued = (remembered: () => string | null, show: () => Promise<string>): Promise<string> => {
      const turn = dialogQueue.then(() => remembered() ?? show());
      dialogQueue = turn.catch(() => {});
      return turn;
    };

    const uploadOne = async (file: File) => {
      const targetFolderId = folderIdByDir.get(relDir((file as any).webkitRelativePath)) ?? draft.folderId;
      try {
        if (maxFileSizeBytes !== null && maxFileSizeBytes !== undefined && file.size > maxFileSizeBytes) {
          errors.push(`${file.name}: exceeds your plan's ${formatFileSize(maxFileSizeBytes)} file size limit.`);
          return;
        }
        const contentHash = await computeSHA256(file);

        const dupes = await checkDuplicate(contentHash, targetFolderId);
        if (dupes.length > 0) {
          let proceed = await askQueued(() => dupeAll, () => askDecision(
            'Possible Duplicate',
            `"${dupes[0].original_name}" has the same content as "${file.name}". Upload anyway?`,
            [
              { label: 'Skip', value: 'cancel', style: 'cancel' },
              { label: 'Skip All Duplicates', value: 'cancel_all', style: 'cancel' },
              { label: 'Upload Anyway', value: 'proceed', style: 'primary' },
              { label: 'Upload All Anyway', value: 'proceed_all', style: 'default' },
            ]
          ));
          if (proceed.endsWith('_all')) { proceed = proceed.slice(0, -4); dupeAll = proceed; }
          if (proceed !== 'proceed') return;
        }

        // Name-conflict prompt (Replace / Keep Both / Cancel)
        const groupId = draft.visibility === 'group' ? (activeGroup?.id ?? null) : null;
        const conflict = await checkNameConflict(file.name, draft.visibility, groupId, targetFolderId);
        if (conflict) {
          let choice = await askQueued(() => conflictAll, () => askDecision(
            'File already exists',
            `"${file.name}" already exists here (uploaded by ${conflict.uploader_name}). Replace it with a new version, or keep both?`,
            [
              { label: 'Skip', value: 'cancel', style: 'cancel' },
              { label: 'Skip All Conflicts', value: 'cancel_all', style: 'cancel' },
              { label: 'Keep Both', value: 'keep', style: 'default' },
              { label: 'Replace', value: 'replace', style: 'primary' },
              { label: 'Replace All', value: 'replace_all', style: 'default' },
            ]
          ));
          if (choice.endsWith('_all')) { choice = choice.slice(0, -4); conflictAll = choice; }
          if (choice === 'cancel') return;
          if (choice === 'replace') {
            const replaceId = (crypto as any).randomUUID();
            const replaceSafeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
            const replacePath = `${companyId}/${replaceId}/${replaceSafeName}`;
            const { error: replaceStorageError } = await supabase.storage.from('filehub-files').upload(replacePath, file, { contentType: file.type || 'application/octet-stream' });
            if (replaceStorageError) throw replaceStorageError;
            await replaceFile(conflict.id, {
              storagePath: replacePath,
              size: file.size,
              hash: contentHash,
              mime: file.type || null,
              caption: draft.caption || null,
            });
            return;
          }
          // 'keep' falls through to the normal upload_commit path (server auto-renames)
        }

        const fileId = (crypto as any).randomUUID();
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const storagePath = `${companyId}/${fileId}/${safeName}`;

        const { error: storageError } = await supabase.storage.from('filehub-files').upload(storagePath, file, { contentType: file.type || 'application/octet-stream' });
        if (storageError) throw storageError;

        const { error: rpcError } = await supabase.rpc('rpc_filehub_upload_commit', {
          p_storage_path: storagePath,
          p_visibility: draft.visibility,
          p_recipient_ids: draft.visibility === 'direct' ? draft.recipientIds : [],
          p_folder_id: targetFolderId,
          p_tags: draft.tags,
          p_caption: draft.caption || null,
          p_original_name: file.name,
          p_mime_type: file.type || null,
          p_size_bytes: file.size,
          p_content_hash: contentHash,
          p_replaces_file_id: null,
          p_group_id: draft.visibility === 'group' ? (activeGroup?.id ?? null) : null,
        });
        if (rpcError) throw rpcError;
      } catch (e: any) {
        errors.push(`${file.name}: ${e.message || 'Unknown error'}`);
      }
    };

    // Sequential round trips were the bottleneck for big batches (4 network
    // hops per file), so a few files fly in parallel; progress becomes
    // "files completed / total" instead of per-file phases.
    // ponytail: fixed pool of 4, tune only if storage starts rate-limiting.
    const total = draft.files.length;
    let nextIdx = 0;
    let done = 0;
    setProgress(1);
    await Promise.all(
      Array.from({ length: Math.min(4, total) }, async () => {
        for (;;) {
          const i = nextIdx++;
          if (i >= total) break;
          await uploadOne(draft.files[i]);
          done++;
          setUploadingIndex(done - 1);
          setProgress(Math.max(1, Math.round((done / total) * 100)));
        }
      })
    );

    setUploading(false);
    setProgress(0);

    const successCount = draft.files.length - errors.length;
    if (errors.length > 0 && successCount > 0) {
      Alert.alert('Some uploads failed', errors.join('\n'));
    } else if (errors.length === draft.files.length) {
      Alert.alert('Upload Failed', errors.join('\n'));
      return;
    }

    onUploaded();
    onClose();
  };

  const canBroadcast = hasPermission('filehub:broadcast');
  const colors = useThemeColors();

  return (
    <>
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 bg-black/40 items-center justify-center p-8">
        <View className="bg-surface-card rounded-[2rem] border border-surface-border premium-shadow w-full max-w-[560px]" style={{ maxHeight: '100%' }}>
          <View className="flex-row items-center justify-between px-8 pt-7 pb-5 border-b border-surface-border">
            <Text className="text-typography-main text-xl font-black tracking-tight">
              {activeGroup ? `Upload to ${activeGroup.name}` : 'Upload Files'}
            </Text>
            <TouchableOpacity onPress={onClose} className="w-8 h-8 items-center justify-center rounded-xl bg-surface-background border border-surface-border">
              <FontAwesome name="times" size={12} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 32, gap: 20 }}>
            {Platform.OS === 'web' && (
              <>
                <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={handleFileChange} />
                <input ref={folderInputRef} type="file" {...({ webkitdirectory: '', multiple: '' } as any)} style={{ display: 'none' }} onChange={handleFolderChange} />
              </>
            )}

            {/* File picker area */}
            {draft.files.length === 0 ? (
              <View className="border-2 border-dashed border-surface-border rounded-2xl items-center justify-center py-10 px-6 gap-4">
                <View className="w-14 h-14 bg-surface-background rounded-2xl border border-surface-border items-center justify-center">
                  <FontAwesome name="cloud-upload" size={24} color={colors.textMuted} />
                </View>
                <View className="items-center gap-1">
                  <Text className="text-typography-main font-bold text-sm">Choose files to upload</Text>
                  <Text className="text-typography-muted text-xs">Up to 500 MB per file</Text>
                </View>
                <View className="flex-row gap-3">
                  <TouchableOpacity
                    onPress={() => fileInputRef.current?.click()}
                    className="flex-row items-center gap-2 bg-brand-primary px-5 py-2.5 rounded-xl"
                  >
                    <FontAwesome name="files-o" size={12} color="#fff" />
                    <Text className="text-white font-black text-sm">Files</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => folderInputRef.current?.click()}
                    className="flex-row items-center gap-2 bg-surface-background border border-surface-border px-5 py-2.5 rounded-xl"
                  >
                    <FontAwesome name="folder-open" size={12} color={colors.textMuted} />
                    <Text className="text-typography-muted font-black text-sm">Folder</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <AdaptiveFileGrid
                files={draft.files}
                onRemove={(indices) => {
                  const drop = new Set(indices);
                  patch({ files: draft.files.filter((_, i) => !drop.has(i)) });
                }}
                onAddMore={() => fileInputRef.current?.click()}
              />
            )}

            {/* Visibility — hidden when uploading to a group (locked to group) */}
            {!activeGroup ? (
              <View className="gap-2">
                <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">Visibility</Text>
                <View className="flex-row gap-2">
                  {[
                    { value: 'direct', label: 'Direct Send', icon: 'user' },
                    ...(canBroadcast ? [{ value: 'broadcast', label: 'Broadcast', icon: 'bullhorn' }] : []),
                  ].map(opt => (
                    <TouchableOpacity
                      key={opt.value}
                      onPress={() => patch({ visibility: opt.value as any, recipientIds: [] })}
                      className={`flex-1 flex-row items-center justify-center gap-2 py-3 rounded-xl border ${
                        draft.visibility === opt.value
                          ? 'bg-brand-primary/10 border-brand-primary/30'
                          : 'bg-surface-background border-surface-border'
                      }`}
                    >
                      <FontAwesome
                        name={opt.icon as any}
                        size={12}
                        color={draft.visibility === opt.value ? colors.primary : colors.textMuted}
                      />
                      <Text className={`text-sm font-black ${draft.visibility === opt.value ? 'text-brand-primary' : 'text-typography-muted'}`}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ) : (
              /* Group badge */
              <View className="flex-row items-center gap-3 bg-surface-background border border-surface-border rounded-xl px-4 py-3">
                <View
                  className="w-9 h-9 rounded-xl items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: activeGroup.avatar_color + '22' }}
                >
                  <Text style={{ color: activeGroup.avatar_color, fontSize: 13, fontWeight: '900' }}>
                    {getInitials(activeGroup.name)}
                  </Text>
                </View>
                <View className="flex-1">
                  <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">Sharing to channel</Text>
                  <Text className="text-typography-main font-bold text-sm">{activeGroup.name}</Text>
                </View>
                <View className="bg-brand-primary/10 border border-brand-primary/20 rounded-full px-2.5 py-1">
                  <Text className="text-brand-primary text-[10px] font-black">Channel</Text>
                </View>
              </View>
            )}

            {/* Recipients */}
            {draft.visibility === 'direct' && (
              <View className="gap-2">
                <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">Recipients</Text>
                {draft.recipientIds.length > 0 && (
                  <View className="flex-row flex-wrap gap-2 mb-1">
                    {memberResults
                      .filter(m => draft.recipientIds.includes(m.id))
                      .map(m => (
                        <View key={m.id} className="flex-row items-center gap-1.5 bg-brand-primary/10 border border-brand-primary/20 rounded-full px-3 py-1">
                          <Text className="text-brand-primary text-xs font-bold">{m.full_name}</Text>
                          <TouchableOpacity onPress={() => toggleRecipient(m.id)}>
                            <FontAwesome name="times" size={9} color={colors.primary} />
                          </TouchableOpacity>
                        </View>
                      ))}
                  </View>
                )}
                <View className="flex-row items-center bg-surface-background border border-surface-border rounded-xl px-4 py-2.5 gap-2">
                  <FontAwesome name="search" size={11} color={colors.textMuted} />
                  <TextInput
                    value={recipientSearch}
                    onChangeText={searchMembers}
                    placeholder="Search team members..."
                    placeholderTextColor={colors.textDim}
                    className="flex-1 text-typography-main text-sm outline-none bg-transparent"
                  />
                  {searchingMembers && <ActivityIndicator size="small" color={colors.primary} />}
                </View>
                {memberResults.length > 0 && (
                  <View className="bg-surface-card border border-surface-border rounded-xl overflow-hidden">
                    {memberResults.map((m, i) => (
                      <TouchableOpacity
                        key={m.id}
                        onPress={() => toggleRecipient(m.id)}
                        className={`flex-row items-center px-4 py-3 gap-3 ${i < memberResults.length - 1 ? 'border-b border-surface-border/50' : ''}`}
                      >
                        <View className="w-7 h-7 rounded-full bg-surface-background border border-surface-border items-center justify-center">
                          <FontAwesome name="user" size={11} color={colors.textMuted} />
                        </View>
                        <Text className="flex-1 text-typography-main text-sm font-medium">{m.full_name}</Text>
                        {draft.recipientIds.includes(m.id) && <FontAwesome name="check" size={11} color={colors.primary} />}
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            )}

            {/* Folder — hidden for group uploads when no folders exist in this group */}
            {(!activeGroup || scopedFolders.length > 0) && (
              <View className="gap-2">
                <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">Folder</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, flexDirection: 'row', alignItems: 'center' }}>
                  <TouchableOpacity
                    onPress={() => patch({ folderId: null })}
                    className={`px-4 py-2 rounded-xl border ${!draft.folderId ? 'bg-brand-primary/10 border-brand-primary/30' : 'bg-surface-background border-surface-border'}`}
                  >
                    <Text className={`text-xs font-bold ${!draft.folderId ? 'text-brand-primary' : 'text-typography-muted'}`}>No folder</Text>
                  </TouchableOpacity>
                  {[...scopedFolders].sort((a, b) => folderPath(scopedFolders, a.id).localeCompare(folderPath(scopedFolders, b.id))).map(f => (
                    <TouchableOpacity
                      key={f.id}
                      onPress={() => patch({ folderId: f.id })}
                      className={`px-4 py-2 rounded-xl border ${draft.folderId === f.id ? 'bg-brand-primary/10 border-brand-primary/30' : 'bg-surface-background border-surface-border'}`}
                    >
                      <Text className={`text-xs font-bold ${draft.folderId === f.id ? 'text-brand-primary' : 'text-typography-muted'}`}>{folderPath(scopedFolders, f.id)}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}

            {/* Tags */}
            <View className="gap-2">
              <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">Tags</Text>
              {draft.tags.length > 0 && (
                <View className="flex-row flex-wrap gap-2">
                  {draft.tags.map(tag => (
                    <View key={tag} className="flex-row items-center gap-1.5 bg-surface-background border border-surface-border rounded-full px-3 py-1">
                      <Text className="text-typography-muted text-xs font-bold">{tag}</Text>
                      <TouchableOpacity onPress={() => patch({ tags: draft.tags.filter(t => t !== tag) })}>
                        <FontAwesome name="times" size={9} color={colors.textMuted} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}
              <View className="flex-row items-center bg-surface-background border border-surface-border rounded-xl px-4 py-2.5 gap-2">
                <FontAwesome name="tag" size={11} color={colors.textMuted} />
                <TextInput
                  value={draft.tagInput}
                  onChangeText={v => { patch({ tagInput: v }); fetchTagSuggestions(v); }}
                  onKeyPress={handleTagKeyPress}
                  onSubmitEditing={() => addTag(draft.tagInput)}
                  placeholder="Add tag and press Enter..."
                  placeholderTextColor={colors.textDim}
                  className="flex-1 text-typography-main text-sm outline-none bg-transparent"
                />
              </View>
              {tagSuggestResults.length > 0 && (
                <View className="flex-row flex-wrap gap-2">
                  {tagSuggestResults.map(t => (
                    <TouchableOpacity key={t} onPress={() => addTag(t)} className="px-3 py-1 rounded-full bg-brand-primary/5 border border-brand-primary/20">
                      <Text className="text-brand-primary text-xs font-bold">{t}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            {/* Caption */}
            <View className="gap-2">
              <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">Caption</Text>
              <TextInput
                value={draft.caption}
                onChangeText={v => patch({ caption: v })}
                placeholder="Add a note or description..."
                placeholderTextColor={colors.textDim}
                multiline
                numberOfLines={3}
                className="bg-surface-background border border-surface-border rounded-xl px-4 py-3 text-typography-main text-sm outline-none"
                style={{ minHeight: 80, textAlignVertical: 'top' }}
              />
            </View>

            {/* Progress */}
            {uploading && (
              <View className="bg-surface-background border border-surface-border rounded-xl px-4 py-3 gap-2">
                <View className="flex-row items-center justify-between mb-1">
                  <Text className="text-typography-main text-xs font-bold">
                    {draft.files.length > 1 ? `${uploadingIndex + 1} of ${draft.files.length} done · ` : ''}
                    Uploading…
                  </Text>
                  <Text className="text-brand-primary text-xs font-black">{progress}%</Text>
                </View>
                <View className="h-1.5 bg-surface-border rounded-full overflow-hidden">
                  <View className="h-full bg-brand-primary rounded-full" style={{ width: `${progress}%` }} />
                </View>
              </View>
            )}

            {/* Actions */}
            <View className="flex-row gap-3 pt-2">
              <TouchableOpacity
                onPress={onClose}
                disabled={uploading}
                className="flex-1 items-center justify-center py-3.5 rounded-xl border border-surface-border bg-surface-background"
              >
                <Text className="text-typography-muted font-black text-sm">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleUpload}
                disabled={draft.files.length === 0 || uploading || (draft.visibility === 'direct' && draft.recipientIds.length === 0)}
                className="flex-[2] items-center justify-center py-3.5 rounded-xl bg-brand-primary"
                style={{ opacity: (draft.files.length === 0 || uploading || (draft.visibility === 'direct' && draft.recipientIds.length === 0)) ? 0.5 : 1 }}
              >
                {uploading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text className="text-white font-black text-sm">
                    {draft.files.length > 1
                      ? `Upload ${draft.files.length} Files`
                      : draft.visibility === 'group' ? 'Share to Channel' : 'Upload File'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>

    {/* Web-safe decision dialog (replaces RN Alert.alert multi-button prompts) */}
    {pendingDecision && (
      <Modal visible transparent animationType="fade">
        <View className="flex-1 bg-black/60 items-center justify-center p-8">
          <View className="bg-surface-card rounded-3xl border border-surface-border premium-shadow w-full max-w-[420px] p-6">
            <Text className="text-typography-main text-lg font-black tracking-tight mb-2">{pendingDecision.title}</Text>
            <Text className="text-typography-muted text-sm leading-relaxed mb-5">{pendingDecision.message}</Text>
            <View className="gap-2">
              {pendingDecision.options.map(opt => (
                <TouchableOpacity
                  key={opt.value}
                  onPress={() => { const r = pendingDecision.resolve; setPendingDecision(null); r(opt.value); }}
                  className={`py-3 rounded-xl items-center ${opt.style === 'primary' ? 'bg-brand-primary' : 'bg-surface-background border border-surface-border'}`}
                >
                  <Text className={`font-black text-sm ${opt.style === 'primary' ? 'text-white' : opt.style === 'cancel' ? 'text-typography-muted' : 'text-typography-main'}`}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </Modal>
    )}
    </>
  );
}

// ─── Group Create Modal ───────────────────────────────────────────────────────

function GroupCreateModal({
  visible,
  onClose,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: (groupId: string) => void;
}) {
  const { createGroup } = useFileHub();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedColor, setSelectedColor] = useState(GROUP_COLORS[0]);
  const [memberSearch, setMemberSearch] = useState('');
  const [memberResults, setMemberResults] = useState<any[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<any[]>([]);
  const [creating, setCreating] = useState(false);
  const colors = useThemeColors();

  useEffect(() => {
    if (!visible) {
      setName(''); setDescription(''); setSelectedColor(GROUP_COLORS[0]);
      setMemberSearch(''); setMemberResults([]); setSelectedMembers([]);
    }
  }, [visible]);

  const searchMembers = useCallback(async (query: string) => {
    setMemberSearch(query);
    if (!query.trim()) { setMemberResults([]); return; }
    const { data } = await supabase.from('users').select('id, full_name').ilike('full_name', `%${query}%`).limit(8);
    setMemberResults(data || []);
  }, []);

  const toggleMember = (m: any) =>
    setSelectedMembers(prev => prev.find(r => r.id === m.id) ? prev.filter(r => r.id !== m.id) : [...prev, m]);

  const handleCreate = async () => {
    if (!name.trim() || creating) return;
    setCreating(true);
    try {
      const id = await createGroup(name.trim(), description.trim() || null, selectedColor, selectedMembers.map(m => m.id));
      onCreated(id);
      onClose();
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 bg-black/40 items-center justify-center p-8">
        <View className="bg-surface-card rounded-[2rem] border border-surface-border premium-shadow w-full max-w-[480px]">
          <View className="flex-row items-center justify-between px-8 pt-7 pb-5 border-b border-surface-border">
            <Text className="text-typography-main text-xl font-black">New Channel</Text>
            <TouchableOpacity onPress={onClose} className="w-8 h-8 items-center justify-center rounded-xl bg-surface-background border border-surface-border">
              <FontAwesome name="times" size={12} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 32, gap: 20 }}>
            {/* Avatar preview + color picker */}
            <View className="items-center gap-4">
              <View
                className="w-20 h-20 rounded-3xl items-center justify-center"
                style={{ backgroundColor: selectedColor + '22' }}
              >
                <Text style={{ color: selectedColor, fontSize: 28, fontWeight: '900' }}>
                  {name ? getInitials(name) : '?'}
                </Text>
              </View>
              <View className="flex-row gap-3">
                {GROUP_COLORS.map(c => (
                  <TouchableOpacity
                    key={c}
                    onPress={() => setSelectedColor(c)}
                    className="w-7 h-7 rounded-full items-center justify-center"
                    style={{ backgroundColor: c, borderWidth: selectedColor === c ? 3 : 0, borderColor: 'white', opacity: selectedColor === c ? 1 : 0.7 }}
                  />
                ))}
              </View>
            </View>

            {/* Name */}
            <View className="gap-2">
              <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">Channel Name</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="e.g. Design Team"
                placeholderTextColor={colors.textDim}
                maxLength={80}
                className="bg-surface-background border border-surface-border rounded-xl px-4 py-3 text-typography-main text-sm font-bold outline-none"
              />
            </View>

            {/* Description */}
            <View className="gap-2">
              <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">Description (optional)</Text>
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="What's this channel for?"
                placeholderTextColor={colors.textDim}
                multiline
                numberOfLines={2}
                maxLength={300}
                className="bg-surface-background border border-surface-border rounded-xl px-4 py-3 text-typography-main text-sm outline-none"
                style={{ minHeight: 70, textAlignVertical: 'top' }}
              />
            </View>

            {/* Members */}
            <View className="gap-2">
              <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">Invite Members</Text>
              {selectedMembers.length > 0 && (
                <View className="flex-row flex-wrap gap-2">
                  {selectedMembers.map(m => (
                    <TouchableOpacity
                      key={m.id}
                      onPress={() => toggleMember(m)}
                      className="flex-row items-center gap-1.5 bg-brand-primary/10 border border-brand-primary/20 rounded-full px-3 py-1"
                    >
                      <Text className="text-brand-primary text-xs font-bold">{m.full_name}</Text>
                      <FontAwesome name="times" size={9} color={colors.primary} />
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              <View className="flex-row items-center bg-surface-background border border-surface-border rounded-xl px-4 py-2.5 gap-2">
                <FontAwesome name="search" size={11} color={colors.textMuted} />
                <TextInput
                  value={memberSearch}
                  onChangeText={searchMembers}
                  placeholder="Search team members..."
                  placeholderTextColor={colors.textDim}
                  className="flex-1 text-typography-main text-sm outline-none bg-transparent"
                />
              </View>
              {memberResults.length > 0 && (
                <View className="bg-surface-background border border-surface-border rounded-xl overflow-hidden">
                  {memberResults.map((m, i) => (
                    <TouchableOpacity
                      key={m.id}
                      onPress={() => toggleMember(m)}
                      className={`flex-row items-center px-4 py-3 gap-3 ${i < memberResults.length - 1 ? 'border-b border-surface-border/50' : ''}`}
                    >
                      <Text className="flex-1 text-typography-main text-sm font-medium">{m.full_name}</Text>
                      {selectedMembers.find(r => r.id === m.id) && <FontAwesome name="check" size={11} color={colors.primary} />}
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            <View className="flex-row gap-3">
              <TouchableOpacity onPress={onClose} disabled={creating} className="flex-1 items-center justify-center py-3.5 rounded-xl border border-surface-border bg-surface-background">
                <Text className="text-typography-muted font-black text-sm">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleCreate}
                disabled={!name.trim() || creating}
                className="flex-[2] items-center justify-center py-3.5 rounded-xl bg-brand-primary"
                style={{ opacity: !name.trim() || creating ? 0.5 : 1 }}
              >
                {creating ? <ActivityIndicator size="small" color="#fff" /> : <Text className="text-white font-black text-sm">Create Channel</Text>}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ─── Folders inline in the file list (Explorer-style: current directory's
// subfolders sit above its files, both draggable on web) ──────────────────────

type DragPayload =
  | { type: 'file' | 'folder'; id: string }
  | { type: 'files'; ids: string[] }
  | { type: 'items'; fileIds: string[]; folderIds: string[] };

function FolderBreadcrumb({
  folders, selectedFolderId, onNavigate, onDropMove, onCreateFolder,
}: {
  folders: FileHubFolder[];
  selectedFolderId: string | null;
  onNavigate: (id: string | null) => void;
  onDropMove: (payload: DragPayload, targetId: string | null) => void;
  onCreateFolder: (name: string) => Promise<void>;
}) {
  const colors = useThemeColors();
  const chain = selectedFolderId ? folderAncestors(folders, selectedFolderId) : [];
  const crumbs: Array<{ id: string | null; name: string }> = [{ id: null, name: 'All Files' }, ...chain.map(f => ({ id: f.id, name: f.name }))];
  const [showInput, setShowInput] = useState(false);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    await onCreateFolder(name.trim());
    setName('');
    setShowInput(false);
    setCreating(false);
  };

  return (
    <View className="flex-row items-center justify-between gap-3 px-6 py-3 border-b border-surface-border/60 bg-surface-background/40">
      <View className="flex-row items-center flex-wrap flex-1 min-w-0">
        {crumbs.map((c, i) => (
          <React.Fragment key={c.id ?? 'root'}>
            {i > 0 && <FontAwesome name="angle-right" size={11} color={colors.textDim} style={{ marginHorizontal: 6 }} />}
            <BreadcrumbCrumb crumb={c} isLast={i === crumbs.length - 1} onNavigate={onNavigate} onDropMove={onDropMove} />
          </React.Fragment>
        ))}
      </View>
      {showInput ? (
        <View className="flex-row items-center gap-2 flex-shrink-0">
          <TextInput
            value={name}
            onChangeText={setName}
            onSubmitEditing={handleCreate}
            onBlur={() => { if (!name.trim()) setShowInput(false); }}
            placeholder="Folder name"
            placeholderTextColor={colors.textDim}
            autoFocus
            className="text-typography-main text-sm border border-brand-primary/40 bg-brand-primary/5 rounded-xl px-3 py-1.5 outline-none w-40"
          />
          <TouchableOpacity onPress={handleCreate} disabled={creating} className="px-3 py-1.5 bg-brand-primary rounded-xl">
            <Text className="text-white text-xs font-black">Add</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity
          onPress={() => setShowInput(true)}
          className="flex-row items-center gap-1.5 px-3 py-1.5 bg-surface-card border border-surface-border rounded-lg flex-shrink-0 hover:bg-surface-overlay"
        >
          <FontAwesome name="plus" size={10} color={colors.textMuted} />
          <Text className="text-typography-muted text-xs font-black">New Folder</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function BreadcrumbCrumb({
  crumb, isLast, onNavigate, onDropMove,
}: {
  crumb: { id: string | null; name: string };
  isLast: boolean;
  onNavigate: (id: string | null) => void;
  onDropMove: (payload: DragPayload, targetId: string | null) => void;
}) {
  const { ref, isOver } = useDropTarget<DragPayload>(
    (payload) => onDropMove(payload, crumb.id),
    (payload) => !(payload.type === 'folder' && payload.id === crumb.id)
  );
  return (
    <TouchableOpacity
      ref={ref}
      onPress={() => onNavigate(crumb.id)}
      className={`px-2 py-1 rounded-lg ${isOver ? 'bg-brand-primary/20 border border-brand-primary/40' : ''}`}
    >
      <Text className={`text-xs font-black ${isLast ? 'text-typography-main' : 'text-typography-muted'}`}>{crumb.name}</Text>
    </TouchableOpacity>
  );
}

function FolderRow({
  folder, onNavigate, onInfo, onDropPayload, onRename, onDelete,
  selectionMode = false, isSelected = false, onToggleSelect,
  dragFileIds, dragFolderIds,
}: {
  folder: FileHubFolder;
  onNavigate: (e?: any) => void;
  /** Opens the folder's properties in the right-hand detail panel. */
  onInfo?: () => void;
  onDropPayload: (payload: DragPayload) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  selectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
  /** When this folder is part of an active multi-selection (>1 items total),
   * the full selected file + folder ids so dragging it moves them all. */
  dragFileIds?: string[];
  dragFolderIds?: string[];
}) {
  const colors = useThemeColors();
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(folder.name);

  const totalDrag = (dragFileIds?.length ?? 0) + (dragFolderIds?.length ?? 0);
  const dragPayload: DragPayload = totalDrag > 1
    ? { type: 'items', fileIds: dragFileIds ?? [], folderIds: dragFolderIds ?? [] }
    : { type: 'folder', id: folder.id };
  const dragRef = useDragSource<DragPayload>(dragPayload, !isRenaming);
  const { ref: dropRef, isOver } = useDropTarget<DragPayload>(
    onDropPayload,
    (payload) => !((payload.type === 'folder' && payload.id === folder.id)
      || (payload.type === 'items' && payload.folderIds.includes(folder.id)))
  );
  const setRefs = useCallback((node: any) => { dragRef.current = node; dropRef.current = node; }, [dragRef, dropRef]);

  const commitRename = () => {
    setIsRenaming(false);
    if (renameValue.trim() && renameValue.trim() !== folder.name) onRename(renameValue.trim());
  };

  // The whole row is the tap target (matches FileRow) so folders and files
  // have the same hit area instead of just the folder's text label. The nested
  // checkbox / pencil / trash touchables stopPropagation so they don't also
  // trigger the row's navigate/select.
  return (
    <TouchableOpacity
      ref={setRefs}
      activeOpacity={isRenaming ? 1 : 0.7}
      onPress={(e) => {
        if (isRenaming) return;
        selectionMode ? onToggleSelect?.() : onNavigate(e);
      }}
      className={`flex-row items-center px-6 py-4 border-b border-surface-border/40 transition-colors ${
        isSelected ? 'bg-brand-primary/10' : isOver ? 'bg-brand-primary/10 border-l-2 border-l-brand-primary' : 'hover:bg-surface-overlay/60'
      }`}
    >
      {selectionMode ? (
        <TouchableOpacity
          onPress={(e) => { e?.stopPropagation?.(); onToggleSelect?.(); }}
          className={`w-9 h-9 rounded-xl items-center justify-center mr-3.5 flex-shrink-0 border-2 ${
            isSelected ? 'bg-brand-primary border-brand-primary' : 'bg-surface-background border-surface-border'
          }`}
        >
          {isSelected && <FontAwesome name="check" size={14} color="#fff" />}
        </TouchableOpacity>
      ) : (
        <View className="w-9 h-9 rounded-xl bg-surface-background border border-surface-border items-center justify-center mr-3.5 flex-shrink-0">
          <FontAwesome name="folder" size={16} color={colors.primary} />
        </View>
      )}
      {isRenaming ? (
        <TextInput
          value={renameValue}
          onChangeText={setRenameValue}
          onBlur={commitRename}
          onSubmitEditing={commitRename}
          autoFocus
          className="flex-1 text-typography-main font-bold text-sm outline-none bg-transparent mr-3"
        />
      ) : (
        <View className="flex-1 mr-3">
          <Text className="text-typography-main font-bold text-sm" numberOfLines={1}>{folder.name}</Text>
        </View>
      )}
      {!selectionMode && (
        <View className="flex-row gap-1 flex-shrink-0">
          {onInfo && (
            <TouchableOpacity onPress={(e) => { e?.stopPropagation?.(); onInfo(); }} className="w-7 h-7 items-center justify-center rounded-lg hover:bg-surface-overlay">
              <FontAwesome name="info-circle" size={12} color={colors.textMuted} />
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={(e) => { e?.stopPropagation?.(); setRenameValue(folder.name); setIsRenaming(true); }} className="w-7 h-7 items-center justify-center rounded-lg hover:bg-surface-overlay">
            <FontAwesome name="pencil" size={11} color={colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity onPress={(e) => { e?.stopPropagation?.(); onDelete(); }} className="w-7 h-7 items-center justify-center rounded-lg hover:bg-surface-overlay">
            <FontAwesome name="trash-o" size={11} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      )}
    </TouchableOpacity>
  );
}

// ─── File Row ─────────────────────────────────────────────────────────────────

function FileRow({
  file,
  selected,
  mode,
  onPress,
  selectionMode = false,
  isFileSelected = false,
  onToggleSelect,
  thumbUri,
  draggable = false,
  dragIds,
  dragFolderIds,
}: {
  file: FileHubFile;
  selected: boolean;
  mode: FileHubMode;
  onPress: (e?: any) => void;
  selectionMode?: boolean;
  isFileSelected?: boolean;
  onToggleSelect?: () => void;
  thumbUri?: string;
  draggable?: boolean;
  /** When this row is part of an active multi-selection (>1 items), the full
   * set of ids to drag together — rubber-band-select-then-drag, like Explorer. */
  dragIds?: string[];
  /** Selected folder ids to drag alongside the files (mixed selection). */
  dragFolderIds?: string[];
}) {
  const { icon, color } = getMimeIcon(file.mime_type);
  const isUnread = mode === 'inbox' && !file.recipient_state?.read_at;
  const totalDrag = (dragIds?.length ?? 0) + (dragFolderIds?.length ?? 0);
  const dragPayload: DragPayload =
    totalDrag > 1
      ? (dragFolderIds && dragFolderIds.length > 0
          ? { type: 'items', fileIds: dragIds ?? [], folderIds: dragFolderIds }
          : { type: 'files', ids: dragIds ?? [] })
      : { type: 'file', id: file.id };
  const dragRef = useDragSource<DragPayload>(dragPayload, draggable);

  const colors = useThemeColors();
  const { user } = useAuth();
  const { deleteFile, logActivity } = useFileHub();
  const { showConfirm } = useAlert();
  const isOwner = file.uploader?.id === user?.id;
  const [quickDownloading, setQuickDownloading] = useState(false);
  const [showQuickShare, setShowQuickShare] = useState(false);

  const handleQuickDownload = async (e: any) => {
    e?.stopPropagation?.();
    setQuickDownloading(true);
    try {
      logActivity(file.id, 'download');
      await openStorageFile(file.bucket || 'filehub-files', file.storage_path, file.original_name, file.mime_type);
    } finally {
      setQuickDownloading(false);
    }
  };

  const handleQuickShare = (e: any) => {
    e?.stopPropagation?.();
    setShowQuickShare(true);
  };

  const handleQuickDelete = (e: any) => {
    e?.stopPropagation?.();
    showConfirm(
      'Delete File',
      `Delete "${file.original_name}"? This cannot be undone.`,
      () => { deleteFile(file.id); },
      undefined, 'Delete', 'Cancel', 'destructive'
    );
  };

  return (
    <TouchableOpacity
      ref={dragRef}
      // @ts-ignore - web-only marquee-select hit-testing attribute
      dataSet={{ marqueeId: file.id }}
      onPress={(e) => (selectionMode ? onToggleSelect?.() : onPress(e))}
      className={`group flex-row items-center px-6 py-4 border-b border-surface-border/40 transition-colors ${
        isFileSelected
          ? 'bg-brand-primary/10'
          : selected ? 'bg-brand-primary/5 border-l-2 border-l-brand-primary' : 'hover:bg-surface-overlay/60'
      }`}
    >
      {selectionMode ? (
        <View className={`w-9 h-9 rounded-xl items-center justify-center mr-3.5 flex-shrink-0 border-2 ${
          isFileSelected ? 'bg-brand-primary border-brand-primary' : 'bg-surface-background border-surface-border'
        }`}>
          {isFileSelected && <FontAwesome name="check" size={14} color="#fff" />}
        </View>
      ) : (
        <View className="w-9 h-9 rounded-xl bg-surface-background border border-surface-border items-center justify-center mr-3.5 flex-shrink-0 overflow-hidden">
          {thumbUri ? (
            <Image source={{ uri: thumbUri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
          ) : (
            <FontAwesome name={icon as any} size={16} color={color} />
          )}
        </View>
      )}
      <View className="flex-1 min-w-0 mr-3">
        <View className="flex-row items-center gap-2 mb-0.5">
          {isUnread && <View className="w-2 h-2 rounded-full bg-brand-primary flex-shrink-0" />}
          <Text className="text-typography-main font-bold text-sm flex-1" numberOfLines={1}>{file.original_name}</Text>
          {!!file.version_count && file.version_count > 1 && (
            <View className="px-1.5 py-0.5 rounded-full bg-surface-background border border-surface-border flex-shrink-0">
              <Text className="text-typography-dim text-[9px] font-bold">v{file.version_count}</Text>
            </View>
          )}
          {file.is_stale_restore && (
            <View className="px-1.5 py-0.5 rounded-full bg-state-warning/10 border border-state-warning/30 flex-shrink-0">
              <Text className="text-state-warning text-[9px] font-black uppercase tracking-wide">Outdated</Text>
            </View>
          )}
        </View>
        <Text className="text-typography-muted text-[11px]" numberOfLines={1}>
          {file.uploader.full_name} · {formatFileSize(file.size_bytes)}
        </Text>
        {file.tags.length > 0 && (
          <View className="flex-row flex-wrap gap-1 mt-1">
            {file.tags.slice(0, 2).map(tag => {
              const c = getTagColor(tag);
              return (
                <View key={tag} style={{ backgroundColor: c.bg, borderColor: c.border, borderWidth: 1 }} className="px-1.5 py-0.5 rounded-full">
                  <Text style={{ color: c.text }} className="text-[9px] font-bold">{tag}</Text>
                </View>
              );
            })}
            {file.tags.length > 2 && (
              <View className="px-1.5 py-0.5 rounded-full bg-surface-background border border-surface-border">
                <Text className="text-[9px] font-bold text-typography-dim">+{file.tags.length - 2}</Text>
              </View>
            )}
          </View>
        )}
      </View>
      {!selectionMode && (
        <View
          className="flex-row items-center gap-0.5 mr-1.5 flex-shrink-0 opacity-0 -translate-x-1.5 scale-95 group-hover:opacity-100 group-hover:translate-x-0 group-hover:scale-100 transition-all duration-200"
        >
          <TouchableOpacity
            onPress={handleQuickDownload}
            disabled={quickDownloading}
            className="w-7 h-7 items-center justify-center rounded-lg hover:bg-brand-primary/10 hover:scale-110 active:scale-90 transition-all"
          >
            {quickDownloading
              ? <ActivityIndicator size="small" color={colors.primary} style={{ transform: [{ scale: 0.6 }] }} />
              : <FontAwesome name="download" size={12} color={colors.textMuted} />}
          </TouchableOpacity>
          {isOwner && (
            <TouchableOpacity
              onPress={handleQuickShare}
              className="w-7 h-7 items-center justify-center rounded-lg hover:bg-brand-primary/10 hover:scale-110 active:scale-90 transition-all"
            >
              <FontAwesome name="link" size={12} color={colors.textMuted} />
            </TouchableOpacity>
          )}
          {isOwner && (
            <TouchableOpacity
              onPress={handleQuickDelete}
              className="w-7 h-7 items-center justify-center rounded-lg hover:bg-state-danger/10 hover:scale-110 active:scale-90 transition-all"
            >
              <FontAwesome name="trash-o" size={12} color={colors.danger} />
            </TouchableOpacity>
          )}
        </View>
      )}
      <Text className="text-typography-dim text-[11px] flex-shrink-0">{relativeDate(file.created_at)}</Text>
      {isOwner && (
        <ShareLinkModal
          visible={showQuickShare}
          fileId={file.id}
          fileName={file.original_name}
          onClose={() => setShowQuickShare(false)}
        />
      )}
    </TouchableOpacity>
  );
}

// ─── Folder Detail Panel ──────────────────────────────────────────────────────
// Folder equivalent of DetailPanel: shows a folder's properties on the right
// (location, what it contains, quick actions) when its ⓘ button is tapped.
function FolderDetailPanel({
  folder, folders, scopeLabel, onOpen, onRename, onDelete,
}: {
  folder: FileHubFolder;
  folders: FileHubFolder[];
  scopeLabel: string;
  onOpen: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const colors = useThemeColors();
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(folder.name);
  const [displayName, setDisplayName] = useState(folder.name);
  const [showShareLink, setShowShareLink] = useState(false);
  useEffect(() => { setIsRenaming(false); setDisplayName(folder.name); }, [folder.id]);

  const subfolderCount = useMemo(
    () => folders.filter(f => f.parent_id === folder.id).length,
    [folders, folder.id]
  );
  const parent = folder.parent_id ? folders.find(f => f.id === folder.parent_id) : null;
  const location = parent ? folderPath(folders, parent.id) : 'Top level';

  const commitRename = () => {
    setIsRenaming(false);
    const v = renameValue.trim();
    if (v && v !== displayName) { setDisplayName(v); onRename(v); }
  };

  return (
    <>
    <View className="flex-1 flex-col" style={{ minHeight: 0 }}>
      <View className="px-7 pt-6 pb-4 border-b border-surface-border/50 flex-shrink-0">
        <View className="bg-surface-background rounded-2xl border border-surface-border items-center justify-center py-8 mb-4">
          <FontAwesome name="folder" size={44} color={colors.primary} />
        </View>
        {isRenaming ? (
          <TextInput
            value={renameValue}
            onChangeText={setRenameValue}
            onBlur={commitRename}
            onSubmitEditing={commitRename}
            autoFocus
            className="text-typography-main text-base font-black tracking-tight mb-0.5 outline-none bg-transparent"
          />
        ) : (
          <Text className="text-typography-main text-base font-black tracking-tight mb-0.5 leading-snug" numberOfLines={2}>{displayName}</Text>
        )}
        <Text className="text-typography-muted text-xs">Folder · {scopeLabel}</Text>
      </View>

      <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 28, paddingTop: 20 }}>
        <View className="mb-4 pb-4 border-b border-surface-border/50">
          <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest mb-1">Location</Text>
          <View className="flex-row items-center gap-2">
            <FontAwesome name="folder-open-o" size={12} color={colors.textMuted} />
            <Text className="text-typography-main text-sm font-bold flex-1">{location}</Text>
          </View>
        </View>

        <View className="mb-5 pb-4 border-b border-surface-border/50">
          <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest mb-1">Contains</Text>
          <Text className="text-typography-main text-sm font-bold">{subfolderCount} subfolder{subfolderCount === 1 ? '' : 's'}</Text>
        </View>

        <View className="gap-2.5">
          <TouchableOpacity onPress={onOpen} className="flex-row items-center justify-center bg-brand-primary rounded-xl px-4 py-3.5 gap-2">
            <FontAwesome name="folder-open" size={13} color="#fff" />
            <Text className="text-white font-black text-sm">Open Folder</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { setRenameValue(displayName); setIsRenaming(true); }} className="flex-row items-center justify-center bg-surface-card border border-surface-border rounded-xl px-4 py-3 gap-2">
            <FontAwesome name="pencil" size={13} color={colors.primary} />
            <Text className="text-brand-primary font-black text-sm">Rename</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowShareLink(true)} className="flex-row items-center justify-center bg-surface-card border border-surface-border rounded-xl px-4 py-3 gap-2">
            <FontAwesome name="link" size={13} color={colors.primary} />
            <Text className="text-brand-primary font-black text-sm">Share Link</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onDelete} className="flex-row items-center justify-center bg-surface-card border border-state-danger/30 rounded-xl px-4 py-3 gap-2">
            <FontAwesome name="trash-o" size={13} color={colors.danger} />
            <Text className="text-state-danger font-black text-sm">Delete</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
    <ShareLinkModal
      visible={showShareLink}
      folderId={folder.id}
      fileName={displayName}
      onClose={() => setShowShareLink(false)}
    />
    </>
  );
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────

function DetailPanel({
  file,
  mode,
  currentUserId,
  onClose,
  autoPreview = false,
}: {
  file: FileHubFile | null;
  mode: FileHubMode;
  currentUserId: string | undefined;
  onClose: () => void;
  /** When true (Shift+Click fast-track), jump straight to the fullscreen viewer. */
  autoPreview?: boolean;
}) {
  const { markRead, hideFile, deleteFile, logActivity, fileActivity, fileVersions, restoreVersion, pinVersion } = useFileHub();
  const { showConfirm } = useAlert();
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [tab, setTab] = useState<'details' | 'activity' | 'versions'>('details');
  const [activity, setActivity] = useState<FileActivity[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [versions, setVersions] = useState<FileVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [restoringLatest, setRestoringLatest] = useState(false);
  const [pinningId, setPinningId] = useState<string | null>(null);
  const [showShareLink, setShowShareLink] = useState(false);
    const colors = useThemeColors();

  const hasVersionHistory = !!(file?.version_count && file.version_count > 1);

  useEffect(() => { setTab('details'); setActivity([]); setVersions([]); }, [file?.id]);
  useEffect(() => { if (file) logActivity(file.id, 'view'); }, [file?.id]);
  useEffect(() => {
    if (tab !== 'activity' || !file) return;
    setActivityLoading(true);
    fileActivity(file.id).then(setActivity).catch(console.error).finally(() => setActivityLoading(false));
  }, [tab, file?.id]);

  const loadVersions = useCallback(() => {
    if (!file) return;
    setVersionsLoading(true);
    fileVersions(file.id).then(setVersions).catch(console.error).finally(() => setVersionsLoading(false));
  }, [file?.id, fileVersions]);

  useEffect(() => {
    if (tab !== 'versions' || !file) return;
    loadVersions();
  }, [tab, file?.id, loadVersions]);

  const handleVersionDownload = async (version: FileVersion) => {
    if (!file) return;
    logActivity(file.id, 'download', { version_no: version.version_no });
    await openStorageFile(version.bucket || 'filehub-files', version.storage_path, version.original_name, version.mime_type ?? file.mime_type);
  };

  // Preview a specific (older) version in the document viewer — selecting a
  // version resolves its own signed URL and re-renders the viewer canvas.
  // Images use a dedicated 'image' branch since FilePreviewModal is doc-only.
  const [versionPreview, setVersionPreview] = useState<{ uri: string; kind: PreviewKind | 'image'; name: string; versionNo: number; sizeBytes?: number } | null>(null);
  const handleVersionPreview = async (version: FileVersion) => {
    if (!file) return;
    const isImage = (version.mime_type ?? file.mime_type ?? '').toLowerCase().startsWith('image');
    const kind = getPreviewKind(version.mime_type ?? file.mime_type, version.original_name);
    if (!kind && !isImage) { handleVersionDownload(version); return; }
    const { data } = await supabase.storage
      .from(version.bucket || 'filehub-files')
      .createSignedUrl(version.storage_path, 3600);
    if (data?.signedUrl) {
      logActivity(file.id, 'view', { version_no: version.version_no });
      setVersionPreview({ uri: data.signedUrl, kind: kind ?? 'image', name: version.original_name, versionNo: version.version_no, sizeBytes: version.size_bytes });
    }
  };

  const handleRestore = (version: FileVersion) => {
    if (!file) return;
    showConfirm(
      'Restore Version',
      `Make version ${version.version_no} the current version? The current version will be kept in history.`,
      async () => {
        setRestoringId(version.id);
        try {
          await restoreVersion(version.id);
          loadVersions();
        } finally {
          setRestoringId(null);
        }
      },
      undefined, 'Restore', 'Cancel'
    );
  };

  const handleRestoreLatest = () => {
    if (!file || versions.length === 0) return;
    const latest = versions.reduce((max, v) => (v.version_no > max.version_no ? v : max), versions[0]);
    showConfirm(
      'Restore Latest Version',
      `Make version ${latest.version_no} (the most recent) the current version?`,
      async () => {
        setRestoringLatest(true);
        try {
          await restoreVersion(latest.id);
          loadVersions();
        } finally {
          setRestoringLatest(false);
        }
      },
      undefined, 'Restore', 'Cancel'
    );
  };

  const handleTogglePin = async (version: FileVersion) => {
    setPinningId(version.id);
    try {
      await pinVersion(version.id, !version.pinned);
      setVersions(prev => prev.map(v => v.id === version.id ? { ...v, pinned: !v.pinned } : v));
    } finally {
      setPinningId(null);
    }
  };

  const handleDownload = async () => {
    if (!file) return;
    setDownloadLoading(true);
    try {
      logActivity(file.id, 'download');
      await openStorageFile(file.bucket || 'filehub-files', file.storage_path, file.original_name, file.mime_type);
    } finally {
      setDownloadLoading(false);
    }
  };

  const handleDelete = () => {
    if (!file) return;
    showConfirm(
      'Delete File',
      `Delete "${file.original_name}"? This cannot be undone.`,
      () => { deleteFile(file.id).then(() => onClose()); },
      undefined, 'Delete', 'Cancel', 'destructive'
    );
  };

  const handleHide = () => {
    if (!file) return;
    Alert.alert('Hide File', 'Remove this file from your inbox?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Hide', onPress: () => { hideFile(file.id); onClose(); } },
    ]);
  };

  // Image preview → tap to open the lightbox (single image, no list navigation).
  const isImage = !!file?.mime_type?.toLowerCase().includes('image');
  const previewMedia = useMemo(
    () =>
      file && isImage
        ? [{ id: file.id, name: file.original_name, storagePath: file.storage_path, mimeType: file.mime_type, bucket: file.bucket || 'filehub-files' }]
        : [],
    [file?.id, isImage]
  );
  const { signedUrls: previewUrls, openImage: openPreview, lightbox: previewLightbox } = useImageLightbox(previewMedia, 'filehub-files');

  // Non-image previews (spreadsheet / pdf / docx / text) → resolve a signed URL
  // and offer a full-screen viewer.
  const previewKind = file ? getPreviewKind(file.mime_type, file.original_name) : null;
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  useEffect(() => {
    if (!file || !previewKind) { setPreviewUrl(null); return; }
    let cancelled = false;
    supabase.storage
      .from(file.bucket || 'filehub-files')
      .createSignedUrl(file.storage_path, 3600)
      .then(({ data }) => { if (!cancelled) setPreviewUrl(data?.signedUrl ?? null); });
    return () => { cancelled = true; };
  }, [file?.id, previewKind]);

  // Shift+Click fast-track: open the fullscreen viewer once the signed URL resolves.
  const autoPreviewedId = useRef<string | null>(null);
  useEffect(() => { if (!file) autoPreviewedId.current = null; }, [file?.id]);
  useEffect(() => {
    if (!autoPreview || !file || autoPreviewedId.current === file.id) return;
    if (isImage && previewUrls[file.id]) {
      autoPreviewedId.current = file.id;
      openPreview(file.id);
    } else if (previewKind && previewUrl) {
      autoPreviewedId.current = file.id;
      setPreviewOpen(true);
    }
  }, [autoPreview, file?.id, isImage, previewUrls, previewKind, previewUrl, openPreview]);

  if (!file) {
    return (
      <View className="flex-1 items-center justify-center px-8">
        <View className="w-16 h-16 bg-surface-background rounded-full border border-surface-border items-center justify-center mb-4">
          <FontAwesome name="file-o" size={24} color={colors.textMuted} />
        </View>
        <Text className="text-typography-muted text-sm text-center font-medium">Select a file to view details</Text>
      </View>
    );
  }

  const { icon, color } = getMimeIcon(file.mime_type);
  const isUnread = mode === 'inbox' && !file.recipient_state?.read_at;
  const isOwner = file.uploader?.id === currentUserId;


  return (
    <>
    <View className="flex-1 flex-col" style={{ minHeight: 0 }}>
      {/* File header */}
      <View className="px-7 pt-6 pb-4 border-b border-surface-border/50 flex-shrink-0">
        {isImage && previewUrls[file.id] ? (
          <TouchableOpacity
            onPress={() => openPreview(file.id)}
            activeOpacity={0.9}
            className="rounded-2xl border border-surface-border overflow-hidden mb-4 relative"
            style={[{ height: 200 }, Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : null]}
          >
            <Image source={{ uri: previewUrls[file.id] }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
            <View className="absolute bottom-2 right-2 w-7 h-7 rounded-full bg-black/55 items-center justify-center">
              <FontAwesome name="search-plus" size={12} color="#fff" />
            </View>
          </TouchableOpacity>
        ) : previewKind && previewUrl ? (
          <FilePreviewTeaser uri={previewUrl} kind={previewKind} height={200} onPress={() => setPreviewOpen(true)} sizeBytes={file.size_bytes} />
        ) : (
          <View className="bg-surface-background rounded-2xl border border-surface-border items-center justify-center py-8 mb-4">
            <FontAwesome name={icon as any} size={44} color={color} />
          </View>
        )}
        <Text className="text-typography-main text-base font-black tracking-tight mb-0.5 leading-snug" numberOfLines={2}>{file.original_name}</Text>
        <Text className="text-typography-muted text-xs">
          {formatFileSize(file.size_bytes)}{file.mime_type ? ` · ${file.mime_type.split('/').pop()?.toUpperCase()}` : ''}
        </Text>
        <View className="flex-row gap-2 mt-3">
          {([
            'details',
            'activity',
            ...(hasVersionHistory ? (['versions'] as const) : []),
          ] as const).map(t => (
            <TouchableOpacity
              key={t}
              onPress={() => setTab(t)}
              className={`px-4 py-1.5 rounded-xl border ${tab === t ? 'bg-brand-primary/10 border-brand-primary/30' : 'bg-surface-background border-surface-border'}`}
            >
              <View className="relative">
                <Text className={`text-xs font-black capitalize ${tab === t ? 'text-brand-primary' : 'text-typography-muted'}`}>{t}</Text>
                {t === 'versions' && file.is_stale_restore && (
                  <View className="absolute -top-1 -right-1.5 w-2 h-2 rounded-full bg-state-warning" />
                )}
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {tab === 'details' ? (
        <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 28, paddingTop: 20 }}>
          <View className="mb-4 pb-4 border-b border-surface-border/50">
            <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest mb-2">Sent by</Text>
            <Text className="text-typography-main text-sm font-bold">{file.uploader.full_name}</Text>
            <Text className="text-typography-dim text-xs mt-0.5">{relativeDate(file.created_at)}</Text>
          </View>

          {mode === 'sent' && file.recipients && file.recipients.length > 0 && (
            <View className="mb-4 pb-4 border-b border-surface-border/50">
              <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest mb-2">
                Recipients ({file.recipient_count ?? file.recipients.length})
              </Text>
              {file.recipients.slice(0, 5).map(r => (
                <View key={r.id} className="flex-row items-center gap-2 mb-1.5">
                  <View className="w-6 h-6 rounded-full bg-surface-background border border-surface-border items-center justify-center">
                    <FontAwesome name="user" size={9} color={colors.textMuted} />
                  </View>
                  <Text className="text-typography-main text-xs font-medium flex-1">{r.full_name}</Text>
                  {r.read_at && <FontAwesome name="check" size={9} color="var(--color-success, #38a169)" />}
                </View>
              ))}
              {(file.recipient_count ?? 0) > 5 && (
                <Text className="text-typography-muted text-xs mt-1">+{(file.recipient_count ?? 0) - 5} more</Text>
              )}
            </View>
          )}

          {mode === 'broadcast' && (
            <View className="mb-4 pb-4 border-b border-surface-border/50">
              <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest mb-1">Audience</Text>
              <Text className="text-typography-main text-sm font-bold">Entire Company</Text>
            </View>
          )}

          {file.folder && (
            <View className="mb-4 pb-4 border-b border-surface-border/50">
              <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest mb-1">Folder</Text>
              <View className="flex-row items-center gap-2">
                <FontAwesome name="folder" size={12} color={colors.textMuted} />
                <Text className="text-typography-main text-sm font-bold">{file.folder.name}</Text>
              </View>
            </View>
          )}

          {file.caption && (
            <View className="mb-4 pb-4 border-b border-surface-border/50">
              <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest mb-2">Caption</Text>
              <Text className="text-typography-main text-sm leading-relaxed">{file.caption}</Text>
            </View>
          )}

          {file.tags.length > 0 && (
            <View className="mb-5 pb-4 border-b border-surface-border/50">
              <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest mb-2">Tags</Text>
              <View className="flex-row flex-wrap gap-2">
                {file.tags.map(tag => {
                  const c = getTagColor(tag);
                  return (
                    <View key={tag} style={{ backgroundColor: c.bg, borderColor: c.border, borderWidth: 1 }} className="px-3 py-1 rounded-full">
                      <Text style={{ color: c.text }} className="text-xs font-bold">{tag}</Text>
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          <View className="gap-2.5">
            <TouchableOpacity
              onPress={handleDownload}
              disabled={downloadLoading}
              className="flex-row items-center justify-center bg-brand-primary rounded-xl px-4 py-3.5 gap-2"
            >
              {downloadLoading ? <ActivityIndicator size="small" color="#fff" /> : <FontAwesome name="download" size={13} color="#fff" />}
              <Text className="text-white font-black text-sm">Download</Text>
            </TouchableOpacity>

            {isUnread && (
              <TouchableOpacity
                onPress={() => markRead(file.id)}
                className="flex-row items-center justify-center bg-surface-card border border-surface-border rounded-xl px-4 py-3 gap-2"
              >
                <FontAwesome name="check" size={13} color={colors.primary} />
                <Text className="text-brand-primary font-black text-sm">Mark as Read</Text>
              </TouchableOpacity>
            )}

            {isOwner && (
              <TouchableOpacity
                onPress={() => setShowShareLink(true)}
                className="flex-row items-center justify-center bg-surface-card border border-surface-border rounded-xl px-4 py-3 gap-2"
              >
                <FontAwesome name="link" size={13} color={colors.primary} />
                <Text className="text-brand-primary font-black text-sm">Share Link</Text>
              </TouchableOpacity>
            )}

            <View className="flex-row gap-2">
              {mode === 'inbox' && (
                <TouchableOpacity
                  onPress={handleHide}
                  className="flex-1 flex-row items-center justify-center bg-surface-background border border-surface-border rounded-xl px-3 py-2.5 gap-1.5"
                >
                  <FontAwesome name="eye-slash" size={11} color={colors.textMuted} />
                  <Text className="text-typography-muted font-bold text-xs">Hide</Text>
                </TouchableOpacity>
              )}
              {isOwner && (
                <TouchableOpacity
                  onPress={handleDelete}
                  className="flex-1 flex-row items-center justify-center bg-state-danger/10 border border-state-danger/20 rounded-xl px-3 py-2.5 gap-1.5"
                >
                  <FontAwesome name="trash-o" size={11} color={colors.danger} />
                  <Text className="text-state-danger font-bold text-xs">Delete</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </ScrollView>
      ) : tab === 'activity' ? (
        <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 16 }}>
          {activityLoading ? (
            <View className="py-10 items-center">
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : activity.length === 0 ? (
            <View className="py-10 items-center px-8">
              <FontAwesome name="clock-o" size={24} color={colors.textDim} />
              <Text className="text-typography-muted text-sm mt-3 text-center">No activity recorded yet</Text>
            </View>
          ) : (
            activity.map((entry, i) => {
              const meta = ACTIVITY_META[entry.action] ?? { icon: 'circle', color: '#94a3b8', label: entry.action };
              return (
                <View key={entry.id} className={`flex-row items-start px-6 py-3 ${i < activity.length - 1 ? 'border-b border-surface-border/40' : ''}`}>
                  <View className="w-7 h-7 rounded-full items-center justify-center mr-3 flex-shrink-0 mt-0.5" style={{ backgroundColor: meta.color + '20' }}>
                    <FontAwesome name={meta.icon as any} size={11} color={meta.color} />
                  </View>
                  <View className="flex-1 min-w-0">
                    <Text className="text-typography-main text-xs font-bold">
                      {entry.user.full_name}{' '}
                      <Text className="text-typography-muted font-medium">{meta.label.toLowerCase()}</Text>
                    </Text>
                    <Text className="text-typography-dim text-[10px] mt-0.5">{relativeDate(entry.created_at)}</Text>
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>
      ) : (
        <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 16 }}>
          {versionsLoading ? (
            <View className="py-10 items-center">
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : versions.length === 0 ? (
            <View className="py-10 items-center px-8">
              <FontAwesome name="history" size={24} color={colors.textDim} />
              <Text className="text-typography-muted text-sm mt-3 text-center">No version history</Text>
            </View>
          ) : (
            <>
            {file.is_stale_restore && (
              <View className="flex-row items-center justify-between px-6 py-3 mb-1 bg-state-warning/10 border-b border-state-warning/20">
                <View className="flex-row items-center gap-2 flex-1 mr-2">
                  <FontAwesome name="exclamation-triangle" size={11} color={colors.warning} />
                  <Text className="text-state-warning text-xs font-bold flex-1">
                    An older version is current — a newer version exists.
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={handleRestoreLatest}
                  disabled={restoringLatest}
                  className="flex-row items-center gap-1.5 bg-state-warning/15 border border-state-warning/30 rounded-xl px-3 py-1.5"
                >
                  {restoringLatest
                    ? <ActivityIndicator size="small" color={colors.warning} />
                    : <FontAwesome name="arrow-up" size={10} color={colors.warning} />}
                  <Text className="text-state-warning font-black text-xs">Restore Latest</Text>
                </TouchableOpacity>
              </View>
            )}
            {versions.map((v, i) => {
              const days = v.is_current ? null : expiresInDays(v.expires_at);
              return (
                <View key={v.id} className={`px-6 py-3.5 ${i < versions.length - 1 ? 'border-b border-surface-border/40' : ''}`}>
                  <View className="flex-row items-center gap-2 mb-1">
                    <Text className="text-typography-main text-sm font-black">Version {v.version_no}</Text>
                    {v.is_current && (
                      <View className="px-2 py-0.5 rounded-full bg-brand-primary/10 border border-brand-primary/30">
                        <Text className="text-brand-primary text-[9px] font-black uppercase tracking-wide">Current</Text>
                      </View>
                    )}
                  </View>
                  <Text className="text-typography-muted text-[11px]" numberOfLines={1}>
                    {v.uploader.full_name} · {formatFileSize(v.size_bytes)} · {relativeDate(v.created_at)}
                  </Text>
                  {!v.is_current && (
                    <Text className="text-typography-dim text-[10px] mt-0.5">
                      {v.pinned ? 'Pinned — kept forever' : (days != null ? `Expires in ${days} day${days === 1 ? '' : 's'}` : 'Expiring soon')}
                    </Text>
                  )}
                  <View className="flex-row gap-2 mt-2">
                    {(getPreviewKind(v.mime_type ?? file.mime_type, v.original_name) || (v.mime_type ?? file.mime_type ?? '').toLowerCase().startsWith('image')) && (
                      <TouchableOpacity
                        onPress={() => handleVersionPreview(v)}
                        className="flex-row items-center justify-center bg-surface-background border border-surface-border rounded-xl px-3 py-2 gap-1.5"
                      >
                        <FontAwesome name="eye" size={11} color={colors.textMuted} />
                        <Text className="text-typography-muted font-bold text-xs">Preview</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      onPress={() => handleVersionDownload(v)}
                      className="flex-row items-center justify-center bg-surface-background border border-surface-border rounded-xl px-3 py-2 gap-1.5"
                    >
                      <FontAwesome name="download" size={11} color={colors.textMuted} />
                      <Text className="text-typography-muted font-bold text-xs">Download</Text>
                    </TouchableOpacity>
                    {!v.is_current && (
                      <TouchableOpacity
                        onPress={() => handleRestore(v)}
                        disabled={restoringId === v.id}
                        className="flex-row items-center justify-center bg-brand-primary/10 border border-brand-primary/30 rounded-xl px-3 py-2 gap-1.5"
                      >
                        {restoringId === v.id
                          ? <ActivityIndicator size="small" color={colors.primary} />
                          : <FontAwesome name="undo" size={11} color={colors.primary} />}
                        <Text className="text-brand-primary font-bold text-xs">Restore</Text>
                      </TouchableOpacity>
                    )}
                    {!v.is_current && (
                      <TouchableOpacity
                        onPress={() => handleTogglePin(v)}
                        disabled={pinningId === v.id}
                        className={`flex-row items-center justify-center rounded-xl px-3 py-2 gap-1.5 border ${
                          v.pinned ? 'bg-brand-primary/10 border-brand-primary/30' : 'bg-surface-background border-surface-border'
                        }`}
                      >
                        {pinningId === v.id
                          ? <ActivityIndicator size="small" color={colors.primary} />
                          : <FontAwesome name="thumb-tack" size={11} color={v.pinned ? colors.primary : colors.textMuted} />}
                        <Text className={`font-bold text-xs ${v.pinned ? 'text-brand-primary' : 'text-typography-muted'}`}>
                          {v.pinned ? 'Pinned' : 'Pin'}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            })}
            </>
          )}
        </ScrollView>
      )}
    </View>
    {previewLightbox}
    {previewKind && previewUrl && (
      <FilePreviewModal
        visible={previewOpen}
        uri={previewUrl}
        kind={previewKind}
        fileName={file.original_name}
        onClose={() => setPreviewOpen(false)}
        onDownload={handleDownload}
        sizeBytes={file.size_bytes}
      />
    )}
    {versionPreview && versionPreview.kind === 'image' && (
      <Modal visible transparent animationType="fade" onRequestClose={() => setVersionPreview(null)}>
        <View className="flex-1 items-center justify-center p-6" style={{ backgroundColor: 'rgba(0,0,0,0.85)' }}>
          <View className="absolute top-6 left-0 right-0 items-center">
            <Text className="text-white font-black text-sm">{`${versionPreview.name} (v${versionPreview.versionNo})`}</Text>
          </View>
          <Image source={{ uri: versionPreview.uri }} style={{ width: '90%', height: '85%' }} resizeMode="contain" />
          <TouchableOpacity onPress={() => setVersionPreview(null)} className="absolute top-5 right-6 w-11 h-11 rounded-full items-center justify-center" style={{ backgroundColor: 'rgba(255,255,255,0.15)' }}>
            <FontAwesome name="times" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      </Modal>
    )}
    {versionPreview && versionPreview.kind !== 'image' && (
      <FilePreviewModal
        visible
        uri={versionPreview.uri}
        kind={versionPreview.kind}
        fileName={`${versionPreview.name} (v${versionPreview.versionNo})`}
        onClose={() => setVersionPreview(null)}
        sizeBytes={versionPreview.sizeBytes}
      />
    )}
    <ShareLinkModal
      visible={showShareLink}
      fileId={file.id}
      fileName={file.original_name}
      onClose={() => setShowShareLink(false)}
    />
    </>
  );
}

// ─── Share Link Modal ──────────────────────────────────────────────────────────

const EXPIRY_OPTIONS: { label: string; hours: number }[] = [
  { label: '1 Day', hours: 24 },
  { label: '7 Days', hours: 168 },
  { label: '30 Days', hours: 720 },
];

// Shares a file OR a folder — pass exactly one of fileId / folderId. Both use
// the same expiring-link UI; only the create/list RPCs differ.
function ShareLinkModal({ visible, fileId, folderId, fileName, onClose }: {
  visible: boolean;
  fileId?: string;
  folderId?: string;
  fileName: string;
  onClose: () => void;
}) {
  const colors = useThemeColors();
  const { createShareLink, revokeShareLink, listShareLinks, createFolderShareLink, listFolderShareLinks } = useFileHub();
  const { showConfirm } = useAlert();
  const { successToast } = useToast();
  const [links, setLinks] = useState<FileHubShareLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [expiryHours, setExpiryHours] = useState(168);
  const isFolder = !!folderId;

  const load = useCallback(() => {
    setLoading(true);
    const p = isFolder ? listFolderShareLinks(folderId!) : listShareLinks(fileId!);
    p.then(setLinks).catch(console.error).finally(() => setLoading(false));
  }, [isFolder, fileId, folderId, listShareLinks, listFolderShareLinks]);

  useEffect(() => { if (visible) load(); else setLinks([]); }, [visible, load]);

  const activeLinks = links.filter(l => !l.revoked_at && new Date(l.expires_at).getTime() > Date.now());

  const handleCreate = async () => {
    setCreating(true);
    try {
      if (isFolder) await createFolderShareLink(folderId!, expiryHours);
      else await createShareLink(fileId!, expiryHours);
      await load();
    } catch { /* alerted in context */ } finally {
      setCreating(false);
    }
  };

  const handleCopy = async (token: string) => {
    await Clipboard.setStringAsync(shareLinkUrl(token));
    successToast('Link copied');
  };

  const handleRevoke = (link: FileHubShareLink) => {
    showConfirm(
      'Revoke Link',
      'Anyone with this link will lose access immediately.',
      async () => { try { await revokeShareLink(link.id); await load(); } catch { /* alerted */ } },
      undefined, 'Revoke', 'Cancel', 'destructive'
    );
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 bg-black/50 items-center justify-center p-6">
        <View className="bg-surface-card rounded-2xl border border-surface-border w-full max-w-md" style={{ maxHeight: '75%' }}>
          <View className="flex-row items-center justify-between px-6 py-4 border-b border-surface-border">
            <View className="flex-row items-center gap-2 flex-1 min-w-0">
              <FontAwesome name="link" size={14} color={colors.primary} />
              <Text className="text-typography-main font-black text-lg flex-1" numberOfLines={1}>Share "{fileName}"</Text>
            </View>
            <TouchableOpacity onPress={onClose} className="w-8 h-8 items-center justify-center">
              <FontAwesome name="times" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: 20 }} showsVerticalScrollIndicator={false}>
            <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-2">Expires In</Text>
            <View className="flex-row gap-2 mb-4">
              {EXPIRY_OPTIONS.map(opt => (
                <TouchableOpacity
                  key={opt.hours}
                  onPress={() => setExpiryHours(opt.hours)}
                  className={`flex-1 items-center py-2.5 rounded-xl border ${expiryHours === opt.hours ? 'bg-brand-primary/10 border-brand-primary/30' : 'bg-surface-background border-surface-border'}`}
                >
                  <Text className={`text-xs font-black ${expiryHours === opt.hours ? 'text-brand-primary' : 'text-typography-muted'}`}>{opt.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              onPress={handleCreate}
              disabled={creating}
              className="flex-row items-center justify-center bg-brand-primary rounded-xl py-3 gap-2 mb-5"
            >
              {creating ? <ActivityIndicator size="small" color="#fff" /> : <FontAwesome name="plus" size={12} color="#fff" />}
              <Text className="text-white font-black text-sm">Create Link</Text>
            </TouchableOpacity>

            <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-2">Active Links</Text>
            {loading ? (
              <View className="py-6 items-center"><ActivityIndicator color={colors.primary} /></View>
            ) : activeLinks.length === 0 ? (
              <Text className="text-typography-dim text-xs py-2">No active share links.</Text>
            ) : (
              activeLinks.map(link => (
                <View key={link.id} className="border border-surface-border rounded-xl px-4 py-3 mb-2">
                  <Text className="text-typography-main text-xs font-bold mb-1" numberOfLines={1}>{shareLinkUrl(link.token)}</Text>
                  <Text className="text-typography-dim text-[10px] mb-2">
                    Expires {new Date(link.expires_at).toLocaleDateString()} · {link.view_count} view{link.view_count === 1 ? '' : 's'}
                  </Text>
                  <View className="flex-row gap-2">
                    <TouchableOpacity
                      onPress={() => handleCopy(link.token)}
                      className="flex-1 flex-row items-center justify-center gap-1.5 bg-surface-background border border-surface-border rounded-lg py-2"
                    >
                      <FontAwesome name="copy" size={10} color={colors.primary} />
                      <Text className="text-brand-primary text-xs font-bold">Copy</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => handleRevoke(link)}
                      className="flex-1 flex-row items-center justify-center gap-1.5 bg-state-danger/10 border border-state-danger/20 rounded-lg py-2"
                    >
                      <FontAwesome name="ban" size={10} color={colors.danger} />
                      <Text className="text-state-danger text-xs font-bold">Revoke</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ─── Group Members Panel (right panel in groups mode) ─────────────────────────

function GroupMembersPanel({
  group,
  currentUserId,
  onGroupChanged,
}: {
  group: FileHubGroup;
  currentUserId: string | undefined;
  onGroupChanged: () => void;
}) {
  const { addGroupMember, removeGroupMember, fetchGroupMembers } = useFileHub();
  const [members, setMembers] = useState<FileHubGroupMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [addSearch, setAddSearch] = useState('');
  const [addResults, setAddResults] = useState<any[]>([]);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const colors = useThemeColors();
  const loadMembers = useCallback(async () => {
    setLoadingMembers(true);
    fetchGroupMembers(group.id).then(setMembers).catch(console.error).finally(() => setLoadingMembers(false));
  }, [group.id, fetchGroupMembers]);

  useEffect(() => { loadMembers(); }, [loadMembers]);

  const searchAdd = useCallback(async (query: string) => {
    setAddSearch(query);
    if (!query.trim()) { setAddResults([]); return; }
    const { data } = await supabase.from('users').select('id, full_name').ilike('full_name', `%${query}%`).limit(6);
    setAddResults((data || []).filter((u: any) => !members.find(m => m.id === u.id)));
  }, [members]);

  const handleAdd = async (userId: string) => {
    setAddingId(userId);
    try {
      await addGroupMember(group.id, userId);
      await loadMembers();
      setAddSearch(''); setAddResults([]);
      onGroupChanged();
    } catch {
    } finally {
      setAddingId(null);
    }
  };

  const handleRemove = async (userId: string) => {
    const target = members.find(m => m.id === userId);
    const isSelf = userId === currentUserId;
    Alert.alert(
      isSelf ? 'Leave Channel' : `Remove ${target?.full_name ?? 'member'}`,
      isSelf ? 'Leave this channel?' : `Remove ${target?.full_name} from the channel?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: isSelf ? 'Leave' : 'Remove',
          style: 'destructive',
          onPress: async () => {
            setRemovingId(userId);
            try {
              await removeGroupMember(group.id, userId);
              await loadMembers();
              onGroupChanged();
            } catch {
            } finally {
              setRemovingId(null);
            }
          },
        },
      ]
    );
  };

  const myRole = members.find(m => m.id === currentUserId)?.role;

  return (
    <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 24 }}>
      {/* Group header */}
      <View className="items-center mb-6">
        <View
          className="w-16 h-16 rounded-3xl items-center justify-center mb-3"
          style={{ backgroundColor: group.avatar_color + '22' }}
        >
          <Text style={{ color: group.avatar_color, fontSize: 22, fontWeight: '900' }}>{getInitials(group.name)}</Text>
        </View>
        <Text className="text-typography-main text-lg font-black text-center">{group.name}</Text>
        {group.description && (
          <Text className="text-typography-muted text-xs text-center mt-1 leading-relaxed">{group.description}</Text>
        )}
        <View className="flex-row items-center gap-4 mt-3">
          <View className="flex-row items-center gap-1.5">
            <FontAwesome name="users" size={11} color={colors.textMuted} />
            <Text className="text-typography-dim text-xs">{group.member_count} members</Text>
          </View>
          <View className="flex-row items-center gap-1.5">
            <FontAwesome name="files-o" size={11} color={colors.textMuted} />
            <Text className="text-typography-dim text-xs">{group.file_count} files</Text>
          </View>
        </View>
      </View>

      {/* Add member */}
      <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest mb-3">Add Member</Text>
      <View className="flex-row items-center bg-surface-background border border-surface-border rounded-xl px-4 py-2.5 gap-2 mb-2">
        <FontAwesome name="user-plus" size={11} color={colors.textMuted} />
        <TextInput
          value={addSearch}
          onChangeText={searchAdd}
          placeholder="Search to invite..."
          placeholderTextColor={colors.textDim}
          className="flex-1 text-typography-main text-sm outline-none bg-transparent"
        />
      </View>
      {addResults.length > 0 && (
        <View className="bg-surface-background border border-surface-border rounded-xl overflow-hidden mb-4">
          {addResults.map((m, i) => (
            <TouchableOpacity
              key={m.id}
              onPress={() => handleAdd(m.id)}
              disabled={addingId === m.id}
              className={`flex-row items-center px-4 py-3 gap-3 ${i < addResults.length - 1 ? 'border-b border-surface-border/50' : ''}`}
            >
              <Text className="flex-1 text-typography-main text-sm">{m.full_name}</Text>
              {addingId === m.id ? <ActivityIndicator size="small" color={colors.primary} /> : <FontAwesome name="plus" size={11} color={colors.primary} />}
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Members list */}
      <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest mb-3">Members ({members.length})</Text>
      {loadingMembers ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : (
        <View className="bg-surface-background border border-surface-border rounded-xl overflow-hidden">
          {members.map((m, i) => (
            <View
              key={m.id}
              className={`flex-row items-center px-4 py-3 gap-3 ${i < members.length - 1 ? 'border-b border-surface-border/50' : ''}`}
            >
              <View className="w-8 h-8 rounded-full bg-brand-primary/10 border border-brand-primary/20 items-center justify-center flex-shrink-0">
                <Text className="text-brand-primary text-[10px] font-black">{getInitials(m.full_name)}</Text>
              </View>
              <Text className="flex-1 text-typography-main text-sm font-medium">{m.full_name}</Text>
              {m.role === 'admin' && (
                <View className="bg-brand-primary/10 border border-brand-primary/20 rounded-full px-2 py-0.5 mr-1">
                  <Text className="text-brand-primary text-[9px] font-black">Admin</Text>
                </View>
              )}
              {(myRole === 'admin' || m.id === currentUserId) && (
                <TouchableOpacity
                  onPress={() => handleRemove(m.id)}
                  disabled={removingId === m.id}
                  className="w-7 h-7 items-center justify-center rounded-lg bg-state-danger/10"
                >
                  {removingId === m.id ? (
                    <ActivityIndicator size="small" color={colors.danger} />
                  ) : (
                    <FontAwesome name={m.id === currentUserId ? 'sign-out' : 'user-times'} size={11} color={colors.danger} />
                  )}
                </TouchableOpacity>
              )}
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

// ─── Tags Manage Modal ────────────────────────────────────────────────────────

function TagsManageModal({ visible, onClose, onChanged }: {
  visible: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { allTagsWithCounts, renameTag, deleteTag } = useFileHub();
  const { showConfirm } = useAlert();
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  const [loading, setLoading] = useState(false);
  const [renamingTag, setRenamingTag] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState('');
  const [savingTag, setSavingTag] = useState<string | null>(null);
  const colors = useThemeColors();

  const load = useCallback(async () => {
    setLoading(true);
    allTagsWithCounts().then(setTags).catch(console.error).finally(() => setLoading(false));
  }, [allTagsWithCounts]);

  useEffect(() => {
    if (visible) load();
    else { setTags([]); setRenamingTag(null); }
  }, [visible, load]);

  const handleRenameSave = async (oldTag: string) => {
    const trimmed = renameInput.trim();
    if (!trimmed || trimmed === oldTag) { setRenamingTag(null); return; }
    setSavingTag(oldTag);
    try {
      await renameTag(oldTag, trimmed);
      await load();
      onChanged();
    } catch { /* alerted in context */ } finally {
      setSavingTag(null);
      setRenamingTag(null);
    }
  };

  const handleDelete = (tag: string) => {
    showConfirm(
      'Delete Tag',
      `Remove tag "${tag}" from all files?`,
      async () => { try { await deleteTag(tag); await load(); onChanged(); } catch { /* alerted */ } },
      undefined, 'Delete', 'Cancel', 'destructive'
    );
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 bg-black/50 items-center justify-center p-6">
        <View className="bg-surface-card rounded-2xl border border-surface-border w-full max-w-md" style={{ maxHeight: '70%' }}>
          <View className="flex-row items-center justify-between px-6 py-4 border-b border-surface-border">
            <View className="flex-row items-center gap-2">
              <FontAwesome name="tags" size={14} color={colors.primary} />
              <Text className="text-typography-main font-black text-lg">Manage Tags</Text>
            </View>
            <TouchableOpacity onPress={onClose} className="w-8 h-8 items-center justify-center">
              <FontAwesome name="times" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View className="py-10 items-center"><ActivityIndicator color={colors.primary} /></View>
          ) : tags.length === 0 ? (
            <View className="py-10 items-center">
              <FontAwesome name="tags" size={24} color={colors.textDim} />
              <Text className="text-typography-muted text-sm mt-3">No tags yet</Text>
            </View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false}>
              {tags.map(({ tag, count }) => {
                const c = getTagColor(tag);
                const isRenaming = renamingTag === tag;
                return (
                  <View key={tag} className="flex-row items-center px-5 py-3.5 border-b border-surface-border/50">
                    <View style={{ backgroundColor: c.bg, borderColor: c.border, borderWidth: 1 }} className="px-2.5 py-1 rounded-full mr-3 flex-shrink-0">
                      <Text style={{ color: c.text }} className="text-xs font-bold">{tag}</Text>
                    </View>

                    {isRenaming ? (
                      <TextInput
                        value={renameInput}
                        onChangeText={setRenameInput}
                        autoFocus
                        className="flex-1 bg-surface-background border border-brand-primary/50 rounded-lg px-2 py-1 text-sm text-typography-main mr-2"
                        onSubmitEditing={() => handleRenameSave(tag)}
                      />
                    ) : (
                      <Text className="flex-1 text-typography-muted text-xs">{count} file{count !== 1 ? 's' : ''}</Text>
                    )}

                    {isRenaming ? (
                      <View className="flex-row gap-2">
                        <TouchableOpacity
                          onPress={() => handleRenameSave(tag)}
                          disabled={!!savingTag}
                          className="w-8 h-8 bg-brand-primary/10 border border-brand-primary/20 rounded-lg items-center justify-center"
                        >
                          {savingTag === tag ? <ActivityIndicator size="small" color={colors.primary} /> : <FontAwesome name="check" size={12} color={colors.primary} />}
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => setRenamingTag(null)}
                          className="w-8 h-8 bg-surface-background border border-surface-border rounded-lg items-center justify-center"
                        >
                          <FontAwesome name="times" size={12} color={colors.textMuted} />
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <View className="flex-row gap-2">
                        <TouchableOpacity
                          onPress={() => { setRenamingTag(tag); setRenameInput(tag); }}
                          className="w-8 h-8 bg-surface-background border border-surface-border rounded-lg items-center justify-center"
                        >
                          <FontAwesome name="pencil" size={12} color={colors.textMuted} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => handleDelete(tag)}
                          className="w-8 h-8 bg-state-danger/10 border border-state-danger/20 rounded-lg items-center justify-center"
                        >
                          <FontAwesome name="trash-o" size={12} color={colors.danger} />
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                );
              })}
              <View style={{ height: 12 }} />
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ─── Main Desktop Component ───────────────────────────────────────────────────

function FileHubDesktopInner() {
  const colors = useThemeColors();
  const { hasPermission, user, profile } = useAuth();
  const { showConfirm } = useAlert();
  const {
    mode, setMode,
    search, setSearch,
    selectedTag, setSelectedTag,
    files, folders, loading,
    selectedFolderId, setSelectedFolderId,
    createFolder, renameFolder, deleteFolder, moveFolder, moveFile,
    inboxUnreadCount,
    refresh,
    markAllRead,
    checkDuplicate,
    checkNameConflict,
    replaceFile,
    groups, groupsLoading,
    activeGroupId, setActiveGroupId,
    groupFiles, groupFilesLoading,
    refreshGroups, refreshGroupFiles,
    hideFile, deleteFile,
  } = useFileHub();

  const router = useRouter();
  const { tab: tabParam } = useLocalSearchParams<{ tab?: string }>();

  const [selectedFile, setSelectedFile] = useState<FileHubFile | null>(null);
  const [detailPanelFile, setDetailPanelFile] = useState<FileHubFile | null>(null);
  // Folder properties panel — parallel to the file detail panel, shown when a
  // folder's ⓘ button is tapped. detailPanelFolder lags selectedFolderDetail so
  // the panel stays mounted through the collapse animation.
  const [selectedFolderDetail, setSelectedFolderDetail] = useState<FileHubFolder | null>(null);
  const [detailPanelFolder, setDetailPanelFolder] = useState<FileHubFolder | null>(null);
  const [fastTrackPreview, setFastTrackPreview] = useState(false);

  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [selectedFolderIds, setSelectedFolderIds] = useState<Set<string>>(new Set());

  const toggleFileSelect = useCallback((fileId: string) => {
    setSelectedFileIds(prev => {
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId); else next.add(fileId);
      return next;
    });
  }, []);

  const toggleFolderSelect = useCallback((folderId: string) => {
    setSelectedFolderIds(prev => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId); else next.add(folderId);
      return next;
    });
  }, []);

  // Standard click → detail panel (toggles); Shift+Click (web) → fullscreen
  // viewer; Ctrl/Cmd+Click (web, Explorer-style) → add to multi-selection
  // without opening the detail panel.
  const openFile = useCallback((file: FileHubFile, e?: any) => {
    const ctrlOrCmd = !!(e?.ctrlKey || e?.metaKey || e?.nativeEvent?.ctrlKey || e?.nativeEvent?.metaKey);
    if (ctrlOrCmd) {
      setSelectionMode(true);
      toggleFileSelect(file.id);
      return;
    }
    const shift = !!(e?.shiftKey || e?.nativeEvent?.shiftKey);
    setFastTrackPreview(shift);
    setSelectedFile(prev => (prev?.id === file.id && !shift ? null : file));
  }, [toggleFileSelect]);

  // Ctrl/Cmd+Click a folder → add it to the multi-selection (Explorer-style);
  // a plain click still navigates into it.
  const openFolder = useCallback((folderId: string, e?: any) => {
    const ctrlOrCmd = !!(e?.ctrlKey || e?.metaKey || e?.nativeEvent?.ctrlKey || e?.nativeEvent?.metaKey);
    if (ctrlOrCmd) {
      setSelectionMode(true);
      toggleFolderSelect(folderId);
      return;
    }
    setSelectedFolderDetail(null); // navigating away closes any folder properties panel
    setSelectedFolderId(folderId);
  }, [toggleFolderSelect, setSelectedFolderId]);

  // ⓘ on a folder row → open its properties on the right (Explorer-style),
  // without navigating into it. Mutually exclusive with the file detail panel.
  const openFolderInfo = useCallback((folder: FileHubFolder) => {
    setSelectedFile(null);
    setSelectedFolderDetail(prev => (prev?.id === folder.id ? null : folder));
  }, []);
  const [isDetailPanelExpanded, setIsDetailPanelExpanded] = useState(false);
  const [groupPanelGroup, setGroupPanelGroup] = useState<FileHubGroup | null>(null);
  const [isGroupPanelExpanded, setIsGroupPanelExpanded] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showManageTags, setShowManageTags] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [showBin, setShowBin] = useState(false);
  const [zipDownloading, setZipDownloading] = useState(false);

  const exitSelection = useCallback(() => {
    setSelectionMode(false);
    setSelectedFileIds(new Set());
    setSelectedFolderIds(new Set());
    setSelectedFile(null);
    setSelectedFolderDetail(null);
  }, []);

  useEffect(() => { exitSelection(); }, [mode, activeGroupId]);

  // Windows-Explorer-style rubber-band select: drag over empty space in the
  // file list to multi-select, then drag any selected row to move the whole
  // selection together.
  const handleMarqueeSelectionChange = useCallback((ids: string[]) => {
    setSelectedFileIds(new Set(ids));
    setSelectionMode(ids.length > 0);
  }, []);
  const { containerRef: marqueeContainerRef, marqueeRect } = useMarqueeSelect(handleMarqueeSelectionChange);

  const detailPanelHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const groupPanelHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeGroup = useMemo(() => groups.find(g => g.id === activeGroupId) ?? null, [groups, activeGroupId]);
  // Channel files come back flat (unfiltered by folder) from rpc_filehub_group_list_files,
  // so folder scoping for channels happens client-side to match the server-side
  // p_folder_id filtering that inbox/sent/broadcast already get from fetchFiles.
  const displayFiles = mode === 'groups' && activeGroupId
    ? groupFiles.filter(f => (f.folder_id ?? null) === selectedFolderId)
    : files;

  // Reset folder navigation when entering/leaving a channel so it doesn't
  // inherit wherever Inbox/Sent/Broadcast last left off (or bleed between channels).
  useEffect(() => { setSelectedFolderId(null); }, [activeGroupId]);

  // Signed thumbnails for image rows; clicking any file opens its detail panel,
  // where the image preview itself launches the lightbox.
  const fileMedia = useMemo(
    () => displayFiles.map(f => ({
      id: f.id,
      name: f.original_name,
      storagePath: f.storage_path,
      mimeType: f.mime_type,
      bucket: f.bucket || 'filehub-files',
    })),
    [displayFiles]
  );
  const { signedUrls: fileThumbs } = useImageLightbox(fileMedia, 'filehub-files');

  const handleDownloadAll = async (name: string) => {
    if (zipDownloading || displayFiles.length === 0) return;
    setZipDownloading(true);
    try {
      await downloadFilesAsZip(displayFiles, name);
    } finally {
      setZipDownloading(false);
    }
  };

  const handleDownloadSelected = async () => {
    const filesToDownload = displayFiles.filter(f => selectedFileIds.has(f.id));
    if (filesToDownload.length === 0 || zipDownloading) return;
    setZipDownloading(true);
    try {
      await downloadFilesAsZip(filesToDownload, 'Selected Files');
      exitSelection();
    } finally {
      setZipDownloading(false);
    }
  };

  const handleDeleteSelected = () => {
    const filesToDelete = displayFiles.filter(f => selectedFileIds.has(f.id));
    const folderIdsToDelete = Array.from(selectedFolderIds);
    if (filesToDelete.length === 0 && folderIdsToDelete.length === 0) return;
    const parts: string[] = [];
    if (filesToDelete.length) parts.push(`${filesToDelete.length} file${filesToDelete.length === 1 ? '' : 's'}`);
    if (folderIdsToDelete.length) parts.push(`${folderIdsToDelete.length} folder${folderIdsToDelete.length === 1 ? '' : 's'}`);
    // Files delete permanently here; folders soft-delete to the Bin (restorable
    // 15 days) and take their contents' folder labels with them.
    showConfirm(
      'Delete Selection',
      `Delete ${parts.join(' and ')}? Folders go to the Bin; files are removed.`,
      () => {
        Promise.all([
          ...filesToDelete.map(f => (f.uploader?.id === user?.id ? deleteFile(f.id) : hideFile(f.id))),
          ...folderIdsToDelete.map(id => deleteFolder(id)),
        ]).then(() => exitSelection());
      },
      undefined, 'Delete', 'Cancel', 'destructive'
    );
  };

  const displayLoading = mode === 'groups' && activeGroupId ? groupFilesLoading : loading;

  // Folders are scoped: Direct (Inbox+Sent share one tree, since they're the
  // same underlying files viewed from two ends), Broadcast, and one
  // independent tree per channel. contextFolders narrows the full company
  // list down to whichever tree applies to the tab/channel currently open.
  const contextScope: FileHubFolderScope = mode === 'groups' ? 'group' : mode === 'broadcast' ? 'broadcast' : 'direct';
  const contextGroupId = mode === 'groups' ? activeGroupId : null;
  const contextFolders = useMemo(
    () => folders.filter(f => f.scope === contextScope && (f.group_id ?? null) === contextGroupId),
    [folders, contextScope, contextGroupId]
  );

  // Explorer-style browsing: subfolders of whichever directory is currently
  // open sit above its files.
  const subfolders = useMemo(() => {
    return contextFolders.filter(f => f.parent_id === selectedFolderId).sort((a, b) => a.name.localeCompare(b.name));
  }, [contextFolders, selectedFolderId]);

  // "Select all" spans both the visible files and the visible subfolders; it
  // clears only when everything on screen is already selected.
  const toggleSelectAll = useCallback(() => {
    const allSelected =
      selectedFileIds.size === displayFiles.length &&
      selectedFolderIds.size === subfolders.length &&
      displayFiles.length + subfolders.length > 0;
    if (allSelected) {
      setSelectedFileIds(new Set());
      setSelectedFolderIds(new Set());
    } else {
      setSelectedFileIds(new Set(displayFiles.map(f => f.id)));
      setSelectedFolderIds(new Set(subfolders.map(f => f.id)));
    }
  }, [displayFiles, subfolders, selectedFileIds, selectedFolderIds]);

  // Combined selection counts (files + folders) for the Explorer-style header.
  const totalSelected = selectedFileIds.size + selectedFolderIds.size;
  const totalVisible = displayFiles.length + subfolders.length;
  const allVisibleSelected = totalVisible > 0 && totalSelected === totalVisible;

  const handleDropOnFolder = useCallback((payload: DragPayload, targetFolderId: string | null) => {
    if (payload.type === 'file') moveFile(payload.id, targetFolderId);
    else if (payload.type === 'files') { payload.ids.forEach(id => moveFile(id, targetFolderId)); exitSelection(); }
    else if (payload.type === 'items') {
      payload.fileIds.forEach(id => moveFile(id, targetFolderId));
      payload.folderIds.forEach(id => { if (id !== targetFolderId) moveFolder(id, targetFolderId); });
      exitSelection();
    }
    else if (payload.id !== targetFolderId) moveFolder(payload.id, targetFolderId);
  }, [moveFile, moveFolder, exitSelection]);

  const handleCreateFolder = useCallback(
    (name: string) => createFolder(name, selectedFolderId, contextScope, contextGroupId),
    [createFolder, selectedFolderId, contextScope, contextGroupId]
  );

  const handleDeleteFolder = useCallback((id: string, name: string) => {
    const hasChildren = folders.some(f => f.parent_id === id);
    showConfirm(
      'Delete Folder',
      `Delete "${name}"?${hasChildren ? ' Its subfolders will be deleted too.' : ''} Files will stay but lose the folder label.`,
      () => deleteFolder(id),
      undefined, 'Delete', 'Cancel', 'destructive'
    );
  }, [folders, deleteFolder, showConfirm]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    displayFiles.forEach(f => f.tags.forEach(t => set.add(t)));
    return Array.from(set).sort();
  }, [displayFiles]);

  const canBroadcast = hasPermission('filehub:broadcast');

  // Restore tab from URL param on mount
  useEffect(() => {
    const validModes: FileHubMode[] = ['inbox', 'sent', 'broadcast', 'groups'];
    if (tabParam && validModes.includes(tabParam as FileHubMode)) {
      setMode(tabParam as FileHubMode);
    }
  }, []);

  useEffect(() => {
    if (!selectedFile) return;
    const updated = displayFiles.find(f => f.id === selectedFile.id);
    setSelectedFile(updated ?? null);
  }, [displayFiles]);

  useEffect(() => {
    if (detailPanelHideTimer.current) {
      clearTimeout(detailPanelHideTimer.current);
      detailPanelHideTimer.current = null;
    }

    if (selectedFile) {
      setDetailPanelFile(selectedFile);
      setDetailPanelFolder(null);
      setIsDetailPanelExpanded(true);
      return;
    }

    if (selectedFolderDetail) {
      setDetailPanelFolder(selectedFolderDetail);
      setDetailPanelFile(null);
      setIsDetailPanelExpanded(true);
      return;
    }

    if (detailPanelFile || detailPanelFolder) {
      setIsDetailPanelExpanded(false);
      detailPanelHideTimer.current = setTimeout(() => {
        setDetailPanelFile(null);
        setDetailPanelFolder(null);
        detailPanelHideTimer.current = null;
      }, 260);
    }

    return () => {
      if (detailPanelHideTimer.current) {
        clearTimeout(detailPanelHideTimer.current);
        detailPanelHideTimer.current = null;
      }
    };
  }, [mode, selectedFile?.id, selectedFolderDetail?.id]);

  useEffect(() => {
    if (groupPanelHideTimer.current) {
      clearTimeout(groupPanelHideTimer.current);
      groupPanelHideTimer.current = null;
    }

    if (mode !== 'groups' || !activeGroupId || !activeGroup) {
      if (groupPanelGroup) {
        setIsGroupPanelExpanded(false);
        groupPanelHideTimer.current = setTimeout(() => {
          setGroupPanelGroup(null);
          groupPanelHideTimer.current = null;
        }, 260);
      } else {
        setIsGroupPanelExpanded(false);
      }

      return () => {
        if (groupPanelHideTimer.current) {
          clearTimeout(groupPanelHideTimer.current);
          groupPanelHideTimer.current = null;
        }
      };
    }

    setGroupPanelGroup(activeGroup);
    setIsGroupPanelExpanded(true);

    return () => {
      if (groupPanelHideTimer.current) {
        clearTimeout(groupPanelHideTimer.current);
        groupPanelHideTimer.current = null;
      }
    };
  }, [mode, activeGroupId, activeGroup?.id]);

  const tabs: { key: FileHubMode; label: string; count?: number }[] = [
    { key: 'groups', label: 'Channels' },
    { key: 'inbox', label: 'Inbox', count: inboxUnreadCount > 0 ? inboxUnreadCount : undefined },
    ...(canBroadcast ? [{ key: 'broadcast' as FileHubMode, label: 'Broadcast' }] : []),
  ];

  const handleTabChange = (key: FileHubMode) => {
    setMode(key);
    setActiveGroupId(null);
    setSelectedFile(null);
    router.setParams({ tab: key });
  };

  const handleRefresh = () => {
    if (mode === 'groups') { refreshGroups(); if (activeGroupId) refreshGroupFiles(); }
    else refresh();
  };

  return (
    <View className="flex-1 bg-surface-background flex-col">
      {/* ── Header ── */}
      <View className="px-10 pt-8 pb-5 flex-row flex-wrap items-start justify-between gap-4 border-b border-surface-border flex-shrink-0">
        <View className="min-w-0">
          <Text className="text-brand-primary font-black uppercase tracking-[0.3em] text-[9px] mb-1">Intelligence Hub</Text>
          <Text className="text-typography-main text-4xl font-black tracking-tighter">File Hub</Text>
        </View>
        <View className="flex-row items-center gap-3 flex-wrap justify-end">
          <View className="flex-row items-center bg-surface-card border border-surface-border rounded-xl px-4 py-2.5 gap-3 w-full max-w-[320px] min-w-[200px]">
            <FontAwesome name="search" size={12} color={colors.textMuted} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder={mode === 'groups' && activeGroupId ? 'Search channel files...' : 'Search files...'}
              placeholderTextColor={colors.textDim}
              className="flex-1 text-typography-main text-sm font-medium outline-none bg-transparent"
            />
            {search.length > 0 && (
              <TouchableOpacity onPress={() => setSearch('')}>
                <FontAwesome name="times-circle" size={12} color={colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>
          <TouchableOpacity
            onPress={() => setShowAnalytics(true)}
            className="h-10 flex-row items-center gap-2 px-4 bg-surface-card border border-surface-border rounded-xl shrink-0"
          >
            <FontAwesome name="bar-chart" size={12} color={colors.primary} />
            <Text className="text-typography-main font-black text-sm tracking-wide">Insights</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => handleTabChange('sent')}
            className={`h-10 w-10 items-center justify-center border rounded-xl shrink-0 ${mode === 'sent' ? 'bg-brand-primary/10 border-brand-primary/30' : 'bg-surface-card border-surface-border'}`}
          >
            <FontAwesome name="paper-plane-o" size={12} color={mode === 'sent' ? colors.primary : colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setShowBin(true)}
            className="h-10 w-10 items-center justify-center bg-surface-card border border-surface-border rounded-xl shrink-0"
          >
            <FontAwesome name="trash-o" size={13} color={colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleRefresh}
            className="h-10 w-10 items-center justify-center bg-surface-card border border-surface-border rounded-xl shrink-0"
          >
            <FontAwesome name="refresh" size={13} color={colors.primary} />
          </TouchableOpacity>
          {/* Upload button — show if not on groups list (no activeGroupId in groups mode) */}
          {(mode !== 'groups' || activeGroupId) && (
            <TouchableOpacity
              onPress={() => setShowUpload(true)}
              className="flex-row items-center gap-2 bg-brand-primary px-5 py-2.5 rounded-xl shrink-0"
            >
              <FontAwesome name="upload" size={12} color="#fff" />
              <Text className="text-white font-black text-sm tracking-wide">
                {mode === 'groups' && activeGroupId ? 'Upload to Channel' : 'Upload Files'}
              </Text>
            </TouchableOpacity>
          )}
          {mode === 'groups' && !activeGroupId && (
            <TouchableOpacity
              onPress={() => setShowCreateGroup(true)}
              className="flex-row items-center gap-2 bg-brand-primary px-5 py-2.5 rounded-xl shrink-0"
            >
              <FontAwesome name="plus" size={12} color="#fff" />
              <Text className="text-white font-black text-sm tracking-wide">New Channel</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ── Tabs ── */}
      <View className="px-10 pt-4 pb-3 flex-row items-center gap-2 flex-shrink-0 border-b border-surface-border">
        {tabs.map(tab => (
          <TouchableOpacity
            key={tab.key}
            onPress={() => handleTabChange(tab.key)}
            className={`flex-row items-center gap-2 px-5 py-2 rounded-xl border transition-colors ${
              mode === tab.key
                ? 'bg-brand-primary/10 border-brand-primary/30'
                : 'bg-surface-card border-surface-border hover:bg-surface-overlay'
            }`}
          >
            <Text className={`text-sm font-black ${mode === tab.key ? 'text-brand-primary' : 'text-typography-muted'}`}>
              {tab.label}
            </Text>
            {tab.count !== undefined && (
              <View className="bg-brand-primary rounded-full px-2 py-0.5 min-w-[20px] items-center">
                <Text className="text-white text-[9px] font-black">{tab.count}</Text>
              </View>
            )}
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Two-column body ── */}
      <View className="flex-1 flex-row" style={{ minHeight: 0 }}>

        {/* ══ LEFT COLUMN ══ */}
        <View
          style={{
            width:
              mode === 'groups'
                ? activeGroupId && groupPanelGroup ? '62%' : '100%'
                : isDetailPanelExpanded ? '62%' : '100%',
          }}
          className={`flex-col transition-all duration-300 ${((mode === 'groups' && activeGroupId && groupPanelGroup) || isDetailPanelExpanded) ? 'border-r border-surface-border' : ''}`}
        >

          {/* Groups list mode */}
          {mode === 'groups' && !activeGroupId && (
            <>
              {groupsLoading ? (
                <View className="flex-1 items-center justify-center">
                  <ActivityIndicator size="large" color={colors.primary} />
                </View>
              ) : groups.length === 0 ? (
                <View className="flex-1 items-center justify-center px-8">
                  <View className="bg-surface-card p-10 rounded-[2.5rem] border border-surface-border items-center w-full max-w-sm premium-shadow">
                    <View className="w-14 h-14 bg-brand-primary/10 rounded-full border border-brand-primary/20 items-center justify-center mb-4">
                      <FontAwesome name="users" size={24} color={colors.primary} />
                    </View>
                    <Text className="text-typography-main text-xl font-black mb-2 text-center">No Channels Yet</Text>
                    <Text className="text-typography-muted text-sm text-center leading-relaxed mb-6">
                      Create a shared channel where team members can upload and access files together.
                    </Text>
                    <TouchableOpacity
                      onPress={() => setShowCreateGroup(true)}
                      className="bg-brand-primary px-6 py-3 rounded-xl flex-row items-center gap-2"
                    >
                      <FontAwesome name="plus" size={12} color="#fff" />
                      <Text className="text-white font-black text-sm">Create First Channel</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20 }}>
                  {groups.map(g => (
                    <TouchableOpacity
                      key={g.id}
                      onPress={() => { setActiveGroupId(g.id); setSelectedFile(null); }}
                      className="flex-row items-center gap-4 bg-surface-card border border-surface-border rounded-2xl px-5 py-4 mb-3 hover:bg-surface-overlay transition-colors"
                    >
                      <View
                        className="w-12 h-12 rounded-2xl items-center justify-center flex-shrink-0"
                        style={{ backgroundColor: g.avatar_color + '22' }}
                      >
                        <Text style={{ color: g.avatar_color, fontSize: 16, fontWeight: '900' }}>{getInitials(g.name)}</Text>
                      </View>
                      <View className="flex-1 min-w-0">
                        <Text className="text-typography-main font-black text-base mb-0.5" numberOfLines={1}>{g.name}</Text>
                        {g.description && (
                          <Text className="text-typography-muted text-xs mb-1" numberOfLines={1}>{g.description}</Text>
                        )}
                        <View className="flex-row items-center gap-4">
                          <View className="flex-row items-center gap-1.5">
                            <FontAwesome name="users" size={10} color={colors.textMuted} />
                            <Text className="text-typography-dim text-xs">{g.member_count} members</Text>
                          </View>
                          <View className="flex-row items-center gap-1.5">
                            <FontAwesome name="files-o" size={10} color={colors.textMuted} />
                            <Text className="text-typography-dim text-xs">{g.file_count} files</Text>
                          </View>
                        </View>
                      </View>
                      <View className="items-end gap-1">
                        {g.last_activity && <Text className="text-typography-dim text-xs">{relativeDate(g.last_activity)}</Text>}
                        <FontAwesome name="chevron-right" size={10} color={colors.textDim} />
                      </View>
                    </TouchableOpacity>
                  ))}
                  <View style={{ height: 20 }} />
                </ScrollView>
              )}
            </>
          )}

          {/* Groups — drill-down into a specific group */}
          {mode === 'groups' && activeGroupId && (
            <>
              {/* Group sub-header */}
              <View className="px-5 py-3 border-b border-surface-border flex-row items-center gap-3 flex-shrink-0">
                <TouchableOpacity
                  onPress={() => { setActiveGroupId(null); setSelectedFile(null); }}
                  className="w-8 h-8 bg-surface-background border border-surface-border rounded-lg items-center justify-center flex-shrink-0"
                >
                  <FontAwesome name="arrow-left" size={12} color={colors.textMain} />
                </TouchableOpacity>
                {activeGroup && (
                  <View
                    className="w-9 h-9 rounded-xl items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: activeGroup.avatar_color + '22' }}
                  >
                    <Text style={{ color: activeGroup.avatar_color, fontSize: 13, fontWeight: '900' }}>{getInitials(activeGroup.name)}</Text>
                  </View>
                )}
                <View className="flex-1 min-w-0">
                  <Text className="text-typography-main font-black text-sm" numberOfLines={1}>{activeGroup?.name}</Text>
                  <Text className="text-typography-dim text-[11px]">{activeGroup?.member_count} members · {activeGroup?.file_count} files</Text>
                </View>
                {displayFiles.length > 0 && (
                  <TouchableOpacity
                    onPress={() => handleDownloadAll(activeGroup?.name ?? 'Channel Files')}
                    disabled={zipDownloading}
                    className="flex-row items-center gap-1.5 px-3 py-2 bg-surface-background border border-surface-border rounded-lg flex-shrink-0"
                  >
                    {zipDownloading
                      ? <ActivityIndicator size="small" color={colors.primary} />
                      : <FontAwesome name="download" size={11} color={colors.textMuted} />
                    }
                    <Text className="text-typography-muted text-xs font-bold">ZIP</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Tag filter */}
              {allTags.length > 0 && (
                <View className="flex-row items-center border-b border-surface-border flex-shrink-0">
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={{ flex: 1 }}
                    contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 10, gap: 8, flexDirection: 'row', alignItems: 'center' }}
                  >
                    {allTags.map(tag => {
                      const c = getTagColor(tag);
                      const isSelected = selectedTag === tag;
                      return (
                        <TouchableOpacity
                          key={tag}
                          onPress={() => setSelectedTag(isSelected ? null : tag)}
                          style={isSelected ? undefined : { backgroundColor: c.bg, borderColor: c.border }}
                          className={`px-3 py-1 rounded-full border flex-shrink-0 ${isSelected ? 'bg-brand-primary/10 border-brand-primary/30' : ''}`}
                        >
                          <Text style={isSelected ? undefined : { color: c.text }} className={`text-[11px] font-bold ${isSelected ? 'text-brand-primary' : ''}`}>{tag}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                  <TouchableOpacity
                    onPress={() => setShowManageTags(true)}
                    className="px-3 py-2.5 border-l border-surface-border flex-shrink-0"
                  >
                    <FontAwesome name="tags" size={13} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>
              )}

              {/* Folder navigation — same explorer as Inbox/Sent/Broadcast, scoped to this channel's files */}
              <FolderBreadcrumb
                folders={contextFolders}
                selectedFolderId={selectedFolderId}
                onNavigate={setSelectedFolderId}
                onDropMove={handleDropOnFolder}
                onCreateFolder={handleCreateFolder}
              />

              {/* Group file list */}
              {displayLoading ? (
                <View className="flex-1 items-center justify-center"><ActivityIndicator size="large" color={colors.primary} /></View>
              ) : displayFiles.length === 0 && subfolders.length === 0 ? (
                <View className="flex-1 items-center justify-center px-8">
                  <View className="bg-surface-card p-10 rounded-[2.5rem] border border-surface-border items-center w-full max-w-sm premium-shadow">
                    <FontAwesome name="files-o" size={24} color={colors.textMuted} />
                    <Text className="text-typography-main text-xl font-black mt-4 mb-2 text-center">
                      {search ? 'No Results' : 'No Files Yet'}
                    </Text>
                    <Text className="text-typography-muted text-sm text-center leading-relaxed">
                      {search ? `No files match "${search}".` : 'Upload the first file to this channel.'}
                    </Text>
                  </View>
                </View>
              ) : (
                <View ref={marqueeContainerRef} style={{ flex: 1, position: 'relative' }}>
                <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
                  {selectionMode ? (
                    <View className="flex-row items-center px-6 py-3 bg-brand-primary/5 border-b border-brand-primary/20 gap-2">
                      <TouchableOpacity
                        onPress={toggleSelectAll}
                        className={`w-9 h-9 rounded-xl items-center justify-center border-2 mr-0 flex-shrink-0 ${
                          allVisibleSelected
                            ? 'bg-brand-primary border-brand-primary'
                            : totalSelected > 0 ? 'border-brand-primary bg-surface-background' : 'border-surface-border bg-surface-background'
                        }`}
                      >
                        {allVisibleSelected
                          ? <FontAwesome name="check" size={13} color="#fff" />
                          : totalSelected > 0 ? <View className="w-3 h-0.5 bg-brand-primary rounded-full" /> : null
                        }
                      </TouchableOpacity>
                      <Text className="flex-1 text-brand-primary text-xs font-black ml-2">
                        {totalSelected === 0 ? 'Tap to select' : `${totalSelected} of ${totalVisible} selected`}
                      </Text>
                      {selectedFileIds.size > 0 && (
                        <TouchableOpacity
                          onPress={handleDownloadSelected}
                          disabled={zipDownloading}
                          className="flex-row items-center gap-1.5 bg-brand-primary px-3 py-1.5 rounded-lg"
                        >
                          {zipDownloading ? <ActivityIndicator size="small" color="#fff" /> : <FontAwesome name="download" size={10} color="#fff" />}
                          <Text className="text-white text-xs font-black">Download {selectedFileIds.size}</Text>
                        </TouchableOpacity>
                      )}
                      {totalSelected > 0 && (
                        <TouchableOpacity
                          onPress={handleDeleteSelected}
                          className="flex-row items-center gap-1.5 bg-state-danger/10 border border-state-danger/20 px-3 py-1.5 rounded-lg"
                        >
                          <FontAwesome name="trash-o" size={10} color={colors.danger} />
                          <Text className="text-state-danger text-xs font-black">Delete {totalSelected}</Text>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity onPress={exitSelection} className="w-7 h-7 items-center justify-center ml-1">
                        <FontAwesome name="times" size={13} color={colors.textMuted} />
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <View className="flex-row items-center px-6 py-3 bg-surface-background/60 border-b border-surface-border/60">
                      <View className="w-9 mr-3.5" />
                      <Text className="flex-1 text-typography-muted text-[9px] font-black uppercase tracking-widest">File</Text>
                      <TouchableOpacity onPress={() => setSelectionMode(true)} className="w-7 h-7 items-center justify-center mr-1">
                        <FontAwesome name="check-square-o" size={11} color={colors.textMuted} />
                      </TouchableOpacity>
                      <Text className="w-16 text-right text-typography-muted text-[9px] font-black uppercase tracking-widest">Date</Text>
                    </View>
                  )}
                  {subfolders.map(f => (
                    <FolderRow
                      key={f.id}
                      folder={f}
                      onNavigate={(e) => openFolder(f.id, e)}
                      onInfo={() => openFolderInfo(f)}
                      onDropPayload={(payload) => handleDropOnFolder(payload, f.id)}
                      onRename={(name) => renameFolder(f.id, name)}
                      onDelete={() => handleDeleteFolder(f.id, f.name)}
                      selectionMode={selectionMode}
                      isSelected={selectedFolderIds.has(f.id)}
                      onToggleSelect={() => toggleFolderSelect(f.id)}
                      dragFileIds={selectedFolderIds.has(f.id) ? Array.from(selectedFileIds) : undefined}
                      dragFolderIds={selectedFolderIds.has(f.id) ? Array.from(selectedFolderIds) : undefined}
                    />
                  ))}
                  {displayFiles.map(file => (
                    <FileRow
                      key={file.id}
                      file={file}
                      selected={!selectionMode && selectedFile?.id === file.id}
                      mode="groups"
                      onPress={(e) => openFile(file, e)}
                      thumbUri={file.mime_type?.toLowerCase().includes('image') ? fileThumbs[file.id] : undefined}
                      selectionMode={selectionMode}
                      isFileSelected={selectedFileIds.has(file.id)}
                      onToggleSelect={() => toggleFileSelect(file.id)}
                      draggable={file.uploader?.id === user?.id}
                      dragIds={selectedFileIds.has(file.id) ? Array.from(selectedFileIds) : undefined}
                      dragFolderIds={selectedFileIds.has(file.id) ? Array.from(selectedFolderIds) : undefined}
                    />
                  ))}
                  <View style={{ height: 40 }} />
                </ScrollView>
                {marqueeRect && (
                  <View pointerEvents="none" style={{ position: 'absolute', left: marqueeRect.x, top: marqueeRect.y, width: marqueeRect.w, height: marqueeRect.h, backgroundColor: 'rgba(99,102,241,0.15)', borderWidth: 1, borderColor: 'rgba(99,102,241,0.6)' }} />
                )}
                </View>
              )}
            </>
          )}

          {/* Inbox / Sent / Broadcast */}
          {mode !== 'groups' && (
            <>
              <FolderBreadcrumb
                folders={contextFolders}
                selectedFolderId={selectedFolderId}
                onNavigate={setSelectedFolderId}
                onDropMove={handleDropOnFolder}
                onCreateFolder={handleCreateFolder}
              />

              {mode === 'inbox' && inboxUnreadCount > 0 && (
                <View className="px-6 pt-4 pb-3">
                  <View className="flex-row items-center justify-between gap-4 rounded-2xl border border-brand-primary/20 bg-brand-primary/5 px-5 py-4">
                    <View className="min-w-0 flex-1">
                      <Text className="text-brand-primary text-[10px] font-black uppercase tracking-[0.25em] mb-0.5">
                        Inbox
                      </Text>
                      <Text className="text-typography-main text-base font-black tracking-tight">
                        {inboxUnreadCount} unread file{inboxUnreadCount === 1 ? '' : 's'}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={markAllRead}
                      className="flex-row items-center gap-2 bg-brand-primary px-4 py-2.5 rounded-xl shrink-0"
                    >
                      <FontAwesome name="check" size={11} color="#fff" />
                      <Text className="text-white font-black text-xs tracking-wide uppercase">
                        Read All
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {allTags.length > 0 && (
                <View className="flex-row items-center border-b border-surface-border flex-shrink-0">
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={{ flex: 1 }}
                    contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 10, gap: 8, flexDirection: 'row', alignItems: 'center' }}
                  >
                    {allTags.map(tag => {
                      const c = getTagColor(tag);
                      const isSelected = selectedTag === tag;
                      return (
                        <TouchableOpacity
                          key={tag}
                          onPress={() => setSelectedTag(isSelected ? null : tag)}
                          style={isSelected ? undefined : { backgroundColor: c.bg, borderColor: c.border }}
                          className={`px-3 py-1 rounded-full border flex-shrink-0 ${isSelected ? 'bg-brand-primary/10 border-brand-primary/30' : ''}`}
                        >
                          <Text style={isSelected ? undefined : { color: c.text }} className={`text-[11px] font-bold ${isSelected ? 'text-brand-primary' : ''}`}>{tag}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                  <TouchableOpacity
                    onPress={() => setShowManageTags(true)}
                    className="px-3 py-2.5 border-l border-surface-border flex-shrink-0"
                  >
                    <FontAwesome name="tags" size={13} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>
              )}

              {displayLoading ? (
                <View className="flex-1 items-center justify-center"><ActivityIndicator size="large" color={colors.primary} /></View>
              ) : displayFiles.length === 0 && subfolders.length === 0 ? (
                <View className="flex-1 items-center justify-center px-8">
                  <View className="bg-surface-card p-10 rounded-[2.5rem] border border-surface-border items-center w-full max-w-sm premium-shadow">
                    <View className="w-14 h-14 bg-surface-background rounded-full border border-surface-border items-center justify-center mb-4">
                      <FontAwesome name="inbox" size={24} color={colors.textMuted} />
                    </View>
                    <Text className="text-typography-main text-xl font-black mb-2 text-center">
                      {search ? 'No Results' : mode === 'inbox' ? 'Inbox Empty' : mode === 'sent' ? 'Nothing Sent' : 'No Broadcasts'}
                    </Text>
                    <Text className="text-typography-muted text-sm text-center leading-relaxed">
                      {search ? `No files match "${search}".` : mode === 'inbox' ? 'Files sent directly to you will appear here.' : mode === 'sent' ? 'Files you send to others will appear here.' : 'Company-wide broadcasts will appear here.'}
                    </Text>
                  </View>
                  <View className="w-full max-w-sm">
                    <TaskFileResults pad={false} />
                  </View>
                </View>
              ) : (
                <View ref={marqueeContainerRef} style={{ flex: 1, position: 'relative' }}>
                <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
                  {selectionMode ? (
                    <View className="flex-row items-center px-6 py-3 bg-brand-primary/5 border-b border-brand-primary/20 gap-2">
                      <TouchableOpacity
                        onPress={toggleSelectAll}
                        className={`w-9 h-9 rounded-xl items-center justify-center border-2 mr-0 flex-shrink-0 ${
                          allVisibleSelected
                            ? 'bg-brand-primary border-brand-primary'
                            : totalSelected > 0 ? 'border-brand-primary bg-surface-background' : 'border-surface-border bg-surface-background'
                        }`}
                      >
                        {allVisibleSelected
                          ? <FontAwesome name="check" size={13} color="#fff" />
                          : totalSelected > 0 ? <View className="w-3 h-0.5 bg-brand-primary rounded-full" /> : null
                        }
                      </TouchableOpacity>
                      <Text className="flex-1 text-brand-primary text-xs font-black ml-2">
                        {totalSelected === 0 ? 'Tap to select' : `${totalSelected} of ${totalVisible} selected`}
                      </Text>
                      {selectedFileIds.size > 0 && (
                        <TouchableOpacity
                          onPress={handleDownloadSelected}
                          disabled={zipDownloading}
                          className="flex-row items-center gap-1.5 bg-brand-primary px-3 py-1.5 rounded-lg"
                        >
                          {zipDownloading ? <ActivityIndicator size="small" color="#fff" /> : <FontAwesome name="download" size={10} color="#fff" />}
                          <Text className="text-white text-xs font-black">Download {selectedFileIds.size}</Text>
                        </TouchableOpacity>
                      )}
                      {totalSelected > 0 && (
                        <TouchableOpacity
                          onPress={handleDeleteSelected}
                          className="flex-row items-center gap-1.5 bg-state-danger/10 border border-state-danger/20 px-3 py-1.5 rounded-lg"
                        >
                          <FontAwesome name="trash-o" size={10} color={colors.danger} />
                          <Text className="text-state-danger text-xs font-black">Delete {totalSelected}</Text>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity onPress={exitSelection} className="w-7 h-7 items-center justify-center ml-1">
                        <FontAwesome name="times" size={13} color={colors.textMuted} />
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <View className="flex-row items-center px-6 py-3 bg-surface-background/60 border-b border-surface-border/60">
                      <View className="w-9 mr-3.5" />
                      <Text className="flex-1 text-typography-muted text-[9px] font-black uppercase tracking-widest">Name</Text>
                      {displayFiles.length > 0 && (
                        <TouchableOpacity
                          onPress={() => handleDownloadAll(selectedFolderId ? folders.find(f => f.id === selectedFolderId)?.name ?? 'Files' : mode === 'inbox' ? 'Inbox Files' : mode === 'sent' ? 'Sent Files' : 'Files')}
                          disabled={zipDownloading}
                          className="w-7 h-7 items-center justify-center mr-1"
                        >
                          {zipDownloading
                            ? <ActivityIndicator size="small" color={colors.primary} style={{ transform: [{ scale: 0.6 }] }} />
                            : <FontAwesome name="download" size={11} color={colors.textMuted} />
                          }
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity onPress={() => setSelectionMode(true)} className="w-7 h-7 items-center justify-center mr-1">
                        <FontAwesome name="check-square-o" size={11} color={colors.textMuted} />
                      </TouchableOpacity>
                      <Text className="w-16 text-right text-typography-muted text-[9px] font-black uppercase tracking-widest">Date</Text>
                    </View>
                  )}
                  {subfolders.map(f => (
                    <FolderRow
                      key={f.id}
                      folder={f}
                      onNavigate={(e) => openFolder(f.id, e)}
                      onInfo={() => openFolderInfo(f)}
                      onDropPayload={(payload) => handleDropOnFolder(payload, f.id)}
                      onRename={(name) => renameFolder(f.id, name)}
                      onDelete={() => handleDeleteFolder(f.id, f.name)}
                      selectionMode={selectionMode}
                      isSelected={selectedFolderIds.has(f.id)}
                      onToggleSelect={() => toggleFolderSelect(f.id)}
                      dragFileIds={selectedFolderIds.has(f.id) ? Array.from(selectedFileIds) : undefined}
                      dragFolderIds={selectedFolderIds.has(f.id) ? Array.from(selectedFolderIds) : undefined}
                    />
                  ))}
                  {displayFiles.map(file => (
                    <FileRow
                      key={file.id}
                      file={file}
                      selected={!selectionMode && selectedFile?.id === file.id}
                      mode={mode}
                      onPress={(e) => openFile(file, e)}
                      thumbUri={file.mime_type?.toLowerCase().includes('image') ? fileThumbs[file.id] : undefined}
                      selectionMode={selectionMode}
                      isFileSelected={selectedFileIds.has(file.id)}
                      onToggleSelect={() => toggleFileSelect(file.id)}
                      draggable={file.uploader?.id === user?.id}
                      dragIds={selectedFileIds.has(file.id) ? Array.from(selectedFileIds) : undefined}
                      dragFolderIds={selectedFileIds.has(file.id) ? Array.from(selectedFolderIds) : undefined}
                    />
                  ))}
                  <TaskFileResults />
                  <View style={{ height: 40 }} />
                </ScrollView>
                {marqueeRect && (
                  <View pointerEvents="none" style={{ position: 'absolute', left: marqueeRect.x, top: marqueeRect.y, width: marqueeRect.w, height: marqueeRect.h, backgroundColor: 'rgba(99,102,241,0.15)', borderWidth: 1, borderColor: 'rgba(99,102,241,0.6)' }} />
                )}
                </View>
              )}
            </>
          )}
        </View>

        {/* ══ RIGHT COLUMN ══ */}
        <View
          style={{
            width:
              mode === 'groups'
                ? activeGroupId && groupPanelGroup ? '38%' : '0%'
                : isDetailPanelExpanded ? '38%' : '0%',
            opacity:
              mode === 'groups'
                ? activeGroupId && groupPanelGroup ? 1 : 0
                : isDetailPanelExpanded ? 1 : 0,
          }}
          pointerEvents={mode === 'groups' ? (activeGroupId && groupPanelGroup ? 'auto' : 'none') : isDetailPanelExpanded ? 'auto' : 'none'}
          className={`flex-col overflow-hidden transition-all duration-300 ${((mode === 'groups' && activeGroupId && groupPanelGroup) || isDetailPanelExpanded) ? 'border-l border-surface-border' : ''}`}
        >
          {/* Groups drill-down → members panel OR file/folder detail */}
          {mode === 'groups' && activeGroupId && groupPanelGroup && !selectedFile && !selectedFolderDetail && (
            <View
              className="flex-1 overflow-hidden transition-all duration-300"
              style={{
                opacity: isGroupPanelExpanded ? 1 : 0,
                transform: [{ translateX: isGroupPanelExpanded ? 0 : 24 }],
              }}
            >
              <GroupMembersPanel group={groupPanelGroup} currentUserId={user?.id} onGroupChanged={refreshGroups} />
            </View>
          )}

          {mode === 'groups' && activeGroupId && detailPanelFile && (
            <View
              className="flex-1 overflow-hidden transition-all duration-300"
              style={{
                opacity: isDetailPanelExpanded ? 1 : 0,
                transform: [{ translateX: isDetailPanelExpanded ? 0 : 24 }],
              }}
            >
              <DetailPanel file={detailPanelFile} mode="groups" currentUserId={user?.id} autoPreview={fastTrackPreview} onClose={() => { setSelectedFile(null); setFastTrackPreview(false); }} />
            </View>
          )}

          {mode === 'groups' && activeGroupId && detailPanelFolder && !detailPanelFile && (
            <View
              className="flex-1 overflow-hidden transition-all duration-300"
              style={{
                opacity: isDetailPanelExpanded ? 1 : 0,
                transform: [{ translateX: isDetailPanelExpanded ? 0 : 24 }],
              }}
            >
              <FolderDetailPanel
                folder={detailPanelFolder}
                folders={contextFolders}
                scopeLabel={activeGroup?.name ?? 'Channel'}
                onOpen={() => openFolder(detailPanelFolder.id)}
                onRename={(name) => renameFolder(detailPanelFolder.id, name)}
                onDelete={() => { handleDeleteFolder(detailPanelFolder.id, detailPanelFolder.name); setSelectedFolderDetail(null); }}
              />
            </View>
          )}

          {/* Inbox / Sent / Broadcast → file detail */}
          {mode !== 'groups' && detailPanelFile && (
            <View
              className="flex-1 overflow-hidden transition-all duration-300"
              style={{
                opacity: isDetailPanelExpanded ? 1 : 0,
                transform: [{ translateX: isDetailPanelExpanded ? 0 : 24 }],
              }}
            >
              <DetailPanel
                file={detailPanelFile}
                mode={mode}
                currentUserId={user?.id}
                autoPreview={fastTrackPreview}
                onClose={() => { setSelectedFile(null); setFastTrackPreview(false); }}
              />
            </View>
          )}

          {/* Inbox / Sent / Broadcast → folder properties */}
          {mode !== 'groups' && detailPanelFolder && !detailPanelFile && (
            <View
              className="flex-1 overflow-hidden transition-all duration-300"
              style={{
                opacity: isDetailPanelExpanded ? 1 : 0,
                transform: [{ translateX: isDetailPanelExpanded ? 0 : 24 }],
              }}
            >
              <FolderDetailPanel
                folder={detailPanelFolder}
                folders={contextFolders}
                scopeLabel={mode === 'broadcast' ? 'Broadcast' : 'Direct'}
                onOpen={() => openFolder(detailPanelFolder.id)}
                onRename={(name) => renameFolder(detailPanelFolder.id, name)}
                onDelete={() => { handleDeleteFolder(detailPanelFolder.id, detailPanelFolder.name); setSelectedFolderDetail(null); }}
              />
            </View>
          )}
        </View>
      </View>

      {/* ── Upload Modal ── */}
      <UploadModal
        visible={showUpload}
        folders={folders}
        onClose={() => setShowUpload(false)}
        onUploaded={() => { mode === 'groups' && activeGroupId ? refreshGroupFiles() : refresh(); }}
        checkDuplicate={checkDuplicate}
        checkNameConflict={checkNameConflict}
        replaceFile={replaceFile}
        hasPermission={hasPermission}
        profile={profile}
        activeGroup={activeGroup ? { id: activeGroup.id, name: activeGroup.name, avatar_color: activeGroup.avatar_color } : null}
      />

      {/* ── Group Create Modal ── */}
      <GroupCreateModal
        visible={showCreateGroup}
        onClose={() => setShowCreateGroup(false)}
        onCreated={(id) => { refreshGroups(); setActiveGroupId(id); }}
      />

      {/* ── Tags Manage Modal ── */}
      <TagsManageModal
        visible={showManageTags}
        onClose={() => setShowManageTags(false)}
        onChanged={handleRefresh}
      />

      {/* ── Analytics Dashboard ── */}
      <FileHubAnalytics visible={showAnalytics} onClose={() => setShowAnalytics(false)} />
      <FileHubBin visible={showBin} onClose={() => setShowBin(false)} />
    </View>
  );
}

export default function FileHubDesktop() {
  const colors = useThemeColors();
  return (
    <FileHubProvider>
      <FileHubDesktopInner />
    </FileHubProvider>
  );
}