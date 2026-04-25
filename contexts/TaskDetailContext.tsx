import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from './AuthContext';
import { RealtimeChannel } from '@supabase/supabase-js';

// ─── Types ────────────────────────────────────────────
type UserRef = { id: string; full_name: string | null; avatar_url: string | null; email?: string } | null;
type TeamRef = { id: string; name: string; color: string | null } | null;

export type TaskData = {
  id: string; title: string; description: string | null; status: string;
  priority: string; category: string | null; due_date: string | null;
  progress: number; weight: number; is_recurring: boolean;
  parent_task_id: string | null; error_state: string | null;
  quarantine_reason: any; created_at: string; updated_at: string; completed_at: string | null;
};

export type StageData = {
  id: string; name: string; color: string | null; position: number;
  is_initial: boolean; is_terminal: boolean; terminal_type: string | null;
  features?: string[];
  requires_submission: boolean;
  requires_timer: boolean;
};

export type TransitionData = {
  id: string; to_stage_id: string; to_stage_name: string; to_stage_color: string | null;
  label: string; transition_type: string; required_permission: string | null;
};

export type StageActionData = {
  id: string; action_type: string; label: string; icon: string | null;
  style: 'success' | 'warning' | 'danger' | 'neutral' | 'primary';
  required_role: string; precondition: string | null;
  transition_id: string | null; position: number;
  can_perform: boolean; precondition_met: boolean;
  requires_timer: boolean;
  execution_route?: 'generic' | 'submit_work' | 'review_submission';
  ui_slot?: 'button' | 'submission' | 'review';
};

// ─── Action Registry Logic ─────────────────────────────
export * from '@/components/task-detail/actionRegistry';
import { getActionDescriptor, splitStageActions, isComplexActionType } from '@/components/task-detail/actionRegistry';


export type AssignmentData = { id: string; user: UserRef; team: TeamRef; assigned_at: string };
export type StageHistoryData = {
  id: string; from_stage_name: string | null; to_stage_name: string;
  transitioned_by: { full_name: string | null; avatar_url: string | null } | null;
  transitioned_at: string; is_reversal: boolean; submission_id: string | null;
};

export type SubmissionData = {
  id: string; content: string | null; status: string; revision_count: number;
  submitted_by: UserRef; reviewed_by: UserRef;
  review_notes: string | null; submitted_at: string; reviewed_at: string | null;
  stage_name: string | null;
  attachments: { id: string; file_name: string; file_url: string; mime_type: string | null }[];
};

export type CommentData = {
  id: string; content: string; parent_id: string | null; is_system: boolean;
  author: UserRef; created_at: string;
};

export type WorkSessionData = {
  id: string; user_name: string | null; user_id: string; status: string;
  total_seconds_spent: number; started_at: string;
};

export type ActivityData = {
  id: string; event_type: string; user_name: string | null;
  metadata: any; created_at: string;
};

export type StatsData = {
  total_transitions: number; approval_count: number; revision_count: number;
  rejection_count: number; pending_count: number;
  total_time_spent_seconds: number; days_in_pipeline: number;
};

export type PermissionsData = {
  can_edit: boolean; can_assign: boolean; can_submit: boolean;
  can_review: boolean; can_view_history: boolean; can_comment: boolean;
  can_advance: boolean; can_delete: boolean;
  is_owner: boolean; is_assigned: boolean; is_manager: boolean; is_creator: boolean;
};

export type TaskDetailPayload = {
  task: TaskData;
  pipeline: { id: string; name: string; description: string | null } | null;
  current_stage: StageData | null;
  all_stages: StageData[];
  available_transitions: TransitionData[];
  stage_actions: StageActionData[];
  creator: UserRef;
  manager: UserRef;
  assignments: AssignmentData[];
  stage_history: StageHistoryData[];
  submissions: SubmissionData[];
  comments: CommentData[];
  work_sessions: WorkSessionData[];
  activity: ActivityData[];
  stats: StatsData;
  permissions: PermissionsData;
};

type TaskDetailContextType = {
  data: TaskDetailPayload | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  executeAction: (actionId: string) => Promise<void>;
  submitWork: (content: string) => Promise<void>;
  addComment: (content: string, parentId?: string | null) => Promise<void>;
  deleteComment: (commentId: string) => Promise<void>;
  advanceStage: (toStageId: string) => Promise<void>;
  reviewSubmission: (submissionId: string, decision: string, notes?: string, advanceStageId?: string) => Promise<void>;
};

const TaskDetailContext = createContext<TaskDetailContextType>({
  data: null, loading: true, error: null,
  refresh: async () => {}, executeAction: async () => {},
  submitWork: async () => {},
  addComment: async () => {}, deleteComment: async () => {},
  advanceStage: async () => {}, reviewSubmission: async () => {},
});

export const useTaskDetail = () => useContext(TaskDetailContext);

