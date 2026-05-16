import { supabase } from '@/lib/supabase';
import { RealtimeChannel } from '@supabase/supabase-js';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useToast } from './ToastContext';

// ─── Types ────────────────────────────────────────────
type UserRef = { id: string; full_name: string | null; avatar_url: string | null; email?: string } | null;
type TeamRef = { id: string; name: string; color: string | null } | null;

export type TaskData = {
  id: string; title: string; description: string | null; status: string;
  priority: string; category: string | null; due_date: string | null;
  progress: number; weight: number; is_recurring: boolean;
  parent_task_id: string | null; error_state: string | null;
  quarantine_reason: any; created_at: string; updated_at: string; completed_at: string | null;
  visibility_permission: string | null; company_id: string;
};

export type StageData = {
  id: string; name: string; color: string | null; position: number;
  is_initial: boolean; is_terminal: boolean; terminal_type: string | null;
  features?: string[];
  requires_submission: boolean;
  requires_timer: boolean;
  min_timer_seconds: number;
  linked_pipeline_id?: string | null;
  linked_pipeline?: { id: string; name: string } | null;
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

export * from '@/components/task-detail/actionRegistry';

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
  attachments: { id: string; file_name: string; file_url: string; mime_type: string | null; category: string | null; file_size: number | null; storage_path: string | null }[];
};

export type TaskAttachmentData = {
  id: string; file_name: string; file_url: string; storage_path: string | null;
  file_size: number | null; mime_type: string | null; category: string | null;
  uploaded_by: UserRef; created_at: string;
};

export type CommentData = {
  id: string; content: string; parent_id: string | null; is_system: boolean;
  author: UserRef; created_at: string;
};

export type WorkSessionData = {
  id: string; user_name: string | null; user_id: string; status: string;
  total_seconds_spent: number; started_at: string; last_heartbeat_at?: string;
  stage_id: string | null;
};

export type ChildTaskData = {
  id: string; title: string; status: string;
  pipeline_name: string | null; stage_name: string | null; stage_color: string | null;
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

export type ManualTimeApprovalEntry = {
  id: string;
  declared_minutes: number;
  reason: string | null;
  flag_reason: string | null;
  logged_at: string;
  approval_status: 'pending' | 'approved' | 'rejected';
  rejection_reason: string | null;
  user: UserRef;
};

export type MyManualTimeEntry = {
  id: string;
  declared_minutes: number;
  is_flagged: boolean;
  approval_status: 'pending' | 'approved' | 'rejected';
  rejection_reason: string | null;
} | null;

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
  child_tasks: ChildTaskData[];
  task_attachments: TaskAttachmentData[];
  pending_time_approvals: ManualTimeApprovalEntry[];
  my_manual_time_entry: MyManualTimeEntry;
};

type TaskDetailContextType = {
  taskId: string;
  data: TaskDetailPayload | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  executeAction: (actionId: string, payload?: any) => Promise<void>;
  submitWork: (content: string, transitionId?: string | null, attachments?: any[]) => Promise<void>;
  addComment: (content: string, parentId?: string | null) => Promise<void>;
  deleteComment: (commentId: string) => Promise<void>;
  advanceStage: (toStageId: string) => Promise<void>;
  reviewSubmission: (submissionId: string, decision: string, notes?: string, advanceStageId?: string) => Promise<void>;
  deleteSubmission: (submissionId: string) => Promise<void>;
  updateTask: (updates: Partial<TaskData>) => Promise<void>;
  reviewManualTime: (entryId: string, approve: boolean, rejectionReason?: string) => Promise<void>;
};

const TaskDetailContext = createContext<TaskDetailContextType | null>(null);

export const useTaskDetail = () => {
  const context = useContext(TaskDetailContext);
  if (!context) throw new Error('useTaskDetail must be used within a TaskDetailProvider');
  return context;
};

