import { supabase } from '@/lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';
import { useStagedFileLifecycle } from '@/hooks/useStagedFileLifecycle';
import { useUploadManager, type UploadResult } from './UploadManagerContext';

export type TaskDraft = {
  title: string;
  description: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  category: string;
  weight: number;
  startDate: string | null;
  dueDate: string | null;
  estimatedHours: number | null;
  pipelineId: string | null;
  projectId: string | null;
  assigneeUserIds: string[];
  assigneeTeamIds: string[];
};

const INITIAL_DRAFT: TaskDraft = {
  title: '',
  description: '',
  priority: 'normal',
  category: 'General',
  weight: 1,
  startDate: null,
  dueDate: null,
  estimatedHours: null,
  pipelineId: null,
  projectId: null,
  assigneeUserIds: [],
  assigneeTeamIds: [],
};

export type StagedBriefFile = {
  id: string; uri: string; name: string; size: number; type: string;
};

async function stagedFileToUpload(file: StagedBriefFile): Promise<File> {
  const blob = await (await fetch(file.uri)).blob();
  return new File([blob], file.name, { type: file.type || blob.type || 'application/octet-stream' });
}

type TaskCreationContextType = {
  draft: TaskDraft;
  setDraft: (draft: Partial<TaskDraft>) => void;
  toggleTeamAssignee: (teamId: string) => void;
  loadTeamMembers: () => Promise<void>;
  resetDraft: () => void;
  recentTasks: any[];
  loadRecentTasks: () => Promise<void>;
  createTask: () => Promise<string | null>;
  createBulkTasks: (titles: string[]) => Promise<number>;
  loading: boolean;
  briefFiles: StagedBriefFile[];
  setBriefFiles: React.Dispatch<React.SetStateAction<StagedBriefFile[]>>;
};

const TaskCreationContext = createContext<TaskCreationContextType | null>(null);

export const useTaskCreation = () => {
  const ctx = useContext(TaskCreationContext);
  if (!ctx) throw new Error('useTaskCreation must be used within TaskCreationProvider');
  return ctx;
};

const DRAFT_STORAGE_PREFIX = 'newTrustFlow_task_draft';

/**
 * Drafts contain company-owned IDs (pipelines, projects, assignees), so a
 * single browser-wide key can leak stale references across users or
 * companies. Return no key until both identity boundaries are known.
 */
export function taskDraftStorageKey(
  userId: string | null | undefined,
  companyId: string | null | undefined,
): string | null {
  if (!userId || !companyId) return null;
  return `${DRAFT_STORAGE_PREFIX}:${userId}:${companyId}`;
}

const normalizeDraft = (draft: Partial<TaskDraft> | null | undefined): TaskDraft => {
  const merged = { ...INITIAL_DRAFT, ...(draft || {}) };
  const priority = merged.priority === 'low' || merged.priority === 'normal' || merged.priority === 'high' || merged.priority === 'urgent'
    ? merged.priority
    : 'normal';

  return {
    title: merged.title ?? '',
    description: merged.description ?? '',
    priority,
    category: merged.category ?? 'General',
    weight: Number.isFinite(merged.weight) ? Math.min(10, Math.max(1, Math.round(merged.weight))) : 1,
    startDate: merged.startDate ?? null,
    dueDate: merged.dueDate ?? null,
    estimatedHours: merged.estimatedHours ?? null,
    pipelineId: merged.pipelineId ?? null,
    projectId: merged.projectId ?? null,
    assigneeUserIds: Array.isArray(merged.assigneeUserIds) ? merged.assigneeUserIds : [],
    assigneeTeamIds: Array.isArray(merged.assigneeTeamIds) ? merged.assigneeTeamIds : [],
  };
};

