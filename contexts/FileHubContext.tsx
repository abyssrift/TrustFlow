import { supabase, supabaseUrl, supabaseAnonKey, freshChannel } from '@/lib/supabase';
import { recordChannelVisit } from '@/lib/filehubRecentChannels';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { DeviceEventEmitter } from 'react-native';
import { useIsland } from '@/contexts/IslandContext';
import { useAlert } from '@/contexts/AlertContext';

export type FileHubMode = 'overview' | 'browse' | 'inbox' | 'sent' | 'broadcast' | 'groups';

export type FileHubFile = {
  id: string;
  original_name: string;
  mime_type: string | null;
  size_bytes: number;
  caption: string | null;
  visibility: 'direct' | 'broadcast' | 'group';
  folder_id: string | null;
  group_id: string | null;
  tags: string[];
  storage_path: string;
  bucket: string;
  content_hash: string | null;
  created_at: string;
  uploaded_by: string;
  uploader: { id: string; full_name: string; avatar_url: string | null };
  folder: { id: string; name: string } | null;
  recipient_state?: { read_at: string | null; archived_at: string | null };
  recipients?: Array<{ id: string; full_name: string; avatar_url: string | null; read_at: string | null }>;
  recipient_count?: number;
  current_version_id?: string;
  version_count?: number;
  is_stale_restore?: boolean;
  // Bin-only fields (present when returned from rpc_filehub_bin_list)
  trash_type?: 'deleted' | 'hidden';
  trashed_at?: string;
  expires_at?: string;
  item_type?: 'file' | 'folder';
};

export type FileHubShareLink = {
  id: string;
  token: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  view_count: number;
  last_viewed_at: string | null;
};

// Builds the public /share/<token> URL. EXPO_PUBLIC_APP_URL covers native
// (no `window`) and is the source of truth in prod; window.location.origin
// is a same-answer fallback for local/preview web builds where it's unset.
export function shareLinkUrl(token: string): string {
  const base =
    process.env.EXPO_PUBLIC_APP_URL ||
    (typeof window !== 'undefined' ? window.location.origin : 'https://portal.trustedgellc.com');
  return `${base.replace(/\/$/, '')}/share/${token}`;
}

export type FileVersion = {
  id: string;
  version_no: number;
  original_name: string;
  size_bytes: number;
  mime_type: string | null;
  storage_path: string;
  bucket: string;
  created_at: string;
  superseded_at: string | null;
  is_current: boolean;
  pinned: boolean;
  is_stale_restore: boolean;
  expires_at: string | null;
  uploader: { id: string; full_name: string; avatar_url: string | null };
};

// Feature C — a row from rpc_files_search (task submission / brief files)
export type CrossSearchResult = {
  source: 'submission' | 'task_brief';
  file_id: string;
  bucket: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number;
  category: string | null;
  uploaded_by: string;
  created_at: string;
  task_id: string;
  submission_id: string | null;
  task_title: string | null;
};

export type FileHubFolderScope = 'direct' | 'broadcast' | 'group';

export type FileHubFolder = {
  id: string;
  name: string;
  parent_id: string | null;
  scope: FileHubFolderScope;
  group_id: string | null;
};

// Root-to-self ancestor chain for a folder — used for breadcrumbs.
export function folderAncestors(folders: FileHubFolder[], folderId: string): FileHubFolder[] {
  const byId = new Map(folders.map(f => [f.id, f]));
  const chain: FileHubFolder[] = [];
  let cur = byId.get(folderId);
  let guard = 0;
  while (cur && guard++ < 50) {
    chain.unshift(cur);
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return chain;
}

// "Parent / Child" display path for a folder — used wherever folders are
// shown in a flat list (upload pickers) so same-named folders under
// different parents stay distinguishable.
export function folderPath(folders: FileHubFolder[], folderId: string): string {
  return folderAncestors(folders, folderId).map(f => f.name).join(' / ');
}

// folderId plus every folder nested under it, any depth — used to gather a
// folder's full recursive contents (e.g. "download folder as zip").
export function folderDescendantIds(folders: FileHubFolder[], folderId: string): string[] {
  const out: string[] = [folderId];
  const stack: string[] = [folderId];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const f of folders) {
      if (f.parent_id === cur) { out.push(f.id); stack.push(f.id); }
    }
  }
  return out;
}