export const TaskDetailProvider = ({ taskId, children }: { taskId: string; children: React.ReactNode }) => {
  const [data, setData] = useState<TaskDetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const channelsRef = useRef<RealtimeChannel[]>([]);
  const { user } = useAuth();

  // ─── Fetch ──────────────────────────────────────
  const fetchDetails = useCallback(async () => {
    try {
      setError(null);
      const { data: result, error: rpcError } = await supabase.rpc('rpc_get_task_details', { p_task_id: taskId });
      if (rpcError) throw rpcError;
      if (!result) {
        setError('ACCESS_DENIED');
        setData(null);
        return;
      }
      setData(result as TaskDetailPayload);
    } catch (err: any) {
      console.error('[TaskDetail] Fetch error:', err);
      setError(err.message || 'Failed to load task details');
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  // ─── Actions ────────────────────────────────────
  const executeAction = useCallback(async (actionId: string) => {
    const { error: rpcError } = await supabase.rpc('rpc_execute_stage_action', {
      p_task_id: taskId, 
      p_action_id: actionId,
    });
    if (rpcError) throw rpcError;
    await fetchDetails();
  }, [taskId, fetchDetails]);

  const submitWork = useCallback(async (content: string) => {
    const { error } = await supabase.rpc('rpc_submit_work', { p_task_id: taskId, p_content: content });
    if (error) throw error;
    // Realtime will patch, but also do a full refresh for stats
    await fetchDetails();
  }, [taskId, fetchDetails]);

  const addComment = useCallback(async (content: string, parentId?: string | null) => {
    const { error } = await supabase.rpc('rpc_add_task_comment', {
      p_task_id: taskId, p_content: content, p_parent_id: parentId || null,
    });
    if (error) throw error;
    // Realtime will deliver the new comment
  }, [taskId]);

  const deleteComment = useCallback(async (commentId: string) => {
    const { error } = await supabase.rpc('rpc_delete_task_comment', { p_comment_id: commentId });
    if (error) throw error;
    // Remove from local state immediately
    setData(prev => prev ? {
      ...prev,
      comments: prev.comments.filter(c => c.id !== commentId),
    } : null);
  }, []);

  const advanceStage = useCallback(async (toStageId: string) => {
    const { error } = await supabase.rpc('rpc_advance_stage', { p_task_id: taskId, p_to_stage_id: toStageId });
    if (error) throw error;
    await fetchDetails();
  }, [taskId, fetchDetails]);

  const reviewSubmission = useCallback(async (submissionId: string, decision: string, notes?: string, advanceStageId?: string) => {
    const { error } = await supabase.rpc('rpc_review_submission', {
      p_submission_id: submissionId, p_decision: decision,
      p_notes: notes || null, p_advance_stage_id: advanceStageId || null,
    });
    if (error) throw error;
    await fetchDetails();
  }, [fetchDetails]);

  // ─── Realtime ───────────────────────────────────
  useEffect(() => {
    fetchDetails();

    // Channel 1: Comments
    const commentChannel = supabase
      .channel(`task-comments-${taskId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'task_comments',
        filter: `task_id=eq.${taskId}`,
      }, (payload) => {
        const newComment = payload.new as any;
        // Fetch author info for the new comment
        supabase.from('users').select('id, full_name, avatar_url').eq('id', newComment.author_id).single()
          .then(({ data: author }) => {
            const comment: CommentData = {
              id: newComment.id, content: newComment.content,
              parent_id: newComment.parent_id, is_system: newComment.is_system,
              author: author || null, created_at: newComment.created_at,
            };
            setData(prev => prev ? {
              ...prev,
              comments: [...prev.comments, comment],
            } : null);
          });
      })
      .subscribe();

    // Channel 2: Submissions
    const submissionChannel = supabase
      .channel(`task-submissions-${taskId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'task_submissions',
        filter: `task_id=eq.${taskId}`,
      }, () => {
        // Full refresh on any submission change (new submission or review)
        fetchDetails();
      })
      .subscribe();

    // Channel 3: Stage history
    const historyChannel = supabase
      .channel(`task-history-${taskId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'pipeline_stage_history',
        filter: `task_id=eq.${taskId}`,
      }, () => {
        // Full refresh on stage change
        fetchDetails();
      })
      .subscribe();

    // Channel 4: Task Metadata
    const taskChannel = supabase
      .channel(`task-metadata-${taskId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'tasks',
        filter: `id=eq.${taskId}`,
      }, () => {
        // Full refresh on metadata update
        fetchDetails();
      })
      .subscribe();

    channelsRef.current = [commentChannel, submissionChannel, historyChannel, taskChannel];

    return () => {
      channelsRef.current.forEach(ch => supabase.removeChannel(ch));
      channelsRef.current = [];
    };
  }, [taskId, fetchDetails]);

  return (
    <TaskDetailContext.Provider value={{
      data, loading, error, refresh: fetchDetails,
      executeAction, submitWork, addComment, deleteComment, advanceStage, reviewSubmission,
    }}>
      {children}
    </TaskDetailContext.Provider>
  );
};