export const TaskDetailProvider = ({ taskId, children }: { taskId: string; children: React.ReactNode }) => {
  const { successToast, errorToast, infoToast, warningToast } = useToast();
  const [data, setData] = useState<TaskDetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const channelsRef = useRef<RealtimeChannel[]>([]);

  const fetchDetails = useCallback(async () => {
    try {
      setError(null);
      const [{ data: result, error: rpcError }, { data: childRows }] = await Promise.all([
        supabase.rpc('rpc_get_task_details', { p_task_id: taskId }),
        supabase
          .from('tasks')
          .select(`
            id, title, status, pipeline_id,
            pipeline:pipeline_id(name),
            stage:current_stage_id(name, color)
          `)
          .eq('parent_task_id', taskId)
          .is('deleted_at', null),
      ]);

      if (rpcError) throw rpcError;
      if (!result) {
        setError('ACCESS_DENIED');
        setData(null);
        return;
      }

      const child_tasks: ChildTaskData[] = (childRows || [])
        .filter((r: any) => !r.pipeline_id || r.pipeline)
        .map((r: any) => ({
          id: r.id, title: r.title, status: r.status,
          pipeline_name: r.pipeline?.name ?? null,
          stage_name: r.stage?.name ?? null,
          stage_color: r.stage?.color ?? null,
        }));

      setData({
        ...(result as TaskDetailPayload),
        child_tasks,
        pending_time_approvals: (result as any).pending_time_approvals ?? [],
        my_manual_time_entry: (result as any).my_manual_time_entry ?? null,
      });
    } catch (err: any) {
      console.error('[TaskDetail] Fetch error:', err);
      setError(err.message || 'Failed to load task details');
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  const executeAction = useCallback(async (actionId: string, payload?: any) => {
    try {
      const { error } = await supabase.rpc('rpc_execute_stage_action', {
        p_task_id: taskId, p_action_id: actionId, p_payload: payload ?? {},
      });
      if (error) throw error;
      await fetchDetails();
      successToast('Task action completed.');
    } catch (err: any) {
      errorToast(err.message || 'Could not complete task action.');
      throw err;
    }
  }, [taskId, fetchDetails, successToast, errorToast]);

  const submitWork = useCallback(async (content: string, transitionId?: string | null, attachments: any[] = []) => {
    try {
      const { error } = await supabase.rpc('rpc_submit_work', { 
        p_task_id: taskId, 
        p_content: content, 
        p_transition_id: transitionId || null,
        p_attachments: attachments // Pass attachments to backend
      });
      if (error) throw error;
      await fetchDetails();
      successToast('Submission sent.');
    } catch (err: any) {
      errorToast(err.message || 'Could not submit work.');
      throw err;
    }
  }, [taskId, fetchDetails, successToast, errorToast]);

  const addComment = useCallback(async (content: string, parentId?: string | null) => {
    try {
      const { error } = await supabase.rpc('rpc_add_task_comment', {
        p_task_id: taskId, p_content: content, p_parent_id: parentId || null,
      });
      if (error) throw error;
      infoToast('Comment posted.');
    } catch (err: any) {
      errorToast(err.message || 'Could not add comment.');
      throw err;
    }
  }, [taskId, infoToast, errorToast]);

  const deleteComment = useCallback(async (commentId: string) => {
    try {
      const { error } = await supabase.rpc('rpc_delete_task_comment', { p_comment_id: commentId });
      if (error) throw error;
      setData((prev) => prev ? { ...prev, comments: prev.comments.filter(c => c.id !== commentId) } : null);
      infoToast('Comment deleted.');
    } catch (err: any) {
      errorToast(err.message || 'Could not delete comment.');
      throw err;
    }
  }, [infoToast, errorToast]);

  const advanceStage = useCallback(async (toStageId: string) => {
    try {
      const { error } = await supabase.rpc('rpc_advance_stage', { p_task_id: taskId, p_to_stage_id: toStageId });
      if (error) throw error;
      await fetchDetails();
      successToast('Task advanced.');
    } catch (err: any) {
      errorToast(err.message || 'Could not advance task.');
      throw err;
    }
  }, [taskId, fetchDetails, successToast, errorToast]);

  const reviewSubmission = useCallback(async (submissionId: string, decision: string, notes?: string, advanceStageId?: string) => {
    try {
      const { error } = await supabase.rpc('rpc_review_submission', {
        p_submission_id: submissionId, p_decision: decision,
        p_notes: notes || null, p_advance_stage_id: advanceStageId || null,
      });
      if (error) throw error;
      await fetchDetails();
      successToast(decision === 'approved' ? 'Submission approved.' : decision === 'needs_revision' ? 'Revision requested.' : 'Submission rejected.');
    } catch (err: any) {
      errorToast(err.message || 'Could not review submission.');
      throw err;
    }
  }, [fetchDetails, successToast, errorToast]);

  const deleteSubmission = useCallback(async (submissionId: string) => {
    try {
      const { error } = await supabase.rpc('rpc_delete_submission', { p_submission_id: submissionId });
      if (error) throw error;
      await fetchDetails();
      infoToast('Submission removed.');
    } catch (err: any) {
      errorToast(err.message || 'Could not delete submission.');
      throw err;
    }
  }, [fetchDetails, infoToast, errorToast]);

  const updateTask = useCallback(async (updates: Partial<TaskData>) => {
    try {
      const { error } = await supabase.from('tasks').update(updates).eq('id', taskId);
      if (error) throw error;
      await fetchDetails();
      successToast('Task updated.');
    } catch (err: any) {
      errorToast(err.message || 'Could not update task.');
      throw err;
    }
  }, [taskId, fetchDetails, successToast, errorToast]);

  const reviewManualTime = useCallback(async (entryId: string, approve: boolean, rejectionReason?: string) => {
    try {
      const { error } = await supabase.rpc('rpc_review_manual_time', {
        p_entry_id: entryId,
        p_approve: approve,
        p_rejection_reason: rejectionReason || null,
      });
      if (error) throw error;
      await fetchDetails();
      successToast(approve ? 'Time approved.' : 'Time rejected.');
    } catch (err: any) {
      errorToast(err.message || 'Could not review time entry.');
      throw err;
    }
  }, [fetchDetails, successToast, errorToast]);

  useEffect(() => {
    fetchDetails();
    const commentChannel = supabase.channel(`task-comments-${taskId}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'task_comments', filter: `task_id=eq.${taskId}` }, (payload) => {
      supabase.from('users').select('id, full_name, avatar_url').eq('id', payload.new.author_id).single().then(({ data: author }) => {
        setData(prev => prev ? { ...prev, comments: [...prev.comments, { ...payload.new, author } as any] } : null);
      });
    }).subscribe();

    const subChannel = supabase.channel(`task-subs-${taskId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'task_submissions', filter: `task_id=eq.${taskId}` }, () => fetchDetails()).subscribe();
    const histChannel = supabase.channel(`task-hist-${taskId}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pipeline_stage_history', filter: `task_id=eq.${taskId}` }, () => fetchDetails()).subscribe();
    const metaChannel = supabase.channel(`task-meta-${taskId}`).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tasks', filter: `id=eq.${taskId}` }, () => fetchDetails()).subscribe();
    const workSessionChannel = supabase.channel(`task-sessions-${taskId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'task_work_sessions', filter: `task_id=eq.${taskId}` }, () => fetchDetails()).subscribe();
    const manualTimeChannel = supabase.channel(`task-manual-time-${taskId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'task_manual_time_entries', filter: `task_id=eq.${taskId}` }, () => fetchDetails()).subscribe();

    channelsRef.current = [commentChannel, subChannel, histChannel, metaChannel, workSessionChannel, manualTimeChannel];
    return () => {
      channelsRef.current.forEach(ch => supabase.removeChannel(ch));
    };
  }, [taskId, fetchDetails]);

  return (
    <TaskDetailContext.Provider value={{
      taskId, data, loading, error, refresh: fetchDetails,
      executeAction, submitWork, addComment, deleteComment, advanceStage, reviewSubmission, deleteSubmission, updateTask, reviewManualTime
    }}>
      {children}
    </TaskDetailContext.Provider>
  );
};