export type FileHubGroup = {
  id: string;
  name: string;
  description: string | null;
  avatar_color: string;
  my_role: 'admin' | 'member' | null;
  // True when this channel is visible only because the caller holds
  // filehub:group_override(_manage) and switched on channelOverrideMode —
  // they are not actually in filehub_group_members, so other members can't
  // see them unless someone explicitly invites them in.
  is_override: boolean;
  member_count: number;
  members: Array<{ id: string; full_name: string; avatar_url: string | null }>;
  file_count: number;
  last_activity: string | null;
};

export type FileHubGroupMember = {
  id: string;
  full_name: string;
  avatar_url: string | null;
  role: 'admin' | 'member';
  joined_at: string;
};

export type FileActivity = {
  id: string;
  action: 'upload' | 'download' | 'view' | 'delete' | 'share';
  metadata: Record<string, any> | null;
  created_at: string;
  user: { id: string; full_name: string; avatar_url: string | null };
};

type FileHubContextType = {
  mode: FileHubMode;
  setMode: (m: FileHubMode) => void;
  search: string;
  searchDebounced: string;
  setSearch: (s: string) => void;
  // Cross-source search results (task submission / brief files) for the current query
  taskResults: CrossSearchResult[];
  selectedFolderId: string | null;
  setSelectedFolderId: (id: string | null) => void;
  selectedTag: string | null;
  setSelectedTag: (tag: string | null) => void;
  // Inbox / Sent / Broadcast
  files: FileHubFile[];
  folders: FileHubFolder[];
  loading: boolean;
  inboxUnreadCount: number;
  refresh: () => void;
  refreshFolders: () => void;
  markRead: (fileId: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  hideFile: (fileId: string) => Promise<void>;
  deleteFile: (fileId: string) => Promise<void>;
  // Bin
  binFiles: FileHubFile[];
  binLoading: boolean;
  fetchBin: () => Promise<void>;
  restoreFromBin: (fileId: string) => Promise<void>;
  restoreFolder: (folderId: string) => Promise<void>;
  emptyBin: () => Promise<{ files_deleted: number; folders_deleted: number }>;
  createFolder: (name: string, parentId?: string | null, scope?: FileHubFolderScope, groupId?: string | null) => Promise<void>;
  renameFolder: (id: string, name: string) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  moveFolder: (id: string, newParentId: string | null) => Promise<void>;
  moveFile: (fileId: string, folderId: string | null) => Promise<void>;
  tagSuggestions: (prefix: string) => Promise<string[]>;
  checkDuplicate: (hash: string, folderId: string | null) => Promise<any[]>;
  // Versioning
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
  fileVersions: (fileId: string) => Promise<FileVersion[]>;
  restoreVersion: (versionId: string) => Promise<void>;
  pinVersion: (versionId: string, pinned: boolean) => Promise<void>;
  // Share links (public, read-only, expiring)
  createShareLink: (fileId: string, expiresInHours: number) => Promise<FileHubShareLink>;
  revokeShareLink: (id: string) => Promise<void>;
  listShareLinks: (fileId: string) => Promise<FileHubShareLink[]>;
  // Folder share links — same model as files (revoke is shared, keyed by link id)
  createFolderShareLink: (folderId: string, expiresInHours: number) => Promise<FileHubShareLink>;
  listFolderShareLinks: (folderId: string) => Promise<FileHubShareLink[]>;
  // Groups
  groups: FileHubGroup[];
  groupsLoading: boolean;
  // "Browse all channels" — off by default. Only takes effect for holders of
  // filehub:group_override; toggling it on lists every company channel
  // instead of just the ones the caller belongs to.
  channelOverrideMode: boolean;
  setChannelOverrideMode: (on: boolean) => void;
  activeGroupId: string | null;
  setActiveGroupId: (id: string | null) => void;
  groupFiles: FileHubFile[];
  groupFilesLoading: boolean;
  refreshGroups: () => void;
  refreshGroupFiles: () => void;
  createGroup: (name: string, description: string | null, avatarColor: string, memberIds: string[]) => Promise<string>;
  renameGroup: (groupId: string, name: string) => Promise<void>;
  deleteGroup: (groupId: string) => Promise<void>;
  addGroupMember: (groupId: string, userId: string) => Promise<void>;
  removeGroupMember: (groupId: string, userId: string) => Promise<void>;
  fetchGroupMembers: (groupId: string) => Promise<FileHubGroupMember[]>;
  // Activity + tag management
  logActivity: (fileId: string, action: string, metadata?: Record<string, any> | null) => void;
  fileActivity: (fileId: string) => Promise<FileActivity[]>;
  allTagsWithCounts: () => Promise<{ tag: string; count: number }[]>;
  renameTag: (oldTag: string, newTag: string) => Promise<number>;
  deleteTag: (tag: string) => Promise<number>;
};

const FileHubContext = createContext<FileHubContextType | undefined>(undefined);

export function useFileHub() {
  const ctx = useContext(FileHubContext);
  if (!ctx) throw new Error('useFileHub must be used within FileHubProvider');
  return ctx;
}

/**
 * FileHub context where it exists, `null` where it doesn't — for features that
 * work on any file but gain something extra inside FileHub (e.g. sharing: the
 * OS share sheet needs no context, only the share-link fallback does).
 */
export function useFileHubOptional() {
  return useContext(FileHubContext) ?? null;
}

export function FileHubProvider({ children }: { children: React.ReactNode }) {
  const island = useIsland();
  const { showAlert } = useAlert();
  const [mode, setModeState] = useState<FileHubMode>('overview');
  const [search, setSearchState] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [selectedFolderId, setSelectedFolderIdState] = useState<string | null>(null);
  const [selectedTag, setSelectedTagState] = useState<string | null>(null);
  const [files, setFiles] = useState<FileHubFile[]>([]);
  const [folders, setFolders] = useState<FileHubFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [inboxUnreadCount, setInboxUnreadCount] = useState(0);
  // Bin state
  const [binFiles, setBinFiles] = useState<FileHubFile[]>([]);
  const [binLoading, setBinLoading] = useState(false);
  // Groups state
  const [groups, setGroups] = useState<FileHubGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [channelOverrideMode, setChannelOverrideMode] = useState(false);
  const [activeGroupId, setActiveGroupIdState] = useState<string | null>(null);
  const [groupFiles, setGroupFiles] = useState<FileHubFile[]>([]);
  const [groupFilesLoading, setGroupFilesLoading] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  // Feature C — cross-source search: task submission + brief files matching the
  // query. FileHub's own rows keep coming from rpc_filehub_list unchanged.
  const [taskResults, setTaskResults] = useState<CrossSearchResult[]>([]);
  useEffect(() => {
    if (!searchDebounced.trim()) { setTaskResults([]); return; }
    let cancelled = false;
    supabase.rpc('rpc_files_search', {
      p_query: searchDebounced,
      p_sources: ['submission', 'task_brief'],
      p_limit: 25,
    }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) { console.error('[FileHub] cross search error', error); return; }
      setTaskResults((data as CrossSearchResult[]) || []);
    });
    return () => { cancelled = true; };
  }, [searchDebounced]);

  const setMode = useCallback((m: FileHubMode) => {
    setModeState(m);
    setSelectedFolderIdState(null);
    setSelectedTagState(null);
    if (m !== 'groups') setActiveGroupIdState(null);
  }, []);

  const setSearch = useCallback((s: string) => setSearchState(s), []);
  const setSelectedFolderId = useCallback((id: string | null) => setSelectedFolderIdState(id), []);
  const setSelectedTag = useCallback((tag: string | null) => setSelectedTagState(tag), []);
  const setActiveGroupId = useCallback((id: string | null) => {
    setActiveGroupIdState(id);
    if (id) recordChannelVisit(id); // feeds the Overview "recently visited channels"
  }, []);

  const emitUnreadCount = useCallback((count: number) => {
    // DeviceEventEmitter works on both native and web (react-native-web),
    // unlike the browser-only CustomEvent / window.dispatchEvent which crashes
    // on native ("Property 'CustomEvent' doesn't exist").
    DeviceEventEmitter.emit('filehub:unread-count', { count });
  }, []);

  // ── Inbox / Sent / Broadcast ────────────────────────────────────────────────
  const fetchFiles = useCallback(async () => {
    // Overview/Browse own their data via dedicated RPCs; only Inbox/Sent/Broadcast
    // use rpc_filehub_list (Channels handled separately).
    if (mode === 'groups' || mode === 'overview' || mode === 'browse') return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('rpc_filehub_list', {
        p_mode: mode,
        p_search: searchDebounced || null,
        p_folder_id: selectedFolderId || null,
        p_tag: selectedTag || null,
      });
      if (error) throw error;
      setFiles(data || []);
    } catch (e) {
      console.error('[FileHub] fetch error', e);
    } finally {
      setLoading(false);
    }
  }, [mode, searchDebounced, selectedFolderId, selectedTag]);

  const fetchFolders = useCallback(async () => {
    const { data } = await supabase
      .from('filehub_folders')
      .select('id, name, parent_id, scope, group_id')
      .order('name');
    setFolders(data || []);
  }, []);

  useEffect(() => { fetchFiles(); }, [fetchFiles]);
  useEffect(() => { fetchFolders(); }, [fetchFolders]);
  useEffect(() => {
    if (mode === 'inbox') {
      setInboxUnreadCount(files.filter(f => !f.recipient_state?.read_at).length);
    }
  }, [files, mode]);

  // Real-time: refresh inbox when a new file is sent to the current user
  const fetchFilesRef = useRef(fetchFiles);
  useEffect(() => { fetchFilesRef.current = fetchFiles; }, [fetchFiles]);
  useEffect(() => {
    const channel = freshChannel('filehub-inbox-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'filehub_recipients' },
        () => { fetchFilesRef.current(); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const refresh = useCallback(() => {
    fetchFiles();
    fetchFolders();
  }, [fetchFiles, fetchFolders]);

  // ── Groups ──────────────────────────────────────────────────────────────────
  const fetchGroups = useCallback(async () => {
    setGroupsLoading(true);
    try {
      const { data, error } = await supabase.rpc('rpc_filehub_group_list', { p_override: channelOverrideMode });
      if (error) throw error;
      setGroups(data || []);
    } catch (e) {
      console.error('[FileHub] groups fetch error', e);
    } finally {
      setGroupsLoading(false);
    }
  }, [channelOverrideMode]);

  const fetchGroupFiles = useCallback(async () => {
    if (!activeGroupId) return;
    setGroupFilesLoading(true);
    try {
      const { data, error } = await supabase.rpc('rpc_filehub_group_list_files', {
        p_group_id: activeGroupId,
        p_search: searchDebounced || null,
        p_tag: selectedTag || null,
      });
      if (error) throw error;
      setGroupFiles(data || []);
    } catch (e) {
      console.error('[FileHub] group files fetch error', e);
    } finally {
      setGroupFilesLoading(false);
    }
  }, [activeGroupId, searchDebounced, selectedTag]);

  useEffect(() => { fetchGroups(); }, [fetchGroups]);
  useEffect(() => {
    if (activeGroupId) fetchGroupFiles();
    else setGroupFiles([]);
  }, [activeGroupId, fetchGroupFiles]);

  const refreshGroups = useCallback(() => { fetchGroups(); }, [fetchGroups]);
  const refreshGroupFiles = useCallback(() => { fetchGroupFiles(); }, [fetchGroupFiles]);

  const createGroup = useCallback(async (
    name: string, description: string | null, avatarColor: string, memberIds: string[]
  ): Promise<string> => {
    const { data, error } = await supabase.rpc('rpc_filehub_group_create', {
      p_name: name,
      p_description: description || null,
      p_avatar_color: avatarColor,
      p_member_ids: memberIds,
    });
    if (error) { showAlert('Error', error.message); throw error; }
    await fetchGroups();
    return data as string;
  }, [fetchGroups]);

  const renameGroup = useCallback(async (groupId: string, name: string) => {
    const { error } = await supabase.rpc('rpc_filehub_group_rename', { p_group_id: groupId, p_name: name });
    if (error) { showAlert('Error', error.message); throw error; }
    await fetchGroups();
  }, [fetchGroups]);

  const deleteGroup = useCallback(async (groupId: string) => {
    const { error } = await supabase.rpc('rpc_filehub_group_delete', { p_group_id: groupId });
    if (error) { showAlert('Error', error.message); throw error; }
    if (activeGroupId === groupId) setActiveGroupIdState(null);
    await fetchGroups();
  }, [fetchGroups, activeGroupId]);

  const addGroupMember = useCallback(async (groupId: string, userId: string) => {
    const { error } = await supabase.rpc('rpc_filehub_group_add_member', {
      p_group_id: groupId, p_user_id: userId,
    });
    if (error) { showAlert('Error', error.message); throw error; }
    await fetchGroups();
  }, [fetchGroups]);

  const removeGroupMember = useCallback(async (groupId: string, userId: string) => {
    const { error } = await supabase.rpc('rpc_filehub_group_remove_member', {
      p_group_id: groupId, p_user_id: userId,
    });
    if (error) { showAlert('Error', error.message); throw error; }
    await fetchGroups();
    if (activeGroupId === groupId) fetchGroupFiles();
  }, [fetchGroups, fetchGroupFiles, activeGroupId]);

  const fetchGroupMembers = useCallback(async (groupId: string): Promise<FileHubGroupMember[]> => {
    const { data, error } = await supabase.rpc('rpc_filehub_group_members', { p_group_id: groupId });
    if (error) throw error;
    return data || [];
  }, []);

  // ── Standard file ops ───────────────────────────────────────────────────────
  const markRead = useCallback(async (fileId: string) => {
    const { error } = await supabase.rpc('rpc_filehub_mark_read', { p_file_id: fileId });
    if (!error) {
      setFiles(prev => prev.map(f => {
        if (f.id !== fileId) return f;
        return {
          ...f,
          recipient_state: {
            read_at: new Date().toISOString(),
            archived_at: f.recipient_state?.archived_at ?? null,
          },
        };
      }));
      setInboxUnreadCount(prev => {
        const next = Math.max(0, prev - 1);
        emitUnreadCount(next);
        return next;
      });
    }
  }, []);

  const markAllRead = useCallback(async () => {
    const now = new Date().toISOString();
    setFiles(prev => prev.map(f => (
      f.recipient_state?.read_at
        ? f
        : { ...f, recipient_state: { read_at: now, archived_at: f.recipient_state?.archived_at ?? null } }
    )));
    setInboxUnreadCount(0);
    emitUnreadCount(0);

    const { error } = await supabase.rpc('rpc_filehub_mark_all_read');
    if (error) {
      showAlert('Error', error.message);
      return;
    }
    refresh();
  }, []);

  const hideFile = useCallback(async (fileId: string) => {
    const { error } = await supabase.rpc('rpc_filehub_recipient_hide', { p_file_id: fileId });
    if (!error) {
      setFiles(prev => prev.filter(f => f.id !== fileId));
      setGroupFiles(prev => prev.filter(f => f.id !== fileId));
    }
  }, []);

  const deleteFile = useCallback(async (fileId: string) => {
    const { error } = await supabase.rpc('rpc_filehub_delete', { p_file_id: fileId });
    if (error) { showAlert('Error', error.message); return; }
    setFiles(prev => prev.filter(f => f.id !== fileId));
    setGroupFiles(prev => prev.filter(f => f.id !== fileId));
  }, []);

  // ── Bin (deleted/hidden files, restorable for 15 days) ─────────────────────
  const fetchBin = useCallback(async () => {
    setBinLoading(true);
    try {
      const { data, error } = await supabase.rpc('rpc_filehub_bin_list');
      if (error) throw error;
      setBinFiles(data || []);
    } catch (e) {
      console.error('[FileHub] bin fetch error', e);
    } finally {
      setBinLoading(false);
    }
  }, []);

  const restoreFromBin = useCallback(async (fileId: string) => {
    const { error } = await supabase.rpc('rpc_filehub_restore', { p_file_id: fileId });
    if (error) { showAlert('Error', error.message); throw error; }
    setBinFiles(prev => prev.filter(f => f.id !== fileId));
    refresh();
  }, [refresh]);

  const restoreFolder = useCallback(async (folderId: string) => {
    const { error } = await supabase.rpc('rpc_filehub_folder_restore', { p_id: folderId });
    if (error) { showAlert('Error', error.message); throw error; }
    setBinFiles(prev => prev.filter(f => f.id !== folderId));
    await fetchFolders();
  }, [fetchFolders]);

  // Instant, permission-gated purge of the whole company Bin (#55) — bypasses
  // the 15-day grace period entirely. Authorization happens server-side (the
  // edge function verifies the caller's own JWT against
  // rpc_filehub_bin_empty_authorize), so this just surfaces whatever it
  // returns; the UI decides whether to show the button at all via
  // hasPermission('filehub:bin_empty').
  const emptyBin = useCallback(async () => {
    const islandId = `filehub-empty-${Date.now()}`;
    // Publish the progress island immediately (same shape/style as uploads) so
    // it's visible even if the Bin modal is closed while purging.
    island.publish({
      id: islandId,
      kind: 'upload',
      icon: 'trash',
      accent: 'danger',
      compactLabel: '0%',
      progress: 0,
      pulse: true,
      title: 'Emptying Bin',
      subtitle: 'starting…',
    });

    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) {
      island.update(islandId, { title: 'Emptying Bin failed', subtitle: 'Not signed in', accent: 'danger', progress: null, pulse: false });
      setTimeout(() => island.remove(islandId), 4000);
      throw new Error('Not signed in');
    }

    let result = { files_deleted: 0, folders_deleted: 0 };
    try {
      const resp = await fetch(`${supabaseUrl}/functions/v1/purge-filehub-bin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ mode: 'instant' }),
      });

      if (!resp.ok) {
        let msg = `Purge failed (${resp.status})`;
        try { const j = await resp.json(); msg = j?.error ?? msg; } catch { /* keep */ }
        throw new Error(msg);
      }

      let total = 0;
      const applyEvent = (evt: any) => {
        if (evt.type === 'start') {
          total = evt.total ?? 0;
          island.update(islandId, { subtitle: total > 0 ? `0 / ${total}` : 'nothing to purge' }, { bump: false });
        } else if (evt.type === 'progress' || evt.type === 'done') {
          const done = (evt.files_deleted ?? 0) + (evt.folders_deleted ?? 0);
          const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 100;
          island.update(islandId, {
            compactLabel: `${pct}%`,
            progress: pct,
            subtitle: total > 0 ? `${done} / ${total}` : `${done} purged`,
          }, { bump: false });
          if (evt.type === 'done') result = { files_deleted: evt.files_deleted ?? 0, folders_deleted: evt.folders_deleted ?? 0 };
        } else if (evt.type === 'error') {
          throw new Error(evt.error ?? 'Purge failed');
        }
      };

      // Web supports incremental streaming (live progress). React Native's
      // fetch has no ReadableStream reader, so there we read the fully-buffered
      // NDJSON body once and apply every line — same result, no live ticks.
      if (resp.body && typeof (resp.body as any).getReader === 'function') {
        const reader = (resp.body as any).getReader();
        const decoder = new TextDecoder();
        let buf = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (line) applyEvent(JSON.parse(line));
          }
        }
        if (buf.trim()) applyEvent(JSON.parse(buf.trim()));
      } else {
        const text = await resp.text();
        for (const line of text.split('\n')) {
          const t = line.trim();
          if (t) applyEvent(JSON.parse(t));
        }
      }

      const totalDeleted = result.files_deleted + result.folders_deleted;
      island.update(islandId, {
        title: 'Bin emptied',
        subtitle: `${totalDeleted} item${totalDeleted === 1 ? '' : 's'} permanently deleted`,
        accent: 'success',
        icon: 'check',
        progress: 100,
        pulse: false,
      }, { bump: true });
      setTimeout(() => island.remove(islandId), 4000);
    } catch (e: any) {
      island.update(islandId, { title: 'Emptying Bin failed', subtitle: e?.message ?? 'Unknown error', accent: 'danger', progress: null, pulse: false }, { bump: true });
      setTimeout(() => island.remove(islandId), 6000);
      throw e;
    }

    setBinFiles([]);
    await fetchFolders();
    return result;
  }, [island, fetchFolders]);

  const createFolder = useCallback(async (name: string, parentId?: string | null, scope: FileHubFolderScope = 'direct', groupId?: string | null) => {
    const { error } = await supabase.rpc('rpc_filehub_folder_create', {
      p_name: name,
      p_parent_id: parentId || null,
      p_scope: scope,
      p_group_id: groupId || null,
    });
    if (error) { showAlert('Error', error.message); return; }
    await fetchFolders();
  }, [fetchFolders]);

  const renameFolder = useCallback(async (id: string, name: string) => {
    const { error } = await supabase.rpc('rpc_filehub_folder_rename', { p_id: id, p_name: name });
    if (error) { showAlert('Error', error.message); return; }
    await fetchFolders();
  }, [fetchFolders]);

  const deleteFolder = useCallback(async (id: string) => {
    const { error } = await supabase.rpc('rpc_filehub_folder_delete', { p_id: id });
    if (error) { showAlert('Error', error.message); return; }
    setSelectedFolderIdState(prev => (prev === id ? null : prev));
    await fetchFolders();
  }, [fetchFolders]);

  const moveFolder = useCallback(async (id: string, newParentId: string | null) => {
    const { error } = await supabase.rpc('rpc_filehub_folder_move', { p_id: id, p_new_parent_id: newParentId });
    if (error) { showAlert('Error', error.message); return; }
    await fetchFolders();
  }, [fetchFolders]);

  const moveFile = useCallback(async (fileId: string, folderId: string | null) => {
    const { error } = await supabase.rpc('rpc_filehub_file_move', { p_file_id: fileId, p_folder_id: folderId });
    if (error) { showAlert('Error', error.message); return; }
    refresh();
    fetchGroupFiles();
  }, [refresh, fetchGroupFiles]);

  const tagSuggestions = useCallback(async (prefix: string): Promise<string[]> => {
    const { data } = await supabase.rpc('rpc_filehub_tag_suggestions', {
      p_prefix: prefix || null,
      p_limit: 12,
    });
    return data || [];
  }, []);

  const checkDuplicate = useCallback(async (hash: string, folderId: string | null): Promise<any[]> => {
    const { data } = await supabase.rpc('rpc_filehub_check_duplicate', { p_content_hash: hash, p_folder_id: folderId });
    return data || [];
  }, []);

  // ── Versioning ────────────────────────────────────────────────────────────────
  const checkNameConflict = useCallback(async (
    name: string,
    visibility: 'direct' | 'broadcast' | 'group',
    groupId: string | null,
    folderId: string | null
  ): Promise<any | null> => {
    const { data, error } = await supabase.rpc('rpc_filehub_check_name_conflict', {
      p_name: name,
      p_visibility: visibility,
      p_group_id: groupId,
      p_folder_id: folderId,
    });
    if (error) { showAlert('Error', error.message); throw error; }
    return data ?? null;
  }, []);

  const replaceFile = useCallback(async (
    targetId: string,
    args: { storagePath: string; size: number; hash: string | null; mime: string | null; caption?: string | null }
  ): Promise<void> => {
    const { error } = await supabase.rpc('rpc_filehub_replace_file', {
      p_target_id: targetId,
      p_storage_path: args.storagePath,
      p_size_bytes: args.size,
      p_content_hash: args.hash,
      p_mime_type: args.mime,
      p_caption: args.caption ?? null,
    });
    if (error) { showAlert('Error', error.message); throw error; }
    refresh();
    fetchGroupFiles();
  }, [refresh, fetchGroupFiles]);

  const fileVersions = useCallback(async (fileId: string): Promise<FileVersion[]> => {
    const { data, error } = await supabase.rpc('rpc_filehub_file_versions', { p_file_id: fileId });
    if (error) { showAlert('Error', error.message); throw error; }
    return data || [];
  }, []);

  const restoreVersion = useCallback(async (versionId: string): Promise<void> => {
    const { error } = await supabase.rpc('rpc_filehub_restore_version', { p_version_id: versionId });
    if (error) { showAlert('Error', error.message); throw error; }
    refresh();
    fetchGroupFiles();
  }, [refresh, fetchGroupFiles]);

  const pinVersion = useCallback(async (versionId: string, pinned: boolean): Promise<void> => {
    const { error } = await supabase.rpc('rpc_filehub_pin_version', { p_version_id: versionId, p_pinned: pinned });
    if (error) { showAlert('Error', error.message); throw error; }
  }, []);

  const createShareLink = useCallback(async (fileId: string, expiresInHours: number): Promise<FileHubShareLink> => {
    const { data, error } = await supabase.rpc('rpc_filehub_share_link_create', {
      p_file_id: fileId,
      p_expires_in_hours: expiresInHours,
    });
    if (error) { showAlert('Error', error.message); throw error; }
    return { ...(data as { id: string; token: string; expires_at: string }), created_at: new Date().toISOString(), revoked_at: null, view_count: 0, last_viewed_at: null };
  }, []);

  const revokeShareLink = useCallback(async (id: string): Promise<void> => {
    const { error } = await supabase.rpc('rpc_filehub_share_link_revoke', { p_id: id });
    if (error) { showAlert('Error', error.message); throw error; }
  }, []);

  const listShareLinks = useCallback(async (fileId: string): Promise<FileHubShareLink[]> => {
    const { data, error } = await supabase.rpc('rpc_filehub_share_link_list', { p_file_id: fileId });
    if (error) { showAlert('Error', error.message); throw error; }
    return data || [];
  }, []);

  const createFolderShareLink = useCallback(async (folderId: string, expiresInHours: number): Promise<FileHubShareLink> => {
    const { data, error } = await supabase.rpc('rpc_filehub_folder_share_link_create', {
      p_folder_id: folderId,
      p_expires_in_hours: expiresInHours,
    });
    if (error) { showAlert('Error', error.message); throw error; }
    return { ...(data as { id: string; token: string; expires_at: string }), created_at: new Date().toISOString(), revoked_at: null, view_count: 0, last_viewed_at: null };
  }, []);

  const listFolderShareLinks = useCallback(async (folderId: string): Promise<FileHubShareLink[]> => {
    const { data, error } = await supabase.rpc('rpc_filehub_folder_share_link_list', { p_folder_id: folderId });
    if (error) { showAlert('Error', error.message); throw error; }
    return data || [];
  }, []);

  const logActivity = useCallback((fileId: string, action: string, metadata?: Record<string, any> | null) => {
    supabase.rpc('rpc_filehub_log_activity', {
      p_file_id: fileId,
      p_action: action,
      p_metadata: metadata ?? null,
    }).then(() => {}, () => {});
  }, []);

  const fileActivity = useCallback(async (fileId: string): Promise<FileActivity[]> => {
    const { data } = await supabase.rpc('rpc_filehub_file_activity', { p_file_id: fileId });
    return data || [];
  }, []);

  const allTagsWithCounts = useCallback(async (): Promise<{ tag: string; count: number }[]> => {
    const { data } = await supabase.rpc('rpc_filehub_all_tags');
    return (data || []).map((r: any) => ({ tag: r.tag, count: r.count }));
  }, []);

  const renameTag = useCallback(async (oldTag: string, newTag: string): Promise<number> => {
    const { data, error } = await supabase.rpc('rpc_filehub_rename_tag', { p_old: oldTag, p_new: newTag });
    if (error) { showAlert('Error', error.message); throw error; }
    return data as number;
  }, []);

  const deleteTag = useCallback(async (tag: string): Promise<number> => {
    const { data, error } = await supabase.rpc('rpc_filehub_delete_tag', { p_tag: tag });
    if (error) { showAlert('Error', error.message); throw error; }
    return data as number;
  }, []);

  return (
    <FileHubContext.Provider value={{
      mode, setMode,
      search, searchDebounced, setSearch,
      taskResults,
      selectedFolderId, setSelectedFolderId,
      selectedTag, setSelectedTag,
      files, folders, loading,
      inboxUnreadCount,
      refresh,
      refreshFolders: fetchFolders,
      markRead, markAllRead, hideFile, deleteFile,
      binFiles, binLoading, fetchBin, restoreFromBin, restoreFolder, emptyBin,
      createFolder, renameFolder, deleteFolder, moveFolder, moveFile,
      tagSuggestions, checkDuplicate,
      checkNameConflict, replaceFile, fileVersions, restoreVersion, pinVersion,
      createShareLink, revokeShareLink, listShareLinks,
      createFolderShareLink, listFolderShareLinks,
      groups, groupsLoading,
      channelOverrideMode, setChannelOverrideMode,
      activeGroupId, setActiveGroupId,
      groupFiles, groupFilesLoading,
      refreshGroups, refreshGroupFiles,
      createGroup, renameGroup, deleteGroup, addGroupMember, removeGroupMember, fetchGroupMembers,
      logActivity, fileActivity, allTagsWithCounts, renameTag, deleteTag,
    }}>
      {children}
    </FileHubContext.Provider>
  );
}
