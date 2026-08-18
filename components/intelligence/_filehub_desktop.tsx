import { useAlert } from '@/contexts/AlertContext';
import { useAuth } from '@/contexts/AuthContext';
import { FileActivity, FileHubFile, FileHubFolder, FileHubFolderScope, FileHubGroup, FileHubGroupMember, FileHubMode, FileHubProvider, FileHubShareLink, FileVersion, FolderVersion, folderAncestors, folderDescendantIds, folderPath, shareLinkUrl, useFileHub } from '@/contexts/FileHubContext';
import { useToast } from '@/contexts/ToastContext';
import { useUploadJob, useUploadManager, type UploadJobState } from '@/contexts/UploadManagerContext';
import * as Clipboard from 'expo-clipboard';
import { useDoubleTap } from '@/hooks/useDoubleTap';
import { useFileSizeLimit } from '@/hooks/useFileSizeLimit';
import { useImageLightbox } from '@/hooks/useImageLightbox';
import { useThemeColors } from '@/hooks/useThemeColors';
import { useDragSource, useDropPulse, useDropTarget, useFileDrop, useMarqueeSelect } from '@/hooks/useWebDnd';
import { FilePreviewModal, FilePreviewTeaser, getPreviewKind, type PreviewKind } from './../common/FilePreview';
import Popup from '../common/Popup';
import Tooltip from '../common/Tooltip';
import UserLink from '../common/UserLink';
import FileHubAnalytics from './FileHubAnalytics';
import FileHubBin from './FileHubBin';
import FileHubOverview from './FileHubOverview';
import FileHubBrowse from './FileHubBrowse';
import FileHubChannelsMultiView from './FileHubChannelsMultiView';
import { groupPickedFiles, relDir, resolveExistingFolderLeaf } from '@/lib/filehubFolderTree';
import FolderTreePicker from './FolderTreePicker';
import { ACTIVITY_META, ALLOWED_EXTENSIONS, ALLOWED_TYPES_MESSAGE, expiresInDays, formatFileSize, getInitials, getTagColor, GROUP_COLORS, isAllowedFile, TAG_PALETTE } from './filehubShared';
import { randomId } from '@/lib/randomId';
import { noticeReducedMotion } from '@/lib/reducedMotionNotice';
import { downloadFilesAsZip, openStorageFile } from '@/lib/storage';
import { isMultiSelectModifierActive } from '@/lib/webModifierKeys';
import { useShareFile } from '../common/ShareFile';
import TaskFileResults from './TaskFileResults';
import { supabase } from '@/lib/supabase';
import { FontAwesome } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Modal,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

// ─── Helpers ─────────────────────────────────────────────────────────────────
// Shared byte-identical helpers (formatFileSize, expiresInDays, getInitials,
// GROUP_COLORS, TAG_PALETTE, getTagColor, ACTIVITY_META) now live in
// `./filehubShared`. The helpers below intentionally remain local because their
// implementations differ from the adaptive shell's.

