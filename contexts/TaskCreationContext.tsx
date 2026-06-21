import { TASK_BRIEF_BUCKET } from '@/lib/storage';
import { supabase } from '@/lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImageManipulator from 'expo-image-manipulator';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';

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

type TaskCreationContextType = {
  draft: TaskDraft;
  setDraft: (draft: Partial<TaskDraft>) => void;
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

const STORAGE_KEY = 'newTrustFlow_task_draft';

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
    weight: Number.isFinite(merged.weight) && merged.weight > 0 ? merged.weight : 1,
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
  const { user } = useAuth();
  const { successToast, errorToast, infoToast } = useToast();
  const [draft, setDraftState] = useState<TaskDraft>(INITIAL_DRAFT);
  const [recentTasks, setRecentTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [briefFiles, setBriefFiles] = useState<StagedBriefFile[]>([]);

  // Load draft on mount
  useEffect(() => {
    const loadDraft = async () => {
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEY);
        if (saved) {
          setDraftState(normalizeDraft(JSON.parse(saved)));
        }
      } catch (err) {
        console.error('Failed to load draft:', err);
      }
    };
    loadDraft();
  }, []);

  // Save draft on change
  useEffect(() => {
    const saveDraft = async () => {
      try {
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
      } catch (err) {
        console.error('Failed to save draft:', err);
      }
    };
    if (draft !== INITIAL_DRAFT) {
      saveDraft();
    }
  }, [draft]);

  const setDraft = useCallback((updates: Partial<TaskDraft>) => {
    setDraftState(prev => normalizeDraft({ ...prev, ...updates }));
  }, []);

  const resetDraft = useCallback(async () => {
    setDraftState(INITIAL_DRAFT);
    await AsyncStorage.removeItem(STORAGE_KEY);
  }, []);

  const loadRecentTasks = useCallback(async () => {
    if (!user) return;
    try {
      const { data } = await supabase
        .from('tasks')
        .select('*, assignments:task_assignments(assignee_user_id, assignee_team_id)')
        .eq('created_by', user.id)
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

      // 2. Assign resources if any
      if (draft.assigneeUserIds.length > 0 || draft.assigneeTeamIds.length > 0) {
        const { error: assignError } = await supabase.rpc('rpc_update_task_assignments', {
          p_task_id: taskId,
          p_user_ids: draft.assigneeUserIds,
          p_team_ids: draft.assigneeTeamIds
        });
        if (assignError) console.error('Assignment error:', assignError);
      }

      // 3. Upload brief files if any
      if (briefFiles.length > 0) {
        try {
          const { data: companyRow } = await supabase.from('users').select('company_id').eq('id', user!.id).single();
          const companyId = companyRow?.company_id;
          const uploaded: any[] = [];

          for (const file of briefFiles) {
            let finalUri = file.uri;
            if (file.type.startsWith('image/')) {
              try {
                const result = await ImageManipulator.manipulateAsync(
                  file.uri, [{ resize: { width: 2000 } }],
                  { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
                );
                finalUri = result.uri;
              } catch { /* keep original */ }
            }

            const response = await fetch(finalUri);
            const blob = await response.blob();
            const ext = file.name.split('.').pop() || 'bin';
            const path = `${companyId}/tasks/${taskId}/brief/${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`;

            const { data: storageData, error: storageErr } = await supabase.storage
              .from(TASK_BRIEF_BUCKET)
              .upload(path, blob, { contentType: file.type, upsert: true });

            if (storageErr) { console.error('Brief upload error:', storageErr); continue; }

            const cat = file.type.startsWith('image/') ? 'image'
              : file.type.includes('pdf') || file.type.includes('word') ? 'document'
              : file.type.includes('sheet') || file.type.includes('excel') || file.type.includes('csv') ? 'spreadsheet'
              : 'other';

            uploaded.push({
              file_name: file.name, file_url: storageData.path,
              storage_path: storageData.path, file_size: file.size,
              mime_type: file.type, category: cat,
            });
          }

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
      draft, setDraft, resetDraft,
      recentTasks, loadRecentTasks,
      createTask, createBulkTasks, loading,
      briefFiles, setBriefFiles,
    }}>
      {children}
    </TaskCreationContext.Provider>
  );
};
