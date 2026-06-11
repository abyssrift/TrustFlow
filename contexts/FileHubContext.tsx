import { supabase } from '@/lib/supabase';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';

export type FileHubMode = 'inbox' | 'sent' | 'broadcast' | 'groups';

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
};

export type FileHubFolder = {
  id: string;
  name: string;
};

export type FileHubGroup = {
  id: string;
  name: string;
  description: string | null;
  avatar_color: string;
  my_role: 'admin' | 'member';
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
  setSearch: (s: string) => void;
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
  markRead: (fileId: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  hideFile: (fileId: string) => Promise<void>;
  deleteFile: (fileId: string) => Promise<void>;
  createFolder: (name: string) => Promise<void>;
  renameFolder: (id: string, name: string) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  tagSuggestions: (prefix: string) => Promise<string[]>;
  checkDuplicate: (hash: string) => Promise<any[]>;
  // Groups
  groups: FileHubGroup[];
  groupsLoading: boolean;
  activeGroupId: string | null;
  setActiveGroupId: (id: string | null) => void;
  groupFiles: FileHubFile[];
  groupFilesLoading: boolean;
  refreshGroups: () => void;
  refreshGroupFiles: () => void;
  createGroup: (name: string, description: string | null, avatarColor: string, memberIds: string[]) => Promise<string>;
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

export function FileHubProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<FileHubMode>('inbox');
  const [search, setSearchState] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [selectedFolderId, setSelectedFolderIdState] = useState<string | null>(null);
  const [selectedTag, setSelectedTagState] = useState<string | null>(null);
  const [files, setFiles] = useState<FileHubFile[]>([]);
  const [folders, setFolders] = useState<FileHubFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [inboxUnreadCount, setInboxUnreadCount] = useState(0);
  // Groups state
  const [groups, setGroups] = useState<FileHubGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [activeGroupId, setActiveGroupIdState] = useState<string | null>(null);
  const [groupFiles, setGroupFiles] = useState<FileHubFile[]>([]);
  const [groupFilesLoading, setGroupFilesLoading] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  const setMode = useCallback((m: FileHubMode) => {
    setModeState(m);
    setSelectedFolderIdState(null);
    setSelectedTagState(null);
    if (m !== 'groups') setActiveGroupIdState(null);
  }, []);

  const setSearch = useCallback((s: string) => setSearchState(s), []);
  const setSelectedFolderId = useCallback((id: string | null) => setSelectedFolderIdState(id), []);
  const setSelectedTag = useCallback((tag: string | null) => setSelectedTagState(tag), []);
  const setActiveGroupId = useCallback((id: string | null) => setActiveGroupIdState(id), []);

  const emitUnreadCount = useCallback((count: number) => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(
      new CustomEvent('filehub:unread-count', {
        detail: { count },
      })
    );
  }, []);

  // ── Inbox / Sent / Broadcast ────────────────────────────────────────────────
  const fetchFiles = useCallback(async () => {
    if (mode === 'groups') return;
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
      .select('id, name')
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
    const channel = supabase
      .channel('filehub-inbox-realtime')
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
      const { data, error } = await supabase.rpc('rpc_filehub_group_list');
      if (error) throw error;
      setGroups(data || []);
    } catch (e) {
      console.error('[FileHub] groups fetch error', e);
    } finally {
      setGroupsLoading(false);
    }
  }, []);

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
    if (error) { Alert.alert('Error', error.message); throw error; }
    await fetchGroups();
    return data as string;
  }, [fetchGroups]);

  const addGroupMember = useCallback(async (groupId: string, userId: string) => {
    const { error } = await supabase.rpc('rpc_filehub_group_add_member', {
      p_group_id: groupId, p_user_id: userId,
    });
    if (error) { Alert.alert('Error', error.message); throw error; }
    await fetchGroups();
  }, [fetchGroups]);

  const removeGroupMember = useCallback(async (groupId: string, userId: string) => {
    const { error } = await supabase.rpc('rpc_filehub_group_remove_member', {
      p_group_id: groupId, p_user_id: userId,
    });
    if (error) { Alert.alert('Error', error.message); throw error; }
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
      Alert.alert('Error', error.message);
      return;
    }
    refresh();
  }, []);

  const hideFile = useCallback(async (fileId: string) => {
    const { error } = await supabase.rpc('rpc_filehub_recipient_hide', { p_file_id: fileId });
    if (!error) setFiles(prev => prev.filter(f => f.id !== fileId));
  }, []);

  const deleteFile = useCallback(async (fileId: string) => {
    const { error } = await supabase.rpc('rpc_filehub_delete', { p_file_id: fileId });
    if (error) { Alert.alert('Error', error.message); return; }
    setFiles(prev => prev.filter(f => f.id !== fileId));
    setGroupFiles(prev => prev.filter(f => f.id !== fileId));
  }, []);

  const createFolder = useCallback(async (name: string) => {
    const { error } = await supabase.rpc('rpc_filehub_folder_create', { p_name: name });
    if (error) { Alert.alert('Error', error.message); return; }
    await fetchFolders();
  }, [fetchFolders]);

  const renameFolder = useCallback(async (id: string, name: string) => {
    const { error } = await supabase.rpc('rpc_filehub_folder_rename', { p_id: id, p_name: name });
    if (error) { Alert.alert('Error', error.message); return; }
    await fetchFolders();
  }, [fetchFolders]);

  const deleteFolder = useCallback(async (id: string) => {
    const { error } = await supabase.rpc('rpc_filehub_folder_delete', { p_id: id });
    if (error) { Alert.alert('Error', error.message); return; }
    setSelectedFolderIdState(prev => (prev === id ? null : prev));
    await fetchFolders();
  }, [fetchFolders]);

  const tagSuggestions = useCallback(async (prefix: string): Promise<string[]> => {
    const { data } = await supabase.rpc('rpc_filehub_tag_suggestions', {
      p_prefix: prefix || null,
      p_limit: 12,
    });
    return data || [];
  }, []);

  const checkDuplicate = useCallback(async (hash: string): Promise<any[]> => {
    const { data } = await supabase.rpc('rpc_filehub_check_duplicate', { p_content_hash: hash });
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
    if (error) { Alert.alert('Error', error.message); throw error; }
    return data as number;
  }, []);

  const deleteTag = useCallback(async (tag: string): Promise<number> => {
    const { data, error } = await supabase.rpc('rpc_filehub_delete_tag', { p_tag: tag });
    if (error) { Alert.alert('Error', error.message); throw error; }
    return data as number;
  }, []);

  return (
    <FileHubContext.Provider value={{
      mode, setMode,
      search, setSearch,
      selectedFolderId, setSelectedFolderId,
      selectedTag, setSelectedTag,
      files, folders, loading,
      inboxUnreadCount,
      refresh,
      markRead, markAllRead, hideFile, deleteFile,
      createFolder, renameFolder, deleteFolder,
      tagSuggestions, checkDuplicate,
      groups, groupsLoading,
      activeGroupId, setActiveGroupId,
      groupFiles, groupFilesLoading,
      refreshGroups, refreshGroupFiles,
      createGroup, addGroupMember, removeGroupMember, fetchGroupMembers,
      logActivity, fileActivity, allTagsWithCounts, renameTag, deleteTag,
    }}>
      {children}
    </FileHubContext.Provider>
  );
}