function relativeDate(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / (86400 * 7))}w ago`;
  return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
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
                <FontAwesome name="folder-o" size={exactSquareSize > 100 ? 36 : 28} color="#f59e0b" />
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

// ─── Upload → island goo morph (web) ─────────────────────────────────────────
// Minimising an in-flight upload used to just cut the card away. Instead the
// card's footprint flies up and *fuses* with the topbar island through an SVG
// metaball filter — a heavy blur followed by an alpha threshold, which snaps
// the two blurred shapes back into one hard-edged liquid blob wherever they
// overlap. The eye then tracks a single continuous object from "uploading
// here" to "docked up there" instead of two elements cutting past each other.
//
// What is deliberately NOT filtered: the card itself. Running a goo filter
// over a live subtree is the expensive way to do this — it re-rasterises real
// text and progress rings every frame. Three solid divs sized from the
// measured rects give the same read for almost nothing, and the filter is
// mounted only for the length of the transition, never persistently.

type MorphRect = { top: number; left: number; width: number; height: number };

const MORPH_MS = 480;
const MODAL_EXIT_MS = 260; // Popup's Modal fades itself out over 250ms after visible flips
const GOO_FILTER_ID = 'filehub-upload-goo';
const GOO_BLUR = 8;   // stdDeviation — wide enough to bridge the blobs, tight enough to stay smooth
const GOO_PAD = 30;   // slack around the travel box so the blur isn't clipped at its edges
const GOO_EASE = 'cubic-bezier(0.62, 0, 0.2, 1)';

const domRect = (el: HTMLElement): MorphRect => {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
};

function UploadGooMorph({ from, to, label, cardColor, accent }: {
  from: MorphRect;
  to: MorphRect;
  label: string;
  cardColor: string;
  accent: string;
}) {
  const [settled, setSettled] = useState(false);

  // Two frames: the first paints the "from" geometry, the second flips to
  // "to" — a single frame isn't guaranteed to have painted yet, and a
  // transition with nothing to transition from just snaps.
  useEffect(() => {
    let inner = 0;
    const outer = requestAnimationFrame(() => { inner = requestAnimationFrame(() => setSettled(true)); });
    return () => { cancelAnimationFrame(outer); if (inner) cancelAnimationFrame(inner); };
  }, []);

  // Filter region = just the box the blobs travel through, not the viewport.
  const minX = Math.min(from.left, to.left) - GOO_PAD;
  const minY = Math.min(from.top, to.top) - GOO_PAD;
  const boxW = Math.max(from.left + from.width, to.left + to.width) + GOO_PAD - minX;
  const boxH = Math.max(from.top + from.height, to.top + to.height) + GOO_PAD - minY;

  const blobTransition = ['left', 'top', 'width', 'height', 'border-radius']
    .map(p => `${p} ${MORPH_MS}ms ${GOO_EASE}`).join(', ');

  // The card's own footprint, collapsing onto the island's measured rect.
  const panel = settled
    ? { left: to.left - minX, top: to.top - minY, width: to.width, height: to.height, borderRadius: 999 }
    : { left: from.left - minX, top: from.top - minY, width: from.width, height: from.height, borderRadius: 32 };

  // A droplet runs the same path slightly ahead of the panel, so something is
  // always bridging the two ends while the gap is at its widest — that bridge
  // is what makes the merge read as liquid rather than as a shrink.
  const dropSize = Math.max(18, Math.min(34, to.height * 1.2));
  const dropX = (settled ? to.left + to.width / 2 : from.left + from.width / 2) - minX - dropSize / 2;
  const dropY = (settled ? to.top + to.height / 2 : from.top + from.height / 2) - minY - dropSize / 2;

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 200, pointerEvents: 'none' }}>
      {/* The modal's dim, taken over for the transition so it can fade rather
          than cut — the blob has to land on a page that's already back. */}
      <div
        style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.7)',
          opacity: settled ? 0 : 1,
          transition: `opacity ${MORPH_MS - 120}ms ease`,
        }}
      />

      {/* Filter def lives and dies with this component. */}
      <svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden="true">
        <defs>
          <filter id={GOO_FILTER_ID} x="-25%" y="-25%" width="150%" height="150%" colorInterpolationFilters="sRGB">
            <feGaussianBlur in="SourceGraphic" stdDeviation={GOO_BLUR} result="blurred" />
            <feColorMatrix
              in="blurred"
              type="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -11"
            />
          </filter>
        </defs>
      </svg>

      <div
        style={{
          position: 'absolute', left: minX, top: minY, width: boxW, height: boxH,
          // Glow chained after the goo filter, not before: a drop-shadow inside
          // the alpha-threshold blur+colormatrix would get clamped away the same
          // way any soft/low-alpha detail does — chaining it after lets it glow
          // around the already-merged silhouette instead.
          filter: `url(#${GOO_FILTER_ID}) drop-shadow(0 0 8px ${accent}) drop-shadow(0 0 20px ${accent})`,
        }}
      >
        <div style={{ position: 'absolute', background: cardColor, willChange: 'left, top, width, height', transition: blobTransition, ...panel }} />
        <div
          style={{
            position: 'absolute', width: dropSize, height: dropSize, borderRadius: 999, background: cardColor,
            left: dropX, top: dropY, willChange: 'left, top',
            transition: `left ${MORPH_MS - 90}ms ${GOO_EASE}, top ${MORPH_MS - 90}ms ${GOO_EASE}`,
          }}
        />
        {/* The island end, swelling up to meet the incoming blob. */}
        <div
          style={{
            position: 'absolute', width: to.width, height: to.height, borderRadius: 999, background: cardColor,
            left: to.left - minX, top: to.top - minY, willChange: 'transform',
            transform: settled ? 'scale(1)' : 'scale(0)',
            transition: `transform ${MORPH_MS - 150}ms cubic-bezier(0.34, 1.3, 0.64, 1) 150ms`,
          }}
        />
      </div>

      {/* Progress read rides on top, outside the filter — the threshold would
          eat the glyphs, and it carries the card's identity into the flight. */}
      <div
        style={{
          position: 'absolute',
          left: settled ? to.left + to.width / 2 : from.left + from.width / 2,
          top: settled ? to.top + to.height / 2 : from.top + from.height / 2,
          transform: `translate(-50%, -50%) scale(${settled ? 0.42 : 1})`,
          opacity: settled ? 0 : 1,
          color: accent, fontSize: 28, fontWeight: 900, fontVariantNumeric: 'tabular-nums',
          transition: `left ${MORPH_MS}ms ${GOO_EASE}, top ${MORPH_MS}ms ${GOO_EASE}, transform ${MORPH_MS}ms ${GOO_EASE}, opacity ${Math.round(MORPH_MS * 0.55)}ms ease`,
        }}
      >
        {label}
      </div>
    </div>
  );
}

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
  defaultFolderId = null,
  initialFiles = null,
}: {
  visible: boolean;
  folders: FileHubFolder[];
  onClose: () => void;
  onUploaded: () => void;
  defaultFolderId?: string | null;
  initialFiles?: File[] | null;
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
  const { startUpload, cancelUpload } = useUploadManager();
  const { showAlert } = useAlert();
  const fileInputRef = useRef<any>(null);
  const folderInputRef = useRef<any>(null);
  const [draft, setDraft] = useState<UploadDraft>(EMPTY_DRAFT(activeGroup ? 'group' : 'direct'));
  const maxFileSizeBytes = useFileSizeLimit();
  const [recipientSearch, setRecipientSearch] = useState('');
  const [memberResults, setMemberResults] = useState<any[]>([]);
  const [searchingMembers, setSearchingMembers] = useState(false);
  const [tagSuggestResults, setTagSuggestResults] = useState<string[]>([]);

  // Once Upload is clicked the job runs in the background manager, but the modal
  // stays open showing its live progress. Closing/minimizing morphs the card up
  // into the topbar island (where the same job keeps tracking) rather than just
  // vanishing — so the user sees where the upload "went".
  const [launchedJobId, setLaunchedJobId] = useState<string | null>(null);
  const job = useUploadJob(launchedJobId);
  const uploading = launchedJobId !== null;
  const { height: winHeight } = useWindowDimensions();
  const reducedMotion = useReducedMotion();

  // The upload job runs in the background UploadManager/IslandContext regardless
  // of whether this modal is open — closing it (even instantly, no transition)
  // doesn't stop the job or hide its progress in the topbar island. The morph
  // below is therefore purely a visual hand-off: it only exists so the user can
  // see WHERE the upload went, and any path that skips it is still correct.
  // `morph` mounts the goo layer (and its filter) for exactly the flight; the
  // separate `handingOff` flag outlives it, because the Modal keeps painting
  // its backdrop through a 250ms exit fade and letting the dim snap back for
  // that fade would flash black over the landing.
  const [morph, setMorph] = useState<{ from: MorphRect; to: MorphRect; label: string } | null>(null);
  const [handingOff, setHandingOff] = useState(false);
  const morphTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const morphCardRef = useRef<any>(null);
  const clearMorphTimers = useCallback(() => {
    morphTimers.current.forEach(clearTimeout);
    morphTimers.current = [];
  }, []);
  useEffect(() => clearMorphTimers, [clearMorphTimers]);

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
      setRecipientSearch('');
      setMemberResults([]);
      setLaunchedJobId(null);
    } else {
      // Smart leveling: open with the folder the user is currently viewing
      // preselected, so uploads land where they're looking instead of at root.
      setDraft(prev => ({ ...prev, visibility: activeGroup ? 'group' : prev.visibility, folderId: defaultFolderId ?? null }));
      // Reopening inside the tail of a hand-off cancels what's left of it, so
      // the card can't come back invisible.
      clearMorphTimers();
      setMorph(null);
      setHandingOff(false);
    }
  }, [visible, activeGroup?.id, defaultFolderId, clearMorphTimers]);

  // Seed the composer from an OS-file drop (parent hands over the dropped files
  // when it opens the modal). Same allow-list filter as the manual picker.
  useEffect(() => {
    if (visible && initialFiles && initialFiles.length) {
      const valid = processWebFiles(initialFiles as any);
      if (valid.length) setDraft(prev => ({ ...prev, files: [...prev.files, ...valid] }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initialFiles]);

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
      showAlert(
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

  // The screen-level useFileDrop (in the FileHub browser) only fires before this
  // modal is open — it seeds initialFiles and opens the composer. Once open, the
  // modal sits in front of that drop zone, so dropping more files onto it needs
  // its own listener; otherwise the OS drop target dies the moment the modal appears.
  const { ref: modalDropRef, isOver: modalDropOver } = useFileDrop(
    (files) => {
      const valid = processWebFiles(files as any);
      if (valid.length) setDraft(prev => ({ ...prev, files: [...prev.files, ...valid] }));
    },
    visible && !uploading,
  );

  const { iconScale: dropIconScale, glowOpacity: dropGlowOpacity } = useDropPulse(modalDropOver);

  // One node, two consumers: the OS-file drop listener and the morph's "where is
  // the card right now" measurement.
  const setCardRef = useCallback((node: any) => {
    morphCardRef.current = node;
    modalDropRef(node);
  }, [modalDropRef]);

  // Measure both ends in the click's own frame, then hand off to the goo layer.
  // getBoundingClientRect is synchronous — RN's measure() isn't, even on RNW,
  // and a frame of lag here shows up as a visible snap. The island's rect is
  // read live rather than hardcoded: it floats and slides with the top bar, so
  // there is no fixed coordinate to aim at.
  const morphToIsland = useCallback(() => {
    if (handingOff) return;
    const cardEl = morphCardRef.current as HTMLElement | null;
    const islandEl = typeof document !== 'undefined'
      ? (document.querySelector('[data-island-anchor]') as HTMLElement | null)
      : null;
    const from = cardEl?.getBoundingClientRect ? domRect(cardEl) : null;
    const to = islandEl?.getBoundingClientRect ? domRect(islandEl) : null;
    // Island not mounted, card already gone, anything unmeasurable — just close.
    if (!from || !to || !from.width || !to.width) { onClose(); return; }
    setHandingOff(true);
    setMorph({ from, to, label: `${Math.round(job?.progress ?? 0)}%` });
    morphTimers.current.push(
      setTimeout(() => { setMorph(null); onClose(); }, MORPH_MS),
      setTimeout(() => setHandingOff(false), MORPH_MS + MODAL_EXIT_MS),
    );
  }, [handingOff, onClose, job?.progress]);

  // Web with motion allowed gets the merge; native and reduced-motion get the
  // plain close they have today.
  const handleDismiss = useCallback(() => {
    if (uploading && Platform.OS === 'web' && !reducedMotion) morphToIsland();
    else {
      if (uploading && reducedMotion) noticeReducedMotion();
      onClose();
    }
  }, [uploading, reducedMotion, morphToIsland, onClose]);

  // The upload engine (worker pool, dup/conflict handling, per-file commit,
  // progress, ETA, cancel) lives in UploadManagerContext so the job survives
  // this modal closing. We hand off the draft and switch the modal to its live
  // progress view — the user can watch it here, or minimize it into the topbar
  // island (where the same job keeps tracking) and get on with their work. The
  // parent FileHub screen refreshes its listing on completion via
  // useUploadManager().lastCompletedAt.
  const handleUpload = () => {
    if (draft.files.length === 0) return;
    const companyId = profile?.company_id;
    if (!companyId) { showAlert('Error', 'Company not found.'); return; }
    if (draft.visibility === 'group' && !activeGroup?.id) {
      showAlert('Error', 'No channel selected.'); return;
    }

    const jobId = startUpload({
      files: draft.files,
      companyId,
      visibility: draft.visibility,
      folderId: draft.folderId,
      recipientIds: draft.recipientIds,
      groupId: draft.visibility === 'group' ? (activeGroup?.id ?? null) : null,
      tags: draft.tags,
      caption: draft.caption || null,
      maxFileSizeBytes: maxFileSizeBytes ?? null,
      // Snapshot the current scope's folders for the pre-upload dup/conflict
      // checks; the real sub-tree is get-or-created server-side at commit.
      scopedFolders,
      label: draft.visibility === 'group' ? (activeGroup?.name ?? 'Channel') : (draft.visibility === 'broadcast' ? 'Broadcast' : 'Direct'),
    });

    setLaunchedJobId(jobId);
  };

  const totalDraftBytes = useMemo(() => draft.files.reduce((s, f) => s + f.size, 0), [draft.files]);

  const canBroadcast = hasPermission('filehub:broadcast');
  const colors = useThemeColors();

  return (
    <>
    <Popup
      visible={visible}
      onClose={handleDismiss}
      presentation="centered"
      maxWidth={uploading ? 560 : 900}
      maxHeight="90%"
      containerClassName="rounded-[2rem] premium-shadow"
      containerStyle={{
        backgroundColor: colors.card,
        borderWidth: modalDropOver ? 2 : 1,
        borderColor: modalDropOver ? colors.primary : colors.border,
        // While the goo layer is flying the card's footprint up to the island,
        // the real card steps aside — the blob is standing in for it, pixel for
        // pixel, so there's nothing to see underneath.
        opacity: handingOff ? 0 : 1,
      }}
      // The dim moves into the goo layer for the duration of the morph, where a
      // raw DOM node can fade it out in step with the flight — by the time we
      // unmount, the island the blob landed on is the real one, already visible.
      backdropStyle={handingOff ? { backgroundColor: 'rgba(0,0,0,0)' } : undefined}
      overlays={morph ? (
        <UploadGooMorph from={morph.from} to={morph.to} label={morph.label} cardColor={colors.card} accent={colors.primary} />
      ) : undefined}
      scrollable={false}
    >
        <View
          ref={setCardRef}
          style={{ maxHeight: '100%' }}
        >
          {modalDropOver && (
            <Animated.View
              pointerEvents="none"
              className="absolute inset-0 rounded-[2rem] border-2"
              style={{ borderColor: colors.primary, opacity: dropGlowOpacity }}
            />
          )}
          <View className="flex-row items-center justify-between px-8 pt-7 pb-5 border-b" style={{ borderColor: colors.border }}>
            <Text className="text-xl font-black tracking-tight" style={{ color: colors.textMain }}>
              {uploading ? 'Uploading' : activeGroup ? `Upload to ${activeGroup.name}` : 'Upload Files'}
            </Text>
            <View className="flex-row items-center gap-2">
              {uploading && (
                <TouchableOpacity
                  onPress={handleDismiss}
                  className="flex-row items-center gap-2 h-8 px-3 rounded-xl border"
                  style={{ backgroundColor: colors.background, borderColor: colors.border }}
                >
                  <FontAwesome name="chevron-up" size={10} color={colors.textMuted} />
                  <Text className="text-xs font-black" style={{ color: colors.textMuted }}>Minimize to island</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={handleDismiss} className="w-8 h-8 items-center justify-center rounded-xl border" style={{ backgroundColor: colors.background, borderColor: colors.border }}>
                <FontAwesome name="times" size={12} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
          </View>

          {uploading ? (
            <UploadProgressPanel
              job={job}
              fileCount={draft.files.length}
              totalBytes={totalDraftBytes}
              onMinimize={handleDismiss}
              onCancel={() => { if (launchedJobId) cancelUpload(launchedJobId); }}
              onDone={() => { setLaunchedJobId(null); onClose(); }}
            />
          ) : (
          <>
          <View style={{ flexDirection: 'row', minHeight: 0 }}>
          {/* Left column: file staging — grows with the batch, scrolls on its own */}
          <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1, maxHeight: winHeight * 0.62 }} contentContainerStyle={{ padding: 28, gap: 20 }}>
            {Platform.OS === 'web' && (
              <>
                <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={handleFileChange} />
                <input ref={folderInputRef} type="file" {...({ webkitdirectory: '', multiple: '' } as any)} style={{ display: 'none' }} onChange={handleFolderChange} />
              </>
            )}

            {/* File picker area */}
            {draft.files.length === 0 ? (
              <View
                className="border-2 border-dashed rounded-2xl items-center justify-center py-10 px-6 gap-4"
                style={{ borderColor: modalDropOver ? colors.primary : colors.border, backgroundColor: modalDropOver ? colors.primary + '0d' : 'transparent' }}
              >
                <Animated.View
                  className="w-14 h-14 rounded-2xl border items-center justify-center"
                  style={{
                    backgroundColor: colors.background,
                    borderColor: modalDropOver ? colors.primary : colors.border,
                    transform: [{ scale: dropIconScale }],
                  }}
                >
                  <FontAwesome name="cloud-upload" size={24} color={modalDropOver ? colors.primary : colors.textMuted} />
                </Animated.View>
                <View className="items-center gap-1">
                  <Text className="font-bold text-sm" style={{ color: modalDropOver ? colors.primary : colors.textMain }}>
                    {modalDropOver ? 'Release to add files' : 'Drag and drop files here'}
                  </Text>
                  <Text className="text-xs" style={{ color: colors.textMuted }}>or choose below · up to 500 MB per file</Text>
                </View>
                <View className="flex-row gap-3">
                  <TouchableOpacity
                    onPress={() => fileInputRef.current?.click()}
                    className="flex-row items-center gap-2 px-5 py-2.5 rounded-xl"
                    style={{ backgroundColor: colors.primary }}
                  >
                    <FontAwesome name="files-o" size={12} color="#fff" />
                    <Text className="text-white font-black text-sm">Files</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => folderInputRef.current?.click()}
                    className="flex-row items-center gap-2 border px-5 py-2.5 rounded-xl"
                    style={{ backgroundColor: colors.background, borderColor: colors.border }}
                  >
                    <FontAwesome name="folder-open-o" size={12} color={colors.textMuted} />
                    <Text className="font-black text-sm" style={{ color: colors.textMuted }}>Folder</Text>
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
          </ScrollView>

          <View style={{ width: 1, backgroundColor: colors.border }} />

          {/* Right column: destination + metadata — folder tree scrolls independently */}
          <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1, maxHeight: winHeight * 0.62 }} contentContainerStyle={{ padding: 28, gap: 20 }}>
            {/* Visibility — hidden when uploading to a group (locked to group) */}
            {!activeGroup ? (
              <View className="gap-2">
                <Text className="text-[10px] font-black uppercase tracking-widest" style={{ color: colors.textMuted }}>Visibility</Text>
                <View className="flex-row gap-2">
                  {[
                    { value: 'direct', label: 'Direct Send', icon: 'user' },
                    ...(canBroadcast ? [{ value: 'broadcast', label: 'Broadcast', icon: 'bullhorn' }] : []),
                  ].map(opt => (
                    <TouchableOpacity
                      key={opt.value}
                      onPress={() => patch({ visibility: opt.value as any, recipientIds: [] })}
                      className="flex-1 flex-row items-center justify-center gap-2 py-3 rounded-xl border"
                      style={{
                        backgroundColor: draft.visibility === opt.value ? colors.primary + '1a' : colors.background,
                        borderColor: draft.visibility === opt.value ? colors.primary + '4d' : colors.border,
                      }}
                    >
                      <FontAwesome
                        name={opt.icon as any}
                        size={12}
                        color={draft.visibility === opt.value ? colors.primary : colors.textMuted}
                      />
                      <Text className="text-sm font-black" style={{ color: draft.visibility === opt.value ? colors.primary : colors.textMuted }}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ) : (
              /* Group badge */
              <View className="flex-row items-center gap-3 border rounded-xl px-4 py-3" style={{ backgroundColor: colors.background, borderColor: colors.border }}>
                <View
                  className="w-9 h-9 rounded-xl items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: activeGroup.avatar_color + '22' }}
                >
                  <Text style={{ color: activeGroup.avatar_color, fontSize: 13, fontWeight: '900' }}>
                    {getInitials(activeGroup.name)}
                  </Text>
                </View>
                <View className="flex-1">
                  <Text className="text-[10px] font-black uppercase tracking-widest" style={{ color: colors.textMuted }}>Sharing to channel</Text>
                  <Text className="font-bold text-sm" style={{ color: colors.textMain }}>{activeGroup.name}</Text>
                </View>
                <View className="border rounded-full px-2.5 py-1" style={{ backgroundColor: colors.primary + '1a', borderColor: colors.primary + '33' }}>
                  <Text className="text-[10px] font-black" style={{ color: colors.primary }}>Channel</Text>
                </View>
              </View>
            )}

            {/* Recipients */}
            {draft.visibility === 'direct' && (
              <View className="gap-2">
                <Text className="text-[10px] font-black uppercase tracking-widest" style={{ color: colors.textMuted }}>Recipients</Text>
                {draft.recipientIds.length > 0 && (
                  <View className="flex-row flex-wrap gap-2 mb-1">
                    {memberResults
                      .filter(m => draft.recipientIds.includes(m.id))
                      .map(m => (
                        <View key={m.id} className="flex-row items-center gap-1.5 border rounded-full px-3 py-1" style={{ backgroundColor: colors.primary + '1a', borderColor: colors.primary + '33' }}>
                          <Text className="text-xs font-bold" style={{ color: colors.primary }}>{m.full_name}</Text>
                          <TouchableOpacity onPress={() => toggleRecipient(m.id)}>
                            <FontAwesome name="times" size={9} color={colors.primary} />
                          </TouchableOpacity>
                        </View>
                      ))}
                  </View>
                )}
                <View className="flex-row items-center border rounded-xl px-4 py-2.5 gap-2" style={{ backgroundColor: colors.background, borderColor: colors.border }}>
                  <FontAwesome name="search" size={11} color={colors.textMuted} />
                  <TextInput
                    value={recipientSearch}
                    onChangeText={searchMembers}
                    placeholder="Search team members..."
                    placeholderTextColor={colors.textDim}
                    className="flex-1 text-sm bg-transparent"
                    style={{ color: colors.textMain }}
                  />
                  {searchingMembers && <ActivityIndicator size="small" color={colors.primary} />}
                </View>
                {memberResults.length > 0 && (
                  <View className="border rounded-xl overflow-hidden" style={{ backgroundColor: colors.card, borderColor: colors.border }}>
                    {memberResults.map((m, i) => (
                      <TouchableOpacity
                        key={m.id}
                        onPress={() => toggleRecipient(m.id)}
                        className="flex-row items-center px-4 py-3 gap-3"
                        style={i < memberResults.length - 1 ? { borderBottomWidth: 1, borderColor: colors.border + '80' } : undefined}
                      >
                        <View className="w-7 h-7 rounded-full border items-center justify-center" style={{ backgroundColor: colors.background, borderColor: colors.border }}>
                          <FontAwesome name="user" size={11} color={colors.textMuted} />
                        </View>
                        <Text className="flex-1 text-sm font-medium" style={{ color: colors.textMain }}>{m.full_name}</Text>
                        {draft.recipientIds.includes(m.id) && <FontAwesome name="check" size={11} color={colors.primary} />}
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            )}

            {/* Folder — explorer tree; hidden for group uploads when the group has none */}
            {(!activeGroup || scopedFolders.length > 0) && (
              <View className="gap-2">
                <Text className="text-[10px] font-black uppercase tracking-widest" style={{ color: colors.textMuted }}>Destination</Text>
                {draft.folderId && (
                  <Text className="text-[11px] font-bold" style={{ color: colors.primary }}>
                    {folderPath(scopedFolders, draft.folderId)}
                  </Text>
                )}
                <FolderTreePicker
                  folders={scopedFolders}
                  selectedId={draft.folderId}
                  onSelect={(id) => patch({ folderId: id })}
                  colors={colors}
                />
              </View>
            )}

            {/* Tags */}
            <View className="gap-2">
              <Text className="text-[10px] font-black uppercase tracking-widest" style={{ color: colors.textMuted }}>Tags</Text>
              {draft.tags.length > 0 && (
                <View className="flex-row flex-wrap gap-2">
                  {draft.tags.map(tag => (
                    <View key={tag} className="flex-row items-center gap-1.5 border rounded-full px-3 py-1" style={{ backgroundColor: colors.background, borderColor: colors.border }}>
                      <Text className="text-xs font-bold" style={{ color: colors.textMuted }}>{tag}</Text>
                      <TouchableOpacity onPress={() => patch({ tags: draft.tags.filter(t => t !== tag) })}>
                        <FontAwesome name="times" size={9} color={colors.textMuted} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}
              <View className="flex-row items-center border rounded-xl px-4 py-2.5 gap-2" style={{ backgroundColor: colors.background, borderColor: colors.border }}>
                <FontAwesome name="tag" size={11} color={colors.textMuted} />
                <TextInput
                  value={draft.tagInput}
                  onChangeText={v => { patch({ tagInput: v }); fetchTagSuggestions(v); }}
                  onKeyPress={handleTagKeyPress}
                  onSubmitEditing={() => addTag(draft.tagInput)}
                  placeholder="Add tag and press Enter..."
                  placeholderTextColor={colors.textDim}
                  className="flex-1 text-sm bg-transparent"
                  style={{ color: colors.textMain }}
                />
              </View>
              {tagSuggestResults.length > 0 && (
                <View className="flex-row flex-wrap gap-2">
                  {tagSuggestResults.map(t => (
                    <TouchableOpacity key={t} onPress={() => addTag(t)} className="px-3 py-1 rounded-full border" style={{ backgroundColor: colors.primary + '0d', borderColor: colors.primary + '33' }}>
                      <Text className="text-xs font-bold" style={{ color: colors.primary }}>{t}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            {/* Caption */}
            <View className="gap-2">
              <Text className="text-[10px] font-black uppercase tracking-widest" style={{ color: colors.textMuted }}>Caption</Text>
              <TextInput
                value={draft.caption}
                onChangeText={v => patch({ caption: v })}
                placeholder="Add a note or description..."
                placeholderTextColor={colors.textDim}
                multiline
                numberOfLines={3}
                className="border rounded-xl px-4 py-3 text-sm"
                style={{ minHeight: 80, textAlignVertical: 'top', backgroundColor: colors.background, borderColor: colors.border, color: colors.textMain }}
              />
            </View>

          </ScrollView>
          </View>

            {/* Actions. Upload hands off to the background manager and closes —
                progress + any conflict prompts live in the topbar island now. */}
            <View className="flex-row gap-3 px-8 py-5 border-t" style={{ borderColor: colors.border }}>
              <TouchableOpacity
                onPress={onClose}
                className="flex-1 items-center justify-center py-3.5 rounded-xl border"
                style={{ backgroundColor: colors.background, borderColor: colors.border }}
              >
                <Text className="font-black text-sm" style={{ color: colors.textMuted }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleUpload}
                disabled={draft.files.length === 0 || (draft.visibility === 'direct' && draft.recipientIds.length === 0)}
                className="flex-[2] items-center justify-center py-3.5 rounded-xl"
                style={{ backgroundColor: colors.primary, opacity: (draft.files.length === 0 || (draft.visibility === 'direct' && draft.recipientIds.length === 0)) ? 0.5 : 1 }}
              >
                <Text className="text-white font-black text-sm">
                  {draft.files.length > 1
                    ? `Upload ${draft.files.length} Files`
                    : draft.visibility === 'group' ? 'Share to Channel' : 'Upload File'}
                </Text>
              </TouchableOpacity>
            </View>
          </>
          )}
        </View>
    </Popup>
    </>
  );
}

// ─── Upload Progress Panel (in-modal live view) ───────────────────────────────
// Shown once Upload is clicked. Reads the live job snapshot from the background
// UploadManager (same job that drives the island) so this view and the island
// never disagree. Minimizing hands the card over to the island (see
// UploadGooMorph) — the job, and the island's own progress display, keep
// running in UploadManagerContext regardless of what the transition does.

function UploadProgressPanel({
  job, fileCount, totalBytes, onMinimize, onCancel, onDone,
}: {
  job: UploadJobState | undefined;
  fileCount: number;
  totalBytes: number;
  onMinimize: () => void;
  onCancel: () => void;
  onDone: () => void;
}) {
  const colors = useThemeColors();
  const pct = Math.min(100, Math.max(0, job?.progress ?? 0));
  const status = job?.status ?? 'uploading';
  const isDone = status === 'done';
  const isError = status === 'error';
  const isPartial = status === 'partial';
  const isCancelled = status === 'cancelled';
  const settled = isDone || isError || isPartial || isCancelled;
  // A parked dup/name conflict — the same prompt the island shows, mirrored here
  // so you can answer it without the modal getting in the way of the island.
  const decisions = job?.decisions ?? [];
  const waiting = decisions.length > 0;

  const ringColor = waiting ? colors.warning : isError ? colors.danger : isPartial ? colors.warning : isDone ? colors.success : colors.primary;
  const statusIcon = waiting ? 'question' : isError ? 'exclamation-triangle' : isPartial ? 'exclamation-circle' : isDone ? 'check' : isCancelled ? 'ban' : 'cloud-upload';

  const toneColor = (tone?: string) =>
    tone === 'danger' ? colors.danger : tone === 'warning' ? colors.warning
      : tone === 'success' ? colors.success : tone === 'neutral' ? colors.textMuted : colors.primary;

  // Inline SVG ring (web) for a big, satisfying progress read.
  const size = 132, stroke = 10, r = (size - stroke) / 2, circ = 2 * Math.PI * r;

  return (
    <View style={{ padding: 32, gap: 22, alignItems: 'center' }}>
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        {Platform.OS === 'web' ? (
          <svg width={size} height={size} style={{ position: 'absolute', transform: 'rotate(-90deg)' } as any}>
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={colors.border} strokeWidth={stroke} />
            <circle
              cx={size / 2} cy={size / 2} r={r} fill="none" stroke={ringColor} strokeWidth={stroke}
              strokeDasharray={circ} strokeDashoffset={circ * (1 - pct / 100)} strokeLinecap="round"
              style={{ transition: 'stroke-dashoffset 220ms ease, stroke 220ms ease' } as any}
            />
          </svg>
        ) : (
          <ActivityIndicator size="large" color={ringColor} />
        )}
        <View style={{ alignItems: 'center' }}>
          {settled || waiting ? (
            <FontAwesome name={statusIcon as any} size={34} color={ringColor} />
          ) : (
            <>
              <Text style={{ color: colors.textMain, fontSize: 30, fontWeight: '900', fontVariant: ['tabular-nums'] }}>{pct}%</Text>
            </>
          )}
        </View>
      </View>

      <View style={{ alignItems: 'center', gap: 4 }}>
        <Text className="text-base font-black" style={{ color: colors.textMain }}>
          {waiting ? 'Needs your input' : job?.title ?? `Uploading ${fileCount} file${fileCount === 1 ? '' : 's'}`}
        </Text>
        <Text className="text-xs font-bold" style={{ textAlign: 'center', color: colors.textMuted }}>
          {job?.subtitle ?? `${formatFileSize(totalBytes)} · starting…`}
        </Text>
      </View>

      {/* Parked conflict prompt(s) — answer here, or from the island if minimized. */}
      {waiting ? (
        <View style={{ width: '100%', gap: 12 }}>
          {decisions.map(d => (
            <View
              key={d.id}
              style={{ width: '100%', padding: 14, borderRadius: 14, backgroundColor: colors.warning + '12', borderWidth: 1, borderColor: colors.warning + '33', gap: 10 }}
            >
              <Text className="text-sm font-black" style={{ color: colors.textMain }}>{d.title}</Text>
              <Text className="text-xs font-semibold" style={{ color: colors.textMuted }}>{d.message}</Text>
              <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                {d.options.map(opt => (
                  <TouchableOpacity
                    key={opt.value}
                    onPress={() => d.resolve(opt.value)}
                    style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, backgroundColor: toneColor(opt.tone) + '18', borderWidth: 1, borderColor: toneColor(opt.tone) + '44' }}
                  >
                    <Text style={{ color: toneColor(opt.tone), fontSize: 12, fontWeight: '900' }}>{opt.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ))}
        </View>
      ) : (
        /* Linear bar echoes the ring; steady, easy to glance. */
        <View style={{ width: '100%', height: 8, borderRadius: 999, backgroundColor: colors.border, overflow: 'hidden' }}>
          <View style={{ height: '100%', width: `${Math.max(2, pct)}%`, backgroundColor: ringColor, borderRadius: 999 }} />
        </View>
      )}

      <View className="flex-row gap-3" style={{ width: '100%', paddingTop: 4 }}>
        {settled ? (
          <TouchableOpacity
            onPress={onDone}
            className="flex-1 items-center justify-center py-3.5 rounded-xl"
            style={{ backgroundColor: colors.primary }}
          >
            <Text className="text-white font-black text-sm">Done</Text>
          </TouchableOpacity>
        ) : (
          <>
            <TouchableOpacity
              onPress={onCancel}
              className="flex-1 items-center justify-center py-3.5 rounded-xl border"
              style={{ backgroundColor: colors.background, borderColor: colors.border }}
            >
              <Text className="font-black text-sm" style={{ color: colors.textMuted }}>Cancel upload</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onMinimize}
              className="flex-[2] flex-row items-center justify-center gap-2 py-3.5 rounded-xl"
              style={{ backgroundColor: colors.primary }}
            >
              <FontAwesome name="chevron-up" size={12} color="#fff" />
              <Text className="text-white font-black text-sm">Minimize to island</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
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
    <Popup visible={visible} onClose={onClose} presentation="centered" maxWidth={480} scrollable={false} containerClassName="rounded-[2rem] premium-shadow">
        <View className="flex-row items-center justify-between px-8 pt-7 pb-5 border-b" style={{ borderColor: colors.border }}>
            <Text className="text-xl font-black" style={{ color: colors.textMain }}>New Channel</Text>
            <TouchableOpacity onPress={onClose} className="w-8 h-8 items-center justify-center rounded-xl border" style={{ backgroundColor: colors.background, borderColor: colors.border }}>
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
              <Text className="text-[10px] font-black uppercase tracking-widest" style={{ color: colors.textMuted }}>Channel Name</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="e.g. Design Team"
                placeholderTextColor={colors.textDim}
                maxLength={80}
                className="border rounded-xl px-4 py-3 text-sm font-bold"
                style={{ backgroundColor: colors.background, borderColor: colors.border, color: colors.textMain }}
              />
            </View>

            {/* Description */}
            <View className="gap-2">
              <Text className="text-[10px] font-black uppercase tracking-widest" style={{ color: colors.textMuted }}>Description (optional)</Text>
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="What's this channel for?"
                placeholderTextColor={colors.textDim}
                multiline
                numberOfLines={2}
                maxLength={300}
                className="border rounded-xl px-4 py-3 text-sm"
                style={{ minHeight: 70, textAlignVertical: 'top', backgroundColor: colors.background, borderColor: colors.border, color: colors.textMain }}
              />
            </View>

            {/* Members */}
            <View className="gap-2">
              <Text className="text-[10px] font-black uppercase tracking-widest" style={{ color: colors.textMuted }}>Invite Members</Text>
              {selectedMembers.length > 0 && (
                <View className="flex-row flex-wrap gap-2">
                  {selectedMembers.map(m => (
                    <TouchableOpacity
                      key={m.id}
                      onPress={() => toggleMember(m)}
                      className="flex-row items-center gap-1.5 border rounded-full px-3 py-1"
                      style={{ backgroundColor: colors.primary + '1a', borderColor: colors.primary + '33' }}
                    >
                      <Text className="text-xs font-bold" style={{ color: colors.primary }}>{m.full_name}</Text>
                      <FontAwesome name="times" size={9} color={colors.primary} />
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              <View className="flex-row items-center border rounded-xl px-4 py-2.5 gap-2" style={{ backgroundColor: colors.background, borderColor: colors.border }}>
                <FontAwesome name="search" size={11} color={colors.textMuted} />
                <TextInput
                  value={memberSearch}
                  onChangeText={searchMembers}
                  placeholder="Search team members..."
                  placeholderTextColor={colors.textDim}
                  className="flex-1 text-sm bg-transparent"
                  style={{ color: colors.textMain }}
                />
              </View>
              {memberResults.length > 0 && (
                <View className="border rounded-xl overflow-hidden" style={{ backgroundColor: colors.background, borderColor: colors.border }}>
                  {memberResults.map((m, i) => (
                    <TouchableOpacity
                      key={m.id}
                      onPress={() => toggleMember(m)}
                      className="flex-row items-center px-4 py-3 gap-3"
                      style={i < memberResults.length - 1 ? { borderBottomWidth: 1, borderColor: colors.border + '80' } : undefined}
                    >
                      <Text className="flex-1 text-sm font-medium" style={{ color: colors.textMain }}>{m.full_name}</Text>
                      {selectedMembers.find(r => r.id === m.id) && <FontAwesome name="check" size={11} color={colors.primary} />}
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            <View className="flex-row gap-3">
              <TouchableOpacity onPress={onClose} disabled={creating} className="flex-1 items-center justify-center py-3.5 rounded-xl border" style={{ backgroundColor: colors.background, borderColor: colors.border }}>
                <Text className="font-black text-sm" style={{ color: colors.textMuted }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleCreate}
                disabled={!name.trim() || creating}
                className="flex-[2] items-center justify-center py-3.5 rounded-xl"
                style={{ backgroundColor: colors.primary, opacity: !name.trim() || creating ? 0.5 : 1 }}
              >
                {creating ? <ActivityIndicator size="small" color="#fff" /> : <Text className="text-white font-black text-sm">Create Channel</Text>}
              </TouchableOpacity>
            </View>
          </ScrollView>
    </Popup>
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
            {i > 0 && <FontAwesome name="chevron-right" size={11} color={colors.textDim} style={{ marginHorizontal: 6 }} />}
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
            className="text-typography-main text-sm border border-brand-primary/40 bg-brand-primary/5 rounded-xl px-3 py-1.5 w-40"
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
  const [showQuickShare, setShowQuickShare] = useState(false);

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
      className={`group flex-row items-center px-6 py-4 border-b border-surface-border/40 transition-colors ${
        isSelected ? 'bg-brand-primary/10' : isOver ? 'bg-brand-primary/10 border-l-2 border-l-brand-primary' : 'hover:bg-surface-overlay/60'
      }`}
    >
      {selectionMode ? (
        <Tooltip label={isSelected ? 'Deselect folder' : 'Select folder'}>
          <TouchableOpacity
            onPress={(e) => { e?.stopPropagation?.(); onToggleSelect?.(); }}
            className={`w-9 h-9 rounded-xl items-center justify-center mr-3.5 flex-shrink-0 border-2 ${
              isSelected ? 'bg-brand-primary border-brand-primary' : 'bg-surface-background border-surface-border'
            }`}
          >
            {isSelected && <FontAwesome name="check" size={14} color="#fff" />}
          </TouchableOpacity>
        </Tooltip>
      ) : (
        <View className="w-9 h-9 rounded-xl bg-surface-background border border-surface-border items-center justify-center mr-3.5 flex-shrink-0">
          <FontAwesome name="folder-o" size={16} color={colors.primary} />
        </View>
      )}
      {isRenaming ? (
        <TextInput
          value={renameValue}
          onChangeText={setRenameValue}
          onBlur={commitRename}
          onSubmitEditing={commitRename}
          autoFocus
          className="flex-1 text-typography-main font-bold text-sm bg-transparent mr-3"
        />
      ) : (
        <View className="flex-1 mr-3">
          <Text className="text-typography-main font-bold text-sm" numberOfLines={1}>{folder.name}</Text>
        </View>
      )}
      {!selectionMode && (
        <View
          className="flex-row items-center gap-0.5 flex-shrink-0 opacity-0 -translate-x-1.5 scale-95 group-hover:opacity-100 group-hover:translate-x-0 group-hover:scale-100 transition-all duration-200"
        >
          {onInfo && (
            <Tooltip label="Folder details">
              <TouchableOpacity
                onPress={(e) => { e?.stopPropagation?.(); onInfo(); }}
                className="w-7 h-7 items-center justify-center rounded-lg hover:bg-brand-primary/10 hover:scale-110 active:scale-90 transition-all"
              >
                <FontAwesome name="info-circle" size={12} color={colors.textMuted} />
              </TouchableOpacity>
            </Tooltip>
          )}
          <Tooltip label="Rename folder">
            <TouchableOpacity
              onPress={(e) => { e?.stopPropagation?.(); setRenameValue(folder.name); setIsRenaming(true); }}
              className="w-7 h-7 items-center justify-center rounded-lg hover:bg-brand-primary/10 hover:scale-110 active:scale-90 transition-all"
            >
              <FontAwesome name="pencil-square-o" size={11} color={colors.textMuted} />
            </TouchableOpacity>
          </Tooltip>
          <Tooltip label="Share link">
            <TouchableOpacity
              onPress={(e) => { e?.stopPropagation?.(); setShowQuickShare(true); }}
              className="w-7 h-7 items-center justify-center rounded-lg hover:bg-brand-primary/10 hover:scale-110 active:scale-90 transition-all"
            >
              <FontAwesome name="link" size={12} color={colors.textMuted} />
            </TouchableOpacity>
          </Tooltip>
          <Tooltip label="Delete folder">
            <TouchableOpacity
              onPress={(e) => { e?.stopPropagation?.(); onDelete(); }}
              className="w-7 h-7 items-center justify-center rounded-lg hover:bg-state-danger/10 hover:scale-110 active:scale-90 transition-all"
            >
              <FontAwesome name="trash-o" size={12} color={colors.danger} />
            </TouchableOpacity>
          </Tooltip>
        </View>
      )}
      <ShareLinkModal
        visible={showQuickShare}
        folderId={folder.id}
        fileName={folder.name}
        onClose={() => setShowQuickShare(false)}
      />
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
  const { share, shareSheet } = useShareFile();
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

  const handleQuickShareOut = (e: any) => {
    e?.stopPropagation?.();
    share({
      fileId: file.id,
      bucket: file.bucket || 'filehub-files',
      storagePath: file.storage_path,
      name: file.original_name,
      mimeType: file.mime_type,
      sizeBytes: file.size_bytes,
    });
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
        <Tooltip label={isFileSelected ? 'Deselect file' : 'Select file'}>
          <View className={`w-9 h-9 rounded-xl items-center justify-center mr-3.5 flex-shrink-0 border-2 ${
            isFileSelected ? 'bg-brand-primary border-brand-primary' : 'bg-surface-background border-surface-border'
          }`}>
            {isFileSelected && <FontAwesome name="check" size={14} color="#fff" />}
          </View>
        </Tooltip>
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
          <UserLink userId={file.uploader.id} name={file.uploader.full_name} className="text-typography-muted text-[11px]" /> · {formatFileSize(file.size_bytes)}
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
          <Tooltip label="Download file">
            <TouchableOpacity
              onPress={handleQuickDownload}
              disabled={quickDownloading}
              className="w-7 h-7 items-center justify-center rounded-lg hover:bg-brand-primary/10 hover:scale-110 active:scale-90 transition-all"
            >
              {quickDownloading
                ? <ActivityIndicator size="small" color={colors.primary} style={{ transform: [{ scale: 0.6 }] }} />
                : <FontAwesome name="download" size={12} color={colors.textMuted} />}
            </TouchableOpacity>
          </Tooltip>
          <Tooltip label="Share file">
            <TouchableOpacity
              onPress={handleQuickShareOut}
              className="w-7 h-7 items-center justify-center rounded-lg hover:bg-brand-primary/10 hover:scale-110 active:scale-90 transition-all"
            >
              <FontAwesome name="share" size={12} color={colors.textMuted} />
            </TouchableOpacity>
          </Tooltip>
          {isOwner && (
            <Tooltip label="Share link">
              <TouchableOpacity
                onPress={handleQuickShare}
                className="w-7 h-7 items-center justify-center rounded-lg hover:bg-brand-primary/10 hover:scale-110 active:scale-90 transition-all"
              >
                <FontAwesome name="link" size={12} color={colors.textMuted} />
              </TouchableOpacity>
            </Tooltip>
          )}
          {isOwner && (
            <Tooltip label="Delete file">
              <TouchableOpacity
                onPress={handleQuickDelete}
                className="w-7 h-7 items-center justify-center rounded-lg hover:bg-state-danger/10 hover:scale-110 active:scale-90 transition-all"
              >
                <FontAwesome name="trash-o" size={12} color={colors.danger} />
              </TouchableOpacity>
            </Tooltip>
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
      {shareSheet}
    </TouchableOpacity>
  );
}

// ─── Folder Detail Panel ──────────────────────────────────────────────────────
// Folder equivalent of DetailPanel: shows a folder's properties on the right
// (location, what it contains, quick actions) when its ⓘ button is tapped.
function FolderDetailPanel({
  folder, folders, scopeLabel, onOpen, onRename, onDelete, onDownload, downloading,
}: {
  folder: FileHubFolder;
  folders: FileHubFolder[];
  scopeLabel: string;
  onOpen: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  /** Zips this folder and everything nested inside it. */
  onDownload: () => void;
  downloading: boolean;
}) {
  const colors = useThemeColors();
  const { folderVersions, restoreFolderVersion } = useFileHub();
  const { showConfirm } = useAlert();
  const { successToast } = useToast();
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(folder.name);
  const [displayName, setDisplayName] = useState(folder.name);
  const [showShareLink, setShowShareLink] = useState(false);
  const [versions, setVersions] = useState<FolderVersion[]>([]);
  const [restoringBatch, setRestoringBatch] = useState<string | null>(null);
  useEffect(() => { setIsRenaming(false); setDisplayName(folder.name); }, [folder.id]);

  // Folder versions = upload batches that touched it. Cheap (derived, index-only),
  // so it just loads with the panel rather than hiding behind a tab.
  const loadVersions = useCallback(() => {
    folderVersions(folder.id).then(setVersions).catch(() => setVersions([]));
  }, [folder.id, folderVersions]);
  useEffect(() => { setVersions([]); loadVersions(); }, [loadVersions]);

  // The version the folder's files actually point at — not always the newest,
  // since restoring to v1 leaves v2 in history.
  const effective = versions.find(v => v.is_effective) ?? versions[0];

  const handleRestore = (v: FolderVersion) => {
    showConfirm(
      `Restore folder to v${v.seq}?`,
      `Every file in this folder goes back to how it was after v${v.seq}. Newer versions stay in history, and files added since are left untouched — nothing is deleted.`,
      async () => {
        setRestoringBatch(v.batch_id);
        try {
          const res = await restoreFolderVersion(folder.id, v.batch_id);
          loadVersions();
          successToast(
            res.restored === 0
              ? 'Already at that version'
              : `Restored ${res.restored} file${res.restored === 1 ? '' : 's'} to v${v.seq}` +
                (res.skipped_newer > 0 ? ` · ${res.skipped_newer} newer file${res.skipped_newer === 1 ? '' : 's'} left as-is` : '')
          );
        } catch { /* alerted in context */ } finally {
          setRestoringBatch(null);
        }
      },
      undefined, 'Restore', 'Cancel'
    );
  };

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
          <FontAwesome name="folder-o" size={44} color={colors.primary} />
        </View>
        {isRenaming ? (
          <TextInput
            value={renameValue}
            onChangeText={setRenameValue}
            onBlur={commitRename}
            onSubmitEditing={commitRename}
            autoFocus
            className="text-typography-main text-base font-black tracking-tight mb-0.5 bg-transparent"
          />
        ) : (
          <Text className="text-typography-main text-base font-black tracking-tight mb-0.5 leading-snug" numberOfLines={2}>{displayName}</Text>
        )}
        <View className="flex-row items-center gap-2">
          <Text className="text-typography-muted text-xs">Folder · {scopeLabel}</Text>
          {effective && (
            <Tooltip label={`This folder has ${versions.length} version${versions.length === 1 ? '' : 's'}. Showing v${effective.seq}.`}>
              <View className="rounded-full px-2 py-0.5 border" style={{ backgroundColor: colors.primary + '1a', borderColor: colors.primary + '4d' }}>
                <Text className="text-[10px] font-black" style={{ color: colors.primary }}>v{effective.seq}</Text>
              </View>
            </Tooltip>
          )}
        </View>
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

        {/* Folder version history — one entry per upload batch. Only shown once
            there is actually something to compare against. */}
        {versions.length > 1 && (
          <View className="mb-5 pb-4 border-b border-surface-border/50">
            <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest mb-2">Folder Versions</Text>
            {versions.map(v => (
              <View
                key={v.batch_id}
                className="rounded-xl border px-3 py-2.5 mb-1.5"
                style={{
                  borderColor: v.is_effective ? colors.primary + '4d' : colors.border,
                  backgroundColor: v.is_effective ? colors.primary + '0f' : colors.background,
                }}
              >
                <View className="flex-row items-center gap-2">
                  <Text className="text-sm font-black" style={{ color: v.is_effective ? colors.primary : colors.textMain }}>
                    v{v.seq}
                  </Text>
                  {v.is_effective && (
                    <Text className="text-[9px] font-black uppercase tracking-wider" style={{ color: colors.primary }}>Current</Text>
                  )}
                  <View className="flex-1" />
                  <Text className="text-[10px]" style={{ color: colors.textDim }}>
                    {new Date(v.created_at).toLocaleDateString()}
                  </Text>
                </View>
                <Text className="text-[11px] mt-0.5" style={{ color: colors.textMuted }}>
                  {[
                    v.files_added > 0 ? `${v.files_added} added` : null,
                    v.files_replaced > 0 ? `${v.files_replaced} replaced` : null,
                  ].filter(Boolean).join(' · ') || `${v.files_touched} file${v.files_touched === 1 ? '' : 's'}`}
                  {v.actor?.full_name ? ` · ${v.actor.full_name}` : ''}
                </Text>
                {!v.is_effective && (
                  <TouchableOpacity
                    onPress={() => handleRestore(v)}
                    disabled={restoringBatch === v.batch_id}
                    className="flex-row items-center gap-1.5 mt-2"
                  >
                    {restoringBatch === v.batch_id
                      ? <ActivityIndicator size="small" color={colors.primary} />
                      : <FontAwesome name="history" size={10} color={colors.primary} />}
                    <Text className="text-xs font-bold" style={{ color: colors.primary }}>
                      Restore folder to v{v.seq}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>
        )}

        <View className="gap-2.5">
          <TouchableOpacity onPress={onOpen} className="flex-row items-center justify-center bg-brand-primary rounded-xl px-4 py-3.5 gap-2">
            <FontAwesome name="folder-open-o" size={13} color="#fff" />
            <Text className="text-white font-black text-sm">Open Folder</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { setRenameValue(displayName); setIsRenaming(true); }} className="flex-row items-center justify-center bg-surface-card border border-surface-border rounded-xl px-4 py-3 gap-2">
            <FontAwesome name="pencil-square-o" size={13} color={colors.primary} />
            <Text className="text-brand-primary font-black text-sm">Rename</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowShareLink(true)} className="flex-row items-center justify-center bg-surface-card border border-surface-border rounded-xl px-4 py-3 gap-2">
            <FontAwesome name="link" size={13} color={colors.primary} />
            <Text className="text-brand-primary font-black text-sm">Share Link</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onDownload} disabled={downloading} className="flex-row items-center justify-center bg-surface-card border border-surface-border rounded-xl px-4 py-3 gap-2">
            {downloading ? <ActivityIndicator size="small" color={colors.primary} /> : <FontAwesome name="download" size={13} color={colors.primary} />}
            <Text className="text-brand-primary font-black text-sm">Download as ZIP</Text>
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
  const { share, shareSheet } = useShareFile();
    const colors = useThemeColors();
    const { width: screenWidth, height: screenHeight } = useWindowDimensions();

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

  const handleShareOut = () => {
    if (!file) return;
    share({
      fileId: file.id,
      bucket: file.bucket || 'filehub-files',
      storagePath: file.storage_path,
      name: file.original_name,
      mimeType: file.mime_type,
      sizeBytes: file.size_bytes,
    });
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
    showConfirm('Hide File', 'Remove this file from your inbox?', () => { hideFile(file.id); onClose(); }, undefined, 'Hide');
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
        {/* Compact action row (desktop-fit; replaces the old full-width stack) */}
        <View className="flex-row flex-wrap items-center gap-2 mt-3">
          <TouchableOpacity onPress={handleDownload} disabled={downloadLoading} className="flex-row items-center gap-1.5 px-3.5 py-2 rounded-xl bg-brand-primary">
            {downloadLoading ? <ActivityIndicator size="small" color="#fff" /> : <FontAwesome name="download" size={11} color="#fff" />}
            <Text className="text-white font-black text-[12px]">Download</Text>
          </TouchableOpacity>
          {isUnread && (
            <TouchableOpacity onPress={() => markRead(file.id)} className="flex-row items-center gap-1.5 px-3.5 py-2 rounded-xl bg-surface-background border border-surface-border">
              <FontAwesome name="check" size={11} color={colors.primary} />
              <Text className="text-typography-main font-black text-[12px]">Mark Read</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={handleShareOut} className="flex-row items-center gap-1.5 px-3.5 py-2 rounded-xl bg-surface-background border border-surface-border">
            <FontAwesome name="share" size={11} color={colors.primary} />
            <Text className="text-typography-main font-black text-[12px]">Share</Text>
          </TouchableOpacity>
          {isOwner && (
            <TouchableOpacity onPress={() => setShowShareLink(true)} className="flex-row items-center gap-1.5 px-3.5 py-2 rounded-xl bg-surface-background border border-surface-border">
              <FontAwesome name="link" size={11} color={colors.primary} />
              <Text className="text-typography-main font-black text-[12px]">Link</Text>
            </TouchableOpacity>
          )}
          {mode === 'inbox' && (
            <TouchableOpacity onPress={handleHide} className="flex-row items-center gap-1.5 px-3.5 py-2 rounded-xl bg-surface-background border border-surface-border">
              <FontAwesome name="eye-slash" size={11} color={colors.textMuted} />
              <Text className="text-typography-muted font-black text-[12px]">Hide</Text>
            </TouchableOpacity>
          )}
          {isOwner && (
            <TouchableOpacity onPress={handleDelete} className="flex-row items-center gap-1.5 px-3.5 py-2 rounded-xl bg-state-danger/10 border border-state-danger/20">
              <FontAwesome name="trash-o" size={11} color={colors.danger} />
              <Text className="text-state-danger font-black text-[12px]">Delete</Text>
            </TouchableOpacity>
          )}
        </View>
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
            <UserLink userId={file.uploader.id} name={file.uploader.full_name} className="text-typography-main text-sm font-bold" />
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
                <FontAwesome name="folder-o" size={12} color={colors.textMuted} />
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
                      <UserLink userId={entry.user.id} name={entry.user.full_name} tab="activity" className="text-typography-main text-xs font-bold" />{' '}
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
                    <UserLink userId={v.uploader.id} name={v.uploader.full_name} className="text-typography-muted text-[11px]" /> · {formatFileSize(v.size_bytes)} · {relativeDate(v.created_at)}
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
        onShare={handleShareOut}
        sizeBytes={file.size_bytes}
      />
    )}
    {versionPreview && versionPreview.kind === 'image' && (
      <Popup
        visible
        onClose={() => setVersionPreview(null)}
        presentation="centered"
        maxWidth={Math.round(screenWidth * 0.9)}
        maxHeight={Math.round(screenHeight * 0.85)}
        scrollable={false}
        containerClassName=""
        containerStyle={{ backgroundColor: 'transparent', borderWidth: 0 }}
      >
        <View style={{ width: Math.round(screenWidth * 0.9), height: Math.round(screenHeight * 0.85), alignItems: 'center', justifyContent: 'center' }}>
          <View className="absolute top-0 left-0 right-0 items-center">
            <Text className="text-white font-black text-sm">{`${versionPreview.name} (v${versionPreview.versionNo})`}</Text>
          </View>
          <Image source={{ uri: versionPreview.uri }} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
          <TouchableOpacity onPress={() => setVersionPreview(null)} className="absolute -top-1 right-0 w-11 h-11 rounded-full items-center justify-center" style={{ backgroundColor: 'rgba(255,255,255,0.15)' }}>
            <FontAwesome name="times" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      </Popup>
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
    {shareSheet}
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
  const { user: shareUser } = useAuth();
  const userId = shareUser?.id;
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
    <Popup visible={visible} onClose={onClose} presentation="centered" maxWidth={448} maxHeight="75%" scrollable={false} containerClassName="rounded-2xl">
          <View className="flex-row items-center justify-between px-6 py-4 border-b" style={{ borderColor: colors.border }}>
            <View className="flex-row items-center gap-2 flex-1 min-w-0">
              <FontAwesome name="link" size={14} color={colors.primary} />
              <Text className="font-black text-lg flex-1" style={{ color: colors.textMain }} numberOfLines={1}>Share "{fileName}"</Text>
            </View>
            <TouchableOpacity onPress={onClose} className="w-8 h-8 items-center justify-center">
              <FontAwesome name="times" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: 20 }} style={{ flexShrink: 1 }} showsVerticalScrollIndicator={false}>
            <Text className="text-[10px] font-black uppercase tracking-widest mb-2" style={{ color: colors.textMuted }}>Expires In</Text>
            <View className="flex-row gap-2 mb-4">
              {EXPIRY_OPTIONS.map(opt => (
                <TouchableOpacity
                  key={opt.hours}
                  onPress={() => setExpiryHours(opt.hours)}
                  className="flex-1 items-center py-2.5 rounded-xl border"
                  style={{
                    backgroundColor: expiryHours === opt.hours ? colors.primary + '1a' : colors.background,
                    borderColor: expiryHours === opt.hours ? colors.primary + '4d' : colors.border,
                  }}
                >
                  <Text className="text-xs font-black" style={{ color: expiryHours === opt.hours ? colors.primary : colors.textMuted }}>{opt.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              onPress={handleCreate}
              disabled={creating}
              className="flex-row items-center justify-center rounded-xl py-3 gap-2 mb-5"
              style={{ backgroundColor: colors.primary }}
            >
              {creating ? <ActivityIndicator size="small" color="#fff" /> : <FontAwesome name="plus" size={12} color="#fff" />}
              <Text className="text-white font-black text-sm">Create Link</Text>
            </TouchableOpacity>

            <Text className="text-[10px] font-black uppercase tracking-widest mb-2" style={{ color: colors.textMuted }}>Active Links</Text>
            {loading ? (
              <View className="py-6 items-center"><ActivityIndicator color={colors.primary} /></View>
            ) : activeLinks.length === 0 ? (
              <Text className="text-xs py-2" style={{ color: colors.textDim }}>No active share links.</Text>
            ) : (
              activeLinks.map(link => (
                <View key={link.id} className="border rounded-xl px-4 py-3 mb-2" style={{ borderColor: colors.border }}>
                  <Text className="text-xs font-bold mb-1" style={{ color: colors.textMain }} numberOfLines={1}>{shareLinkUrl(link.token)}</Text>
                  <Text className="text-[10px] mb-2" style={{ color: colors.textDim }}>
                    Expires {new Date(link.expires_at).toLocaleDateString()} · {link.view_count} view{link.view_count === 1 ? '' : 's'}
                    {/* The list now includes other people's links, so say whose. */}
                    {link.created_by && link.created_by !== userId && link.creator_name ? ` · by ${link.creator_name}` : ''}
                  </Text>
                  <View className="flex-row gap-2">
                    <TouchableOpacity
                      onPress={() => handleCopy(link.token)}
                      className="flex-1 flex-row items-center justify-center gap-1.5 border rounded-lg py-2"
                      style={{ backgroundColor: colors.background, borderColor: colors.border }}
                    >
                      <FontAwesome name="copy" size={10} color={colors.primary} />
                      <Text className="text-xs font-bold" style={{ color: colors.primary }}>Copy</Text>
                    </TouchableOpacity>
                    {/* can_revoke is undefined on a link this session just minted
                        (create returns only id/token/expires_at) — that's always
                        our own, so treat missing as allowed. */}
                    {link.can_revoke !== false && (
                      <TouchableOpacity
                        onPress={() => handleRevoke(link)}
                        className="flex-1 flex-row items-center justify-center gap-1.5 border rounded-lg py-2"
                        style={{ backgroundColor: colors.danger + '1a', borderColor: colors.danger + '33' }}
                      >
                        <FontAwesome name="ban" size={10} color={colors.danger} />
                        <Text className="text-xs font-bold" style={{ color: colors.danger }}>Revoke</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              ))
            )}
          </ScrollView>
    </Popup>
  );
}

// ─── Group Members Panel (right panel in groups mode) ─────────────────────────

function GroupMembersPanel({
  group,
  currentUserId,
  canManageOverride,
  onGroupChanged,
}: {
  group: FileHubGroup;
  currentUserId: string | undefined;
  canManageOverride: boolean;
  onGroupChanged: () => void;
}) {
  const { addGroupMember, removeGroupMember, fetchGroupMembers, renameGroup, deleteGroup } = useFileHub();
  const { hasPermission } = useAuth();
  const router = useRouter();
  const [members, setMembers] = useState<FileHubGroupMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [addSearch, setAddSearch] = useState('');
  const [addResults, setAddResults] = useState<any[]>([]);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(group.name);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const colors = useThemeColors();
  const { showConfirm } = useAlert();

  useEffect(() => { setRenameValue(group.name); setIsRenaming(false); }, [group.id, group.name]);

  const commitRename = async () => {
    const name = renameValue.trim();
    setIsRenaming(false);
    if (!name || name === group.name) { setRenameValue(group.name); return; }
    setRenaming(true);
    try {
      await renameGroup(group.id, name);
      onGroupChanged();
    } catch {
      setRenameValue(group.name);
    } finally {
      setRenaming(false);
    }
  };

  const handleDeleteGroup = () => {
    showConfirm(
      'Delete Channel',
      `Permanently delete "${group.name}"? Its files move to the Bin and members lose access.`,
      async () => {
        setDeleting(true);
        try {
          await deleteGroup(group.id);
          onGroupChanged();
        } finally {
          setDeleting(false);
        }
      },
      undefined,
      'Delete',
      'Cancel',
      'destructive'
    );
  };
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
    showConfirm(
      isSelf ? 'Leave Channel' : `Remove ${target?.full_name ?? 'member'}`,
      isSelf ? 'Leave this channel?' : `Remove ${target?.full_name} from the channel?`,
      async () => {
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
      undefined,
      isSelf ? 'Leave' : 'Remove',
      'Cancel',
      'destructive'
    );
  };

  // Override-manage users act as a virtual channel admin even though they
  // hold no real filehub_group_members row (kept that way so they don't
  // show up in the roster themselves).
  const myRole = members.find(m => m.id === currentUserId)?.role ?? (canManageOverride ? 'admin' : undefined);

  // The server decides whether we're allowed to know who can share (role.manage,
  // channel admin, or group_override_manage) and sends can_share as null if not.
  // Trust that answer rather than re-deriving the rule on the client.
  const showsShareColumn = members.some(m => m.can_share !== null && m.can_share !== undefined);
  const canEditRoles = hasPermission('role.manage');

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
        {isRenaming ? (
          <TextInput
            value={renameValue}
            onChangeText={setRenameValue}
            onBlur={commitRename}
            onSubmitEditing={commitRename}
            autoFocus
            editable={!renaming}
            className="text-typography-main text-lg font-black text-center bg-surface-background border border-brand-primary/30 rounded-lg px-3 py-1 min-w-[160px]"
          />
        ) : (
          <TouchableOpacity
            onPress={() => myRole === 'admin' && setIsRenaming(true)}
            disabled={myRole !== 'admin'}
            className="flex-row items-center gap-2"
          >
            <Text className="text-typography-main text-lg font-black text-center">{group.name}</Text>
            {myRole === 'admin' && <FontAwesome name="pencil-square-o" size={11} color={colors.textMuted} />}
          </TouchableOpacity>
        )}
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
          className="flex-1 text-typography-main text-sm bg-transparent"
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
      <View className="flex-row items-center justify-between mb-3">
        <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest">Members ({members.length})</Text>
        {showsShareColumn && (
          <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest">Can share</Text>
        )}
      </View>
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
              <UserLink userId={m.id} name={m.full_name} className="flex-1 text-typography-main text-sm font-medium" />
              {/* can_share is null when the server decided we may not know. */}
              {m.can_share !== null && m.can_share !== undefined && (
                <Tooltip
                  label={m.can_share
                    ? `${m.full_name} can create share links for files they can access`
                    : `${m.full_name} can only share files they uploaded themselves`}
                >
                  <FontAwesome
                    name={m.can_share ? 'share-alt' : 'ban'}
                    size={11}
                    color={m.can_share ? colors.primary : colors.textDim}
                    style={{ width: 18, textAlign: 'center' }}
                  />
                </Tooltip>
              )}
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

      {/* File sharing is a role permission, not a per-channel setting, so the
          only real fix is in the role editor — link straight there instead of
          leaving the reader to hunt for it. */}
      {showsShareColumn && (
        <View className="mt-3 border border-surface-border rounded-xl px-4 py-3 bg-surface-background">
          <Text className="text-typography-dim text-[11px] leading-relaxed">
            Sharing is granted by role, not per channel. Members without it can only
            share files they uploaded themselves.
          </Text>
          {canEditRoles && (
            <TouchableOpacity
              onPress={() => router.push('/admin/roles?tab=roles')}
              className="flex-row items-center gap-2 mt-2.5"
            >
              <FontAwesome name="filter" size={11} color={colors.primary} />
              <Text className="text-brand-primary font-black text-xs">Change sharing permissions</Text>
              <FontAwesome name="chevron-right" size={12} color={colors.primary} />
            </TouchableOpacity>
          )}
        </View>
      )}

      {myRole === 'admin' && (
        <TouchableOpacity
          onPress={handleDeleteGroup}
          disabled={deleting}
          className="flex-row items-center justify-center gap-2 bg-state-danger/10 border border-state-danger/20 rounded-xl px-4 py-3 mt-6"
        >
          {deleting ? <ActivityIndicator size="small" color={colors.danger} /> : <FontAwesome name="trash-o" size={12} color={colors.danger} />}
          <Text className="text-state-danger font-black text-sm">Delete Channel</Text>
        </TouchableOpacity>
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
    <Popup visible={visible} onClose={onClose} presentation="centered" maxWidth={448} maxHeight="70%" scrollable={false} containerClassName="rounded-2xl">
          <View className="flex-row items-center justify-between px-6 py-4 border-b" style={{ borderColor: colors.border }}>
            <View className="flex-row items-center gap-2">
              <FontAwesome name="tags" size={14} color={colors.primary} />
              <Text className="font-black text-lg" style={{ color: colors.textMain }}>Manage Tags</Text>
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
              <Text className="text-sm mt-3" style={{ color: colors.textMuted }}>No tags yet</Text>
            </View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false} style={{ flexShrink: 1 }}>
              {tags.map(({ tag, count }) => {
                const c = getTagColor(tag);
                const isRenaming = renamingTag === tag;
                return (
                  <View key={tag} className="flex-row items-center px-5 py-3.5 border-b" style={{ borderColor: colors.border + '80' }}>
                    <View style={{ backgroundColor: c.bg, borderColor: c.border, borderWidth: 1 }} className="px-2.5 py-1 rounded-full mr-3 flex-shrink-0">
                      <Text style={{ color: c.text }} className="text-xs font-bold">{tag}</Text>
                    </View>

                    {isRenaming ? (
                      <TextInput
                        value={renameInput}
                        onChangeText={setRenameInput}
                        autoFocus
                        className="flex-1 border rounded-lg px-2 py-1 text-sm mr-2"
                        style={{ backgroundColor: colors.background, borderColor: colors.primary + '80', color: colors.textMain }}
                        onSubmitEditing={() => handleRenameSave(tag)}
                      />
                    ) : (
                      <Text className="flex-1 text-xs" style={{ color: colors.textMuted }}>{count} file{count !== 1 ? 's' : ''}</Text>
                    )}

                    {isRenaming ? (
                      <View className="flex-row gap-2">
                        <TouchableOpacity
                          onPress={() => handleRenameSave(tag)}
                          disabled={!!savingTag}
                          className="w-8 h-8 border rounded-lg items-center justify-center"
                          style={{ backgroundColor: colors.primary + '1a', borderColor: colors.primary + '33' }}
                        >
                          {savingTag === tag ? <ActivityIndicator size="small" color={colors.primary} /> : <FontAwesome name="check" size={12} color={colors.primary} />}
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => setRenamingTag(null)}
                          className="w-8 h-8 border rounded-lg items-center justify-center"
                          style={{ backgroundColor: colors.background, borderColor: colors.border }}
                        >
                          <FontAwesome name="times" size={12} color={colors.textMuted} />
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <View className="flex-row gap-2">
                        <TouchableOpacity
                          onPress={() => { setRenamingTag(tag); setRenameInput(tag); }}
                          className="w-8 h-8 border rounded-lg items-center justify-center"
                          style={{ backgroundColor: colors.background, borderColor: colors.border }}
                        >
                          <FontAwesome name="pencil-square-o" size={12} color={colors.textMuted} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => handleDelete(tag)}
                          className="w-8 h-8 border rounded-lg items-center justify-center"
                          style={{ backgroundColor: colors.danger + '1a', borderColor: colors.danger + '33' }}
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
    </Popup>
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
    refresh, refreshFolders,
    markAllRead,
    checkDuplicate,
    checkNameConflict,
    replaceFile,
    groups, groupsLoading,
    channelOverrideMode, setChannelOverrideMode,
    activeGroupId, setActiveGroupId,
    groupFiles, groupFilesLoading,
    refreshGroups, refreshGroupFiles,
    hideFile, deleteFile,
  } = useFileHub();

  const canOverrideChannels = hasPermission('filehub:group_override');
  const canManageOverride = hasPermission('filehub:group_override_manage');

  // Uploads run in the background now (UploadManagerContext), so a job can
  // finish long after its modal closed. Re-pull the listing whenever any job
  // completes so newly-committed files + server-created folders show up.
  const { lastCompletedAt } = useUploadManager();
  useEffect(() => {
    if (!lastCompletedAt) return;
    refresh();
    refreshFolders();
    refreshGroupFiles();
  }, [lastCompletedAt]);

  const router = useRouter();
  const { tab: tabParam, file: fileParam } = useLocalSearchParams<{ tab?: string; file?: string }>();

  const [selectedFile, setSelectedFile] = useState<FileHubFile | null>(null);
  const [detailPanelFile, setDetailPanelFile] = useState<FileHubFile | null>(null);
  // Folder properties panel — parallel to the file detail panel, shown when a
  // folder's ⓘ button is tapped. detailPanelFolder lags selectedFolderDetail so
  // the panel stays mounted through the collapse animation.
  const [selectedFolderDetail, setSelectedFolderDetail] = useState<FileHubFolder | null>(null);
  const [detailPanelFolder, setDetailPanelFolder] = useState<FileHubFolder | null>(null);
  const [fastTrackPreview, setFastTrackPreview] = useState(false);
  const isDoubleTap = useDoubleTap();

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

  // Standard click → detail panel (toggles); Double-click or Shift+Click (web)
  // → fullscreen viewer; Ctrl/Cmd+Click (web, Explorer-style) → add to
  // multi-selection without opening the detail panel.
  const openFile = useCallback((file: FileHubFile, e?: any) => {
    // RNW zeroes nativeEvent.ctrlKey, so fall back to the live DOM modifier state
    // to detect Ctrl+Click on Windows/Linux (isMultiSelectModifierActive).
    const ctrlOrCmd = !!(e?.ctrlKey || e?.metaKey || e?.nativeEvent?.ctrlKey || e?.nativeEvent?.metaKey) || isMultiSelectModifierActive();
    if (ctrlOrCmd) {
      setSelectionMode(true);
      toggleFileSelect(file.id);
      return;
    }
    // Double-click is Explorer's "open it" gesture, so it takes the same
    // fast-track the Shift modifier already had. Checked even when shift is
    // held so the ref stays in step and a later double still registers.
    const isDouble = isDoubleTap(file.id);
    const fast = !!(e?.shiftKey || e?.nativeEvent?.shiftKey) || isDouble;
    setFastTrackPreview(fast);
    // A fast-track press must never be the toggle that closes the panel —
    // the first click of a double already opened it.
    setSelectedFile(prev => (prev?.id === file.id && !fast ? null : file));
  }, [toggleFileSelect, isDoubleTap]);

  // Ctrl/Cmd+Click a folder → add it to the multi-selection (Explorer-style);
  // a plain click still navigates into it.
  const openFolder = useCallback((folderId: string, e?: any) => {
    const ctrlOrCmd = !!(e?.ctrlKey || e?.metaKey || e?.nativeEvent?.ctrlKey || e?.nativeEvent?.metaKey) || isMultiSelectModifierActive();
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
  const [droppedFiles, setDroppedFiles] = useState<File[] | null>(null);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showManageTags, setShowManageTags] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [showBin, setShowBin] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
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
    const foldersToDownload = subfolders.filter(f => selectedFolderIds.has(f.id));
    if ((filesToDownload.length === 0 && foldersToDownload.length === 0) || zipDownloading) return;
    setZipDownloading(true);
    try {
      const folderFiles = foldersToDownload.length > 0 ? await resolveFolderZipFiles(foldersToDownload) : [];
      await downloadFilesAsZip([...filesToDownload, ...folderFiles], 'Selected Files');
      exitSelection();
    } finally {
      setZipDownloading(false);
    }
  };

  const handleDownloadFolder = async (folder: FileHubFolder) => {
    if (zipDownloading) return;
    setZipDownloading(true);
    try {
      const folderFiles = await resolveFolderZipFiles([folder]);
      await downloadFilesAsZip(folderFiles, folder.name);
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

  // Gathers every file nested (any depth) under the given root folders, tagged
  // with a zip_path so downloadFilesAsZip rebuilds the folder structure instead
  // of flattening everything into one directory. Channel files are already
  // loaded in full (groupFiles, unfiltered by folder — see displayFiles above),
  // so that case is a pure client-side filter; inbox/sent/broadcast folders are
  // server-scoped one at a time, so each descendant folder needs its own
  // rpc_filehub_list call.
  const resolveFolderZipFiles = useCallback(async (rootFolders: FileHubFolder[]) => {
    const byId = new Map(contextFolders.map(f => [f.id, f]));
    const rootIds = new Set(rootFolders.map(f => f.id));
    const descendantIds = new Set<string>();
    for (const rf of rootFolders) for (const id of folderDescendantIds(contextFolders, rf.id)) descendantIds.add(id);

    // Path from (and including) whichever selected root this folder descends
    // from, down to (and including) the folder itself.
    const zipPathFor = (folderId: string): string => {
      const chain: string[] = [];
      let cur = byId.get(folderId);
      while (cur) {
        chain.unshift(cur.name);
        if (rootIds.has(cur.id)) break;
        cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
      }
      return chain.join('/');
    };

    if (mode === 'groups' && activeGroupId) {
      return groupFiles
        .filter(f => f.folder_id && descendantIds.has(f.folder_id))
        .map(f => ({ storage_path: f.storage_path, bucket: f.bucket, original_name: f.original_name, mime_type: f.mime_type, zip_path: zipPathFor(f.folder_id!) }));
    }

    const perFolder = await Promise.all(
      Array.from(descendantIds).map(async id => {
        const { data } = await supabase.rpc('rpc_filehub_list', { p_mode: mode, p_folder_id: id });
        return ((data ?? []) as FileHubFile[]).map(f => ({
          storage_path: f.storage_path, bucket: f.bucket, original_name: f.original_name, mime_type: f.mime_type,
          zip_path: zipPathFor(id),
        }));
      })
    );
    return perFolder.flat();
  }, [contextFolders, mode, activeGroupId, groupFiles]);

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
    const validModes: FileHubMode[] = ['overview', 'browse', 'inbox', 'sent', 'broadcast', 'groups'];
    if (tabParam && validModes.includes(tabParam as FileHubMode)) {
      setMode(tabParam as FileHubMode);
    }
  }, []);

  // Deep link (?file=<id>) from global search — open the file directly. Opening
  // the viewer beats trying to scroll-and-highlight across the four mode layouts.
  useEffect(() => {
    if (!fileParam) return;
    let cancelled = false;
    supabase.rpc('rpc_filehub_browse', { p_file_id: fileParam }).then(({ data }) => {
      const row = (data as any)?.items?.[0];
      if (!cancelled && row) openStorageFile(row.bucket, row.storage_path, row.file_name, row.mime_type);
    });
    router.setParams({ file: undefined });
    return () => { cancelled = true; };
  }, [fileParam]);

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
    { key: 'overview', label: 'Overview' },
    { key: 'browse', label: 'Browse' },
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
    if (mode === 'overview' || mode === 'browse') { setRefreshKey(k => k + 1); return; }
    if (mode === 'groups') { refreshGroups(); if (activeGroupId) refreshGroupFiles(); }
    else refresh();
  };

  // Same gate as the Upload button: can't drop onto the channel list or a
  // view-only override channel the server would reject.
  const canUpload = mode !== 'groups' || (!!activeGroupId && (!activeGroup?.is_override || canManageOverride));
  // Drop OS files anywhere on the screen → open the composer pre-filled with
  // them and the folder you're in (initialFiles + defaultFolderId). Folder
  // drops arrive with webkitRelativePath set, so they nest exactly like the
  // Folder button.
  const { ref: fileDropRef, isOver: fileDropOver } = useFileDrop(
    (files) => { setDroppedFiles(files); setShowUpload(true); },
    canUpload,
  );
  const { iconScale: fileDropIconScale } = useDropPulse(fileDropOver);

  return (
    <View ref={fileDropRef} className="flex-1 bg-surface-background flex-col">
      {/* Drop-to-upload overlay — only while OS files are dragged over the screen */}
      {fileDropOver && (
        <View
          pointerEvents="none"
          className="absolute inset-0 z-50 items-center justify-center border-2 border-dashed rounded-3xl m-3"
          style={{ borderColor: colors.primary, backgroundColor: colors.primary + '14' }}
        >
          <View className="items-center gap-3 px-8 py-6 rounded-3xl" style={{ backgroundColor: colors.card }}>
            <Animated.View style={{ transform: [{ scale: fileDropIconScale }] }}>
              <FontAwesome name="cloud-upload" size={28} color={colors.primary} />
            </Animated.View>
            <Text className="font-black text-base" style={{ color: colors.textMain }}>
              Drop to upload{selectedFolderId ? ` to ${folders.find(f => f.id === selectedFolderId)?.name ?? 'this folder'}` : ''}
            </Text>
          </View>
        </View>
      )}
      {/* ── Header ── */}
      <View className="px-10 pt-8 pb-5 flex-row flex-wrap items-center justify-between gap-4 border-b border-surface-border flex-shrink-0">
        <View className="min-w-0">
          <Text className="text-brand-primary font-black uppercase tracking-[0.3em] text-[9px] mb-1">Intelligence Hub</Text>
          <Text className="text-typography-main text-4xl font-black tracking-tighter">File Hub</Text>
        </View>
        <View className="flex-row items-center gap-3 flex-wrap justify-end">
          <View className="flex-row items-center bg-surface-card border border-surface-border rounded-xl px-4 py-2.5 gap-3 w-full max-w-[280px] min-w-[200px]">
            <FontAwesome name="search" size={12} color={colors.textMuted} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder={mode === 'groups' && activeGroupId ? 'Search channel files...' : 'Search files...'}
              placeholderTextColor={colors.textDim}
              className="flex-1 text-typography-main text-sm font-medium bg-transparent"
            />
            {search.length > 0 && (
              <Tooltip label="Clear search">
                <TouchableOpacity onPress={() => setSearch('')}>
                  <FontAwesome name="times-circle" size={12} color={colors.textMuted} />
                </TouchableOpacity>
              </Tooltip>
            )}
          </View>
          {/* Icon-only, matching the Sent/Bin/Refresh squares beside it — this used
              to carry an "Insights" text label and was the single widest item in
              the row, which is what pushed Upload onto its own wrapped line on
              real (sidebar-narrowed) desktop widths. */}
          <Tooltip label="Insights">
            <TouchableOpacity
              onPress={() => setShowAnalytics(true)}
              className="h-10 w-10 items-center justify-center bg-surface-card border border-surface-border rounded-xl shrink-0"
            >
              <FontAwesome name="bar-chart" size={13} color={colors.primary} />
            </TouchableOpacity>
          </Tooltip>
          <Tooltip label="View sent files">
            <TouchableOpacity
              onPress={() => handleTabChange('sent')}
              className={`h-10 w-10 items-center justify-center border rounded-xl shrink-0 ${mode === 'sent' ? 'bg-brand-primary/10 border-brand-primary/30' : 'bg-surface-card border-surface-border'}`}
            >
              <FontAwesome name="paper-plane-o" size={12} color={mode === 'sent' ? colors.primary : colors.textMuted} />
            </TouchableOpacity>
          </Tooltip>
          <Tooltip label="View deleted files">
            <TouchableOpacity
              onPress={() => setShowBin(true)}
              className="h-10 w-10 items-center justify-center bg-surface-card border border-surface-border rounded-xl shrink-0"
            >
              <FontAwesome name="trash-o" size={13} color={colors.primary} />
            </TouchableOpacity>
          </Tooltip>
          <Tooltip label="Refresh">
            <TouchableOpacity
              onPress={handleRefresh}
              className="h-10 w-10 items-center justify-center bg-surface-card border border-surface-border rounded-xl shrink-0"
            >
              <FontAwesome name="refresh" size={13} color={colors.primary} />
            </TouchableOpacity>
          </Tooltip>
          {/* Upload button — show if not on groups list (no activeGroupId in groups mode). Hidden
              for view-only override channels: you're not a member and lack manage-tier override,
              so the server would reject the upload. Manage-tier override can upload like any admin. */}
          {canUpload && (
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
          {mode === 'groups' && !activeGroupId && (canOverrideChannels || canManageOverride) && (
            <TouchableOpacity
              onPress={() => setChannelOverrideMode(!channelOverrideMode)}
              className={`flex-row items-center gap-2 px-5 py-2.5 rounded-xl shrink-0 border ${
                channelOverrideMode ? 'bg-brand-primary/10 border-brand-primary/30' : 'bg-surface-card border-surface-border'
              }`}
            >
              <FontAwesome name="eye" size={12} color={channelOverrideMode ? colors.primary : colors.textMuted} />
              <Text className={`font-black text-sm tracking-wide ${channelOverrideMode ? 'text-brand-primary' : 'text-typography-muted'}`}>
                {channelOverrideMode ? 'Browsing All Channels' : 'Browse All Channels'}
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
      <View className="px-10 pt-3 pb-2.5 flex-row items-center gap-2 flex-shrink-0 border-b border-surface-border">
        {tabs.map(tab => (
          <TouchableOpacity
            key={tab.key}
            onPress={() => handleTabChange(tab.key)}
            className={`flex-row items-center gap-2 px-5 py-1.5 rounded-xl border transition-colors ${
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

      {/* ── Overview / Browse tabs (own their data, full-width) ── */}
      {mode === 'overview' && (
        <FileHubOverview
          key={`overview-${refreshKey}`}
          onUpload={() => setShowUpload(true)}
          onNewChannel={() => setShowCreateGroup(true)}
          onGoTab={handleTabChange}
        />
      )}
      {mode === 'browse' && <FileHubBrowse key={`browse-${refreshKey}`} />}

      {/* ── Two-column body ── */}
      {mode !== 'overview' && mode !== 'browse' && (
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
            <View className="flex-1 px-6 py-6">
              <FileHubChannelsMultiView
                groups={groups}
                loading={groupsLoading}
                searchValue={search}
                onPressGroup={(g) => { setActiveGroupId(g.id); setSelectedFile(null); }}
                onCreateChannel={() => setShowCreateGroup(true)}
              />
            </View>
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
                  <Tooltip label="Download channel as ZIP">
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
                  </Tooltip>
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
                  <Tooltip label="Manage tags">
                    <TouchableOpacity
                      onPress={() => setShowManageTags(true)}
                      className="px-3 py-2.5 border-l border-surface-border flex-shrink-0"
                    >
                      <FontAwesome name="tags" size={13} color={colors.textMuted} />
                    </TouchableOpacity>
                  </Tooltip>
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
                      <Tooltip label={allVisibleSelected ? 'Deselect all' : 'Select all'}>
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
                      </Tooltip>
                      <Text className="flex-1 text-brand-primary text-xs font-black ml-2">
                        {totalSelected === 0 ? 'Tap to select' : `${totalSelected} of ${totalVisible} selected`}
                      </Text>
                      {totalSelected > 0 && (
                        <TouchableOpacity
                          onPress={handleDownloadSelected}
                          disabled={zipDownloading}
                          className="flex-row items-center gap-1.5 bg-brand-primary px-3 py-1.5 rounded-lg"
                        >
                          {zipDownloading ? <ActivityIndicator size="small" color="#fff" /> : <FontAwesome name="download" size={10} color="#fff" />}
                          <Text className="text-white text-xs font-black">Download {totalSelected}</Text>
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
                      <Tooltip label="Clear selection">
                        <TouchableOpacity onPress={exitSelection} className="w-7 h-7 items-center justify-center ml-1">
                          <FontAwesome name="times" size={13} color={colors.textMuted} />
                        </TouchableOpacity>
                      </Tooltip>
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
                      draggable={file.uploader?.id === user?.id || (file.visibility === 'group' && canManageOverride)}
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
                  <Tooltip label="Manage tags">
                    <TouchableOpacity
                      onPress={() => setShowManageTags(true)}
                      className="px-3 py-2.5 border-l border-surface-border flex-shrink-0"
                    >
                      <FontAwesome name="tags" size={13} color={colors.textMuted} />
                    </TouchableOpacity>
                  </Tooltip>
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
                      <Tooltip label={allVisibleSelected ? 'Deselect all' : 'Select all'}>
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
                      </Tooltip>
                      <Text className="flex-1 text-brand-primary text-xs font-black ml-2">
                        {totalSelected === 0 ? 'Tap to select' : `${totalSelected} of ${totalVisible} selected`}
                      </Text>
                      {totalSelected > 0 && (
                        <TouchableOpacity
                          onPress={handleDownloadSelected}
                          disabled={zipDownloading}
                          className="flex-row items-center gap-1.5 bg-brand-primary px-3 py-1.5 rounded-lg"
                        >
                          {zipDownloading ? <ActivityIndicator size="small" color="#fff" /> : <FontAwesome name="download" size={10} color="#fff" />}
                          <Text className="text-white text-xs font-black">Download {totalSelected}</Text>
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
                      <Tooltip label="Clear selection">
                        <TouchableOpacity onPress={exitSelection} className="w-7 h-7 items-center justify-center ml-1">
                          <FontAwesome name="times" size={13} color={colors.textMuted} />
                        </TouchableOpacity>
                      </Tooltip>
                    </View>
                  ) : (
                    <View className="flex-row items-center px-6 py-3 bg-surface-background/60 border-b border-surface-border/60">
                      <View className="w-9 mr-3.5" />
                      <Text className="flex-1 text-typography-muted text-[9px] font-black uppercase tracking-widest">Name</Text>
                      {displayFiles.length > 0 && (
                        <Tooltip label="Download all">
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
                        </Tooltip>
                      )}
                      <Tooltip label="Select multiple">
                        <TouchableOpacity onPress={() => setSelectionMode(true)} className="w-7 h-7 items-center justify-center mr-1">
                          <FontAwesome name="check-square-o" size={11} color={colors.textMuted} />
                        </TouchableOpacity>
                      </Tooltip>
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
                      draggable={file.uploader?.id === user?.id || (file.visibility === 'group' && canManageOverride)}
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
              <GroupMembersPanel group={groupPanelGroup} currentUserId={user?.id} canManageOverride={canManageOverride} onGroupChanged={refreshGroups} />
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
                onDownload={() => handleDownloadFolder(detailPanelFolder)}
                downloading={zipDownloading}
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
                onDownload={() => handleDownloadFolder(detailPanelFolder)}
                downloading={zipDownloading}
              />
            </View>
          )}
        </View>
      </View>
      )}

      {/* ── Upload Modal ── */}
      <UploadModal
        visible={showUpload}
        folders={folders}
        initialFiles={droppedFiles}
        onClose={() => { setShowUpload(false); setDroppedFiles(null); }}
        onUploaded={() => { mode === 'groups' && activeGroupId ? refreshGroupFiles() : refresh(); }}
        checkDuplicate={checkDuplicate}
        checkNameConflict={checkNameConflict}
        replaceFile={replaceFile}
        hasPermission={hasPermission}
        profile={profile}
        activeGroup={activeGroup ? { id: activeGroup.id, name: activeGroup.name, avatar_color: activeGroup.avatar_color } : null}
        defaultFolderId={selectedFolderId}
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