export const TaskCreationProvider = ({ children }: { children: React.ReactNode }) => {
  const { user, profile } = useAuth();
  const { successToast, errorToast, infoToast } = useToast();
  const { startUpload, waitForUpload } = useUploadManager();
  const [draft, setDraftState] = useState<TaskDraft>(INITIAL_DRAFT);
  const [recentTasks, setRecentTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [briefFiles, setBriefFiles] = useState<StagedBriefFile[]>([]);
  const draftKey = taskDraftStorageKey(user?.id, profile?.company_id);
  const hydratedDraftKeyRef = React.useRef<string | null>(null);
  useStagedFileLifecycle(briefFiles);

  // Load only the current user's current-company draft. Cancellation prevents
  // a slower read from the previous identity context from overwriting newer
  // state after a company switch.
  useEffect(() => {
    hydratedDraftKeyRef.current = null;
    setDraftState(INITIAL_DRAFT);
    setBriefFiles([]);
    if (!draftKey) return;

    let cancelled = false;
    const loadDraft = async () => {
      try {
        const saved = await AsyncStorage.getItem(draftKey);
        if (cancelled) return;
        hydratedDraftKeyRef.current = draftKey;
        if (saved) {
          setDraftState(normalizeDraft(JSON.parse(saved)));
        }
      } catch (err) {
        console.error('Failed to load draft:', err);
      }
    };
    loadDraft();
    return () => { cancelled = true; };
  }, [draftKey]);

  // Save draft on change
  useEffect(() => {
    if (!draftKey || hydratedDraftKeyRef.current !== draftKey || draft === INITIAL_DRAFT) return;
    const saveDraft = async () => {
      try {
        await AsyncStorage.setItem(draftKey, JSON.stringify(draft));
      } catch (err) {
        console.error('Failed to save draft:', err);
      }
    };
    saveDraft();
  }, [draft, draftKey]);

  const setDraft = useCallback((updates: Partial<TaskDraft>) => {
    setDraftState(prev => normalizeDraft({ ...prev, ...updates }));
  }, []);

  // Team membership map, preloaded by the create modals on open so team
  // toggles are instant (no fetch on tap). RLS scopes the query to the company.
  const [teamMembers, setTeamMembers] = useState<Record<string, string[]>>({});
  const loadTeamMembers = useCallback(async () => {
    const { data } = await supabase
      .from('team_members')
      .select('team_id, user_id')
      .is('removed_at', null);
    const map: Record<string, string[]> = {};
    (data || []).forEach((m: any) => { (map[m.team_id] = map[m.team_id] || []).push(m.user_id); });
    setTeamMembers(map);
  }, []);

  // Selecting a team also selects its members so the pick is visible in the
  // users list; deselecting removes them unless another still-selected team
  // covers them (manually picked users outside the team are kept).
  const toggleTeamAssignee = useCallback((teamId: string) => {
    const members = teamMembers[teamId] || [];
    if (!draft.assigneeTeamIds.includes(teamId)) {
      setDraft({
        assigneeTeamIds: [...draft.assigneeTeamIds, teamId],
        assigneeUserIds: [...new Set([...draft.assigneeUserIds, ...members])],
      });
    } else {
      const remainingTeams = draft.assigneeTeamIds.filter(t => t !== teamId);
      const covered = new Set(remainingTeams.flatMap(t => teamMembers[t] || []));
      setDraft({
        assigneeTeamIds: remainingTeams,
        assigneeUserIds: draft.assigneeUserIds.filter(u => !members.includes(u) || covered.has(u)),
      });
    }
  }, [teamMembers, draft.assigneeTeamIds, draft.assigneeUserIds, setDraft]);

  const resetDraft = useCallback(async () => {
    setDraftState(INITIAL_DRAFT);
    setBriefFiles([]);
    if (draftKey) await AsyncStorage.removeItem(draftKey);
  }, [draftKey]);

  const loadRecentTasks = useCallback(async () => {
    if (!user) return;
    try {
      const { data } = await supabase
        .from('tasks')
        .select('*, assignments:task_assignments(assignee_user_id, assignee_team_id)')
        .eq('created_by', user.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(10);
      setRecentTasks(data || []);
    } catch (err) {
      console.error('Failed to load recent tasks:', err);
    }
  }, [user]);

  const createTask = async () => {
    if (!draft.title.trim()) return null;
    setLoading(true);
    try {
      const dbPriority = draft.priority === 'normal' ? 'medium' : draft.priority;

      // 1. Create the task
      const { data: taskId, error } = await supabase.rpc('rpc_create_task', {
        p_title: draft.title,
        p_description: draft.description,
        p_priority: dbPriority,
        p_due_date: draft.dueDate,
        p_category: draft.category,
        p_weight: draft.weight,
        p_pipeline_id: draft.pipelineId,
        p_project_id: draft.projectId,
        p_start_date: draft.startDate,
        p_estimated_hours: draft.estimatedHours,
      });

      if (error) throw error;

      // 2. Assign resources if any -- if nobody was picked, let the pipeline's
      // assignment mode (round robin / smart) fill it in; no-ops for manual pipelines.
      if (draft.assigneeUserIds.length > 0 || draft.assigneeTeamIds.length > 0) {
        const { error: assignError } = await supabase.rpc('rpc_update_task_assignments', {
          p_task_id: taskId,
          p_user_ids: draft.assigneeUserIds,
          p_team_ids: draft.assigneeTeamIds
        });
        if (assignError) console.error('Assignment error:', assignError);
      } else {
        const { error: autoAssignError } = await supabase.rpc('rpc_auto_assign_task', {
          p_task_id: taskId
        });
        if (autoAssignError) console.error('Auto-assign error:', autoAssignError);
      }

      // 3. Upload brief files if any
      if (briefFiles.length > 0) {
        try {
          const { data: companyRow } = await supabase.from('users').select('company_id').eq('id', user!.id).single();
          const companyId = companyRow?.company_id;
          if (!companyId) throw new Error('Company not found.');
          const managerFiles = await Promise.all(briefFiles.map(stagedFileToUpload));
          const jobId = startUpload({
            files: managerFiles, companyId, visibility: 'task', folderId: null,
            recipientIds: [], groupId: null, tags: [], caption: null, maxFileSizeBytes: null,
            scopedFolders: [], target: { kind: 'task', taskId }, label: 'Task brief',
          });
          const results = await waitForUpload(jobId);
          const fileRows = await supabase.from('filehub_files').select('id, storage_path, original_name, size_bytes, mime_type').in('id', results.map(r => r.fileId));
          if (fileRows.error) throw fileRows.error;
          const byId = new Map((fileRows.data || []).map(row => [row.id, row]));
          const uploaded = results.map((result: UploadResult) => {
            const row = byId.get(result.fileId);
            const source = briefFiles.find(file => file.name === result.fileName);
            return {
              file_name: source?.name || row?.original_name || result.fileName,
              file_url: row?.storage_path || '', storage_path: row?.storage_path || '',
              file_size: source?.size || row?.size_bytes || 0, mime_type: source?.type || row?.mime_type,
              category: source?.type?.startsWith('image/') ? 'image' : source?.type?.includes('pdf') || source?.type?.includes('word') ? 'document' : source?.type?.includes('sheet') || source?.type?.includes('excel') || source?.type?.includes('csv') ? 'spreadsheet' : 'other',
              filehub_file_id: result.fileId, filehub_file_version_id: result.fileVersionId,
            };
          });
          if (uploaded.length > 0) {
            const { error: rpcErr } = await supabase.rpc('rpc_add_task_attachments', {
              p_task_id: taskId, p_attachments: uploaded,
            });
            if (rpcErr) console.error('Brief attach error:', rpcErr);
          }
        } catch (e) {
          console.error('Brief file upload failed:', e);
        }
        setBriefFiles([]);
      }

      await resetDraft();
      await loadRecentTasks();
      successToast(`Task "${draft.title}" created.`, 'Task created');
      return taskId;
    } catch (err) {
      console.error('Creation error:', err);
      errorToast(err instanceof Error ? err.message : 'Could not create task.');
      return null;
    } finally {
      setLoading(false);
    }
  };

  // Bulk quick-add: create one task per provided title, sharing all of the
  // draft's common fields (pipeline, project, priority, dates, assignees…).
  // Brief-file attachments are a per-task concept and are intentionally skipped
  // here — bulk mode is for rapidly capturing a list of titles.
  const createBulkTasks = async (titles: string[]): Promise<number> => {
    const clean = Array.from(
      new Set(titles.map(t => t.trim()).filter(Boolean))
    );
    if (clean.length === 0) return 0;
    setLoading(true);
    let created = 0;
    try {
      const dbPriority = draft.priority === 'normal' ? 'medium' : draft.priority;
      for (const title of clean) {
        const { data: taskId, error } = await supabase.rpc('rpc_create_task', {
          p_title: title,
          p_description: draft.description,
          p_priority: dbPriority,
          p_due_date: draft.dueDate,
          p_category: draft.category,
          p_weight: draft.weight,
          p_pipeline_id: draft.pipelineId,
          p_project_id: draft.projectId,
          p_start_date: draft.startDate,
          p_estimated_hours: draft.estimatedHours,
        });
        if (error) { console.error('Bulk create error:', error); continue; }

        if (draft.assigneeUserIds.length > 0 || draft.assigneeTeamIds.length > 0) {
          const { error: assignError } = await supabase.rpc('rpc_update_task_assignments', {
            p_task_id: taskId,
            p_user_ids: draft.assigneeUserIds,
            p_team_ids: draft.assigneeTeamIds,
          });
          if (assignError) console.error('Bulk assignment error:', assignError);
        }
        created++;
      }

      await resetDraft();
      await loadRecentTasks();
      if (created > 0) {
        successToast(`Created ${created} task${created === 1 ? '' : 's'}.`, 'Bulk creation');
      }
      if (created < clean.length) {
        errorToast(`${clean.length - created} task${clean.length - created === 1 ? '' : 's'} failed to create.`);
      }
      return created;
    } catch (err) {
      console.error('Bulk creation error:', err);
      errorToast(err instanceof Error ? err.message : 'Could not create tasks.');
      return created;
    } finally {
      setLoading(false);
    }
  };

  return (
    <TaskCreationContext.Provider value={{
      draft, setDraft, toggleTeamAssignee, loadTeamMembers, resetDraft,
      recentTasks, loadRecentTasks,
      createTask, createBulkTasks, loading,
      briefFiles, setBriefFiles,
    }}>
      {children}
    </TaskCreationContext.Provider>
  );
};
