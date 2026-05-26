import { supabase } from '@/lib/supabase';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Alert } from 'react-native';

export type FileHubMode = 'inbox' | 'sent' | 'broadcast';

export type FileHubFile = {
  id: string;
  original_name: string;
  mime_type: string | null;
  size_bytes: number;
  caption: string | null;
  visibility: 'direct' | 'broadcast';
  folder_id: string | null;
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

type FileHubContextType = {
  mode: FileHubMode;
  setMode: (m: FileHubMode) => void;
  search: string;
  setSearch: (s: string) => void;
  selectedFolderId: string | null;
  setSelectedFolderId: (id: string | null) => void;
  selectedTag: string | null;
  setSelectedTag: (tag: string | null) => void;
  files: FileHubFile[];
  folders: FileHubFolder[];
  loading: boolean;
  refresh: () => void;
  markRead: (fileId: string) => Promise<void>;
  hideFile: (fileId: string) => Promise<void>;
  deleteFile: (fileId: string) => Promise<void>;
  createFolder: (name: string) => Promise<void>;
  renameFolder: (id: string, name: string) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  tagSuggestions: (prefix: string) => Promise<string[]>;
  checkDuplicate: (hash: string) => Promise<any[]>;
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

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  const setMode = useCallback((m: FileHubMode) => {
    setModeState(m);
    setSelectedFolderIdState(null);
    setSelectedTagState(null);
  }, []);

  const setSearch = useCallback((s: string) => setSearchState(s), []);
  const setSelectedFolderId = useCallback((id: string | null) => setSelectedFolderIdState(id), []);
  const setSelectedTag = useCallback((tag: string | null) => setSelectedTagState(tag), []);

  const fetchFiles = useCallback(async () => {
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

  const refresh = useCallback(() => {
    fetchFiles();
    fetchFolders();
  }, [fetchFiles, fetchFolders]);

  const markRead = useCallback(async (fileId: string) => {
    const { error } = await supabase.rpc('rpc_filehub_mark_read', { p_file_id: fileId });
    if (!error) {
      setFiles(prev => prev.map(f =>
        f.id === fileId
          ? { ...f, recipient_state: { read_at: new Date().toISOString(), archived_at: f.recipient_state?.archived_at ?? null } }
          : f
      ));
    }
  }, []);

  const hideFile = useCallback(async (fileId: string) => {
    const { error } = await supabase.rpc('rpc_filehub_recipient_hide', { p_file_id: fileId });
    if (!error) setFiles(prev => prev.filter(f => f.id !== fileId));
  }, []);

  const deleteFile = useCallback(async (fileId: string) => {
    const { error } = await supabase.rpc('rpc_filehub_delete', { p_file_id: fileId });
    if (error) { Alert.alert('Error', error.message); return; }
    setFiles(prev => prev.filter(f => f.id !== fileId));
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

  return (
    <FileHubContext.Provider value={{
      mode, setMode,
      search, setSearch,
      selectedFolderId, setSelectedFolderId,
      selectedTag, setSelectedTag,
      files, folders, loading,
      refresh,
      markRead, hideFile, deleteFile,
      createFolder, renameFolder, deleteFolder,
      tagSuggestions, checkDuplicate,
    }}>
      {children}
    </FileHubContext.Provider>
  );
}
