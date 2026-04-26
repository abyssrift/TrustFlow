import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { useAuth } from './AuthContext';

export type TaskDraft = {
  title: string;
  description: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  category: string;
  weight: number;
  dueDate: string | null;
  pipelineId: string | null;
  assigneeUserIds: string[];
  assigneeTeamIds: string[];
  visibilityPermission: string | null;
};

const INITIAL_DRAFT: TaskDraft = {
  title: '',
  description: '',
  priority: 'normal',
  category: 'General',
  weight: 1,
  dueDate: null,
  pipelineId: null,
  assigneeUserIds: [],
  assigneeTeamIds: [],
  visibilityPermission: null,
};

type TaskCreationContextType = {
  draft: TaskDraft;
  setDraft: (draft: Partial<TaskDraft>) => void;
  resetDraft: () => void;
  recentTasks: any[];
  loadRecentTasks: () => Promise<void>;
  createTask: () => Promise<string | null>;
  loading: boolean;
};

const TaskCreationContext = createContext<TaskCreationContextType | null>(null);

export const useTaskCreation = () => {
  const ctx = useContext(TaskCreationContext);
  if (!ctx) throw new Error('useTaskCreation must be used within TaskCreationProvider');
  return ctx;
};

const STORAGE_KEY = 'newTrustFlow_task_draft';

export const TaskCreationProvider = ({ children }: { children: React.ReactNode }) => {
  const { user } = useAuth();
  const [draft, setDraftState] = useState<TaskDraft>(INITIAL_DRAFT);
  const [recentTasks, setRecentTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // Load draft on mount
  useEffect(() => {
    const loadDraft = async () => {
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEY);
        if (saved) {
          setDraftState(JSON.parse(saved));
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
    setDraftState(prev => ({ ...prev, ...updates }));
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
      // 1. Create the task
      const { data: taskId, error } = await supabase.rpc('rpc_create_task', {
        p_title: draft.title,
        p_description: draft.description,
        p_priority: draft.priority,
        p_due_date: draft.dueDate,
        p_category: draft.category,
        p_weight: draft.weight,
        p_pipeline_id: draft.pipelineId,
        p_visibility_permission: draft.visibilityPermission
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

      await resetDraft();
      await loadRecentTasks();
      return taskId;
    } catch (err) {
      console.error('Creation error:', err);
      return null;
    } finally {
      setLoading(false);
    }
  };

  return (
    <TaskCreationContext.Provider value={{
      draft,
      setDraft,
      resetDraft,
      recentTasks,
      loadRecentTasks,
      createTask,
      loading
    }}>
      {children}
    </TaskCreationContext.Provider>
  );
};
