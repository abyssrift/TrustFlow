import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useTimer } from '@/contexts/TimerContext';
import { useElapsedTime } from '@/hooks/useElapsedTime';
import { supabase } from '@/lib/supabase';
import { getAccentColor, getPrimaryColor } from '@/lib/themeColors';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Alert, Text, TouchableOpacity, View } from 'react-native';
import { isComplexActionType } from './actionRegistry';
import ConfirmModal from '@/components/common/ConfirmModal';
import ManualTimeModal from '@/components/common/ManualTimeModal';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Types ────────────────────────────────────────────────────
export type ActiveSessionUser = {
  userId: string;
  name: string;
  avatar: string | null;
  startedAt: string;
};

export type StageAction = {
  id: string;
  stage_id: string;
  action_type: string;
  label: string;
  icon: string | null;
  style: string;
  required_role: string;
  requires_timer: boolean;
  position: number;
  transition_id: string | null;
};

type Stage = {
  id: string;
  name: string;
  color: string;
  position: number;
  requires_timer?: boolean;
  is_initial?: boolean;
  is_terminal?: boolean;
  terminal_type?: string | null;
  linked_pipeline_id?: string | null;
  linked_pipeline?: { name: string } | null;
};

type Task = {
  id: string;
  title: string;
  current_stage_id: string;
  assignments?: {
    assignee_user_id: string | null;
    assignee_team_id: string | null;
    user?: { full_name: string } | null;
  }[];
};

type Props = {
  task: Task;
  stages: Stage[];
  stageActions: StageAction[];
  activeSessions: Record<string, ActiveSessionUser[]>;
  userId: string;
  onRefresh: () => void;
};

// ─── Style Map ────────────────────────────────────────────────
const ACTION_STYLES: Record<string, { bg: string; border: string; text: string }> = {
  success: { bg: 'bg-state-success/10', border: 'border-state-success/30', text: 'text-state-success' },
  warning: { bg: 'bg-state-warning/10', border: 'border-state-warning/30', text: 'text-state-warning' },
  danger:  { bg: 'bg-state-danger/10',  border: 'border-state-danger/30',  text: 'text-state-danger' },
  neutral: { bg: 'bg-surface-overlay',  border: 'border-surface-border',   text: 'text-typography-main' },
  primary: { bg: 'bg-brand-primary/10', border: 'border-brand-primary/30', text: 'text-brand-primary' },
};


// ─── Component ────────────────────────────────────────────────
export default function TaskCardActions({ task, stages, stageActions, activeSessions, userId, onRefresh }: Props) {
  const router = useRouter();
  const { theme: activeTheme } = useTheme();
  const { hasPermission, profile } = useAuth();
  const { startWork } = useTimer();
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [needsTimerActionId, setNeedsTimerActionId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<{ title: string; message: string; variant?: 'danger' | 'warning' } | null>(null);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [showManualTimeModal, setShowManualTimeModal] = useState(false);
  const [pendingAction, setPendingAction] = useState<StageAction | null>(null);

  // ─── Derived State ───────────────────────────────────────
  const isAssignedToUser = (task.assignments || []).some(a => a.assignee_user_id !== null);
  const isMyTask = (task.assignments || []).some(a => a.assignee_user_id === userId);
  const currentStage = stages.find(s => s.id === task.current_stage_id);
  const stageRequiresTimer = currentStage?.requires_timer ?? false;
  const isInitialStage = currentStage?.is_initial ?? false;
  const isTerminal = currentStage?.is_terminal ?? false;
  const terminalType = currentStage?.terminal_type;
  const hasLinkedPipeline = !!currentStage?.linked_pipeline_id;
  const linkedPipelineName = currentStage?.linked_pipeline?.name || 'Sub-Pipeline';

  // Session detection — match on userId
  const taskSessions = activeSessions[task.id] || [];
  const mySession = taskSessions.find(s => s.userId === userId);
  const isTimerActive = !!mySession;

  // Live counter for the active session (mine or someone else's — whichever is first)
  const activeSession = mySession || taskSessions[0] || null;
  const elapsedDisplay = useElapsedTime(activeSession?.startedAt ?? null);

  // Available actions for the current stage (exclude inactive)
  const availableActions = stageActions
    .filter(a => a.stage_id === task.current_stage_id)
    .filter(a => (a as any).is_active !== false)
    .filter(a => {
      if (!a.required_role || a.required_role === 'any') return true;
      return hasPermission(a.required_role);
    })
    .sort((a, b) => a.position - b.position);

  // ─── Handlers ────────────────────────────────────────────

  // Execute a stage action via RPC
  const handleExecuteAction = async (action: StageAction) => {
    // Complex actions → navigate to task details page
    if (['submit_work', 'review_approve', 'review_revise', 'review_reject'].includes(action.action_type)) {
      router.push(`/task/${task.id}`);
      return;
    }

    setNeedsTimerActionId(null);
    setLoadingAction(action.id);
    try {
      const { error } = await supabase.rpc('rpc_execute_stage_action', {
        p_task_id: task.id,
        p_action_id: action.id,
        p_payload: {}, // Use 3-arg overload to ensure correct dispatching
      });
      if (error) {
        if (error.code === 'PGRST202' || error.message?.includes('not found') || error.message?.includes('Could not find')) {
          throw new Error('Backend function missing. Please ensure database migrations are applied.');
        }
        // Handle P0001 error for missing evidence
        if (error.code === 'P0001' && error.message?.includes('Mandatory evidence missing')) {
          throw new Error('This stage requires a submission with text or attachments to proceed.');
        }
        // Timer enforcement: show inline prompt instead of generic alert
        if (error.message?.includes('running work session is required')) {
          setNeedsTimerActionId(action.id);
          return;
        }
        // Smart timer minimum time check
        if (error.message?.includes('LOW_TIMER_TIME')) {
          setPendingAction(action);
          setShowManualTimeModal(true);
          return;
        }
        throw error;
      }
      onRefresh();
    } catch (err: any) {
      let displayMessage = err.message || 'Could not execute action.';
      
      // Handle P0001 error for missing evidence
      if (err.code === 'P0001' && err.message?.includes('Mandatory evidence missing')) {
        displayMessage = 'This stage requires a submission with text or attachments to proceed.';
      }
      
      setErrorMsg({
        title: 'Action Error',
        message: displayMessage
      });
      
      // Auto-clear after 5 seconds
      setTimeout(() => setErrorMsg(null), 5000);
    } finally {
      setLoadingAction(null);
    }
  };

  // Fallback advance handler (when no actions configured on non-terminal stage)
  const handleFallbackAdvance = async () => {
    const currentIndex = stages.findIndex(s => s.id === task.current_stage_id);
    if (currentIndex === -1 || currentIndex === stages.length - 1) {
      Alert.alert('Info', 'This task is already in the final stage.');
      return;
    }
    const nextStage = stages[currentIndex + 1];
    setLoadingAction('__advance__');
    try {
      const { error } = await supabase.rpc('rpc_advance_stage', {
        p_task_id: task.id,
        p_to_stage_id: nextStage.id,
      });
      if (error) throw error;
      onRefresh();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not advance task.');
    } finally {
      setLoadingAction(null);
    }
  };

  // Start timer
  const handleStartTimer = async () => {
    setLoadingAction('__timer__');
    try {
      await startWork(task.id, task.title ?? '');
      onRefresh();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not start work session.');
    } finally {
      setLoadingAction(null);
    }
  };

  // Claim task (only for timer-required stages)
  const handleClaim = async () => {
    setLoadingAction('__claim__');
    try {
      const { error } = await supabase.rpc('rpc_claim_task', { p_task_id: task.id });
      if (error) {
         if (error.message?.includes('already claimed') || error.code === 'P0001') {
            throw new Error('This task is already claimed. Please refresh the board.');
         }
         throw error;
      }
      onRefresh();
    } catch (err: any) {
      Alert.alert('Claim Error', err.message || 'Could not claim task.');
    } finally {
      setLoadingAction(null);
    }
  };

  // Archival logic with cooldown
  const handleArchive = async () => {
    try {
      const lastArchived = await AsyncStorage.getItem('last_archival_at');
      const now = Date.now();
      if (lastArchived && now - parseInt(lastArchived) < 35000) {
        const remaining = Math.ceil((35000 - (now - parseInt(lastArchived))) / 1000);
        setErrorMsg({
          title: 'Sync Cooldown',
          message: `Network synchronization in progress. Please wait ${remaining}s for cross-platform safety.`
        });
        setTimeout(() => setErrorMsg(null), 3000);
        return;
      }

      setLoadingAction('__archive__');
      const { error } = await supabase.rpc('rpc_archive_task', { p_task_id: task.id });
      if (error) throw error;
      
      await AsyncStorage.setItem('last_archival_at', now.toString());
      onRefresh();
    } catch (err: any) {
      setErrorMsg({ title: 'Archival Failed', message: err.message || 'Could not archive task.' });
    } finally {
      setLoadingAction(null);
      setShowArchiveConfirm(false);
    }
  };

  // Retry pending action after manual time declared
  const handleManualTimeSuccess = async (isFlagged: boolean) => {
    setShowManualTimeModal(false);
    const actionToRetry = pendingAction;
    setPendingAction(null);
    if (isFlagged) {
      setErrorMsg({
        title: 'Entry Flagged for Review',
        message: 'Your time declaration has been forwarded to your manager. Proceeding with transition.',
        variant: 'warning',
      });
      setTimeout(() => setErrorMsg(null), 5000);
    }
    if (actionToRetry) {
      await handleExecuteAction(actionToRetry);
    }
  };

  // ─── Live Timer Badge (shared between states) ──────────────
  const renderTimerBadge = (label?: string) => {
    if (!activeSession) return null;
    return (
      <View className="flex-row items-center mb-2">
        <View className="bg-state-success/10 border border-state-success/30 px-3 py-1 rounded-full flex-row items-center">
          <View className="w-2 h-2 rounded-full bg-state-success mr-2" />
          <Text className="text-state-success text-sm font-black tracking-wide">{elapsedDisplay}</Text>
          {label && <Text className="text-state-success/70 text-[10px] font-bold ml-2 uppercase">{label}</Text>}
        </View>
      </View>
    );
  };

  // ─── STATE: Linked Pipeline (Sub-task Spawn) ────────────────
  if (hasLinkedPipeline) {
    return (
      <TouchableOpacity
        onPress={() => {
          if (currentStage.linked_pipeline_id) {
            AsyncStorage.setItem('@TrustFlow_tasks_pipeline', currentStage.linked_pipeline_id);
            router.push({
               pathname: '/(tabs)',
               params: { pipelineId: currentStage.linked_pipeline_id }
            } as any);
          }
        }}
        className="bg-brand-primary/10 py-2.5 rounded-xl border border-brand-primary/30 items-center justify-center flex-row"
      >
        <FontAwesome name="bolt" size={12} color="var(--color-primary)" />
        <Text className="text-brand-primary font-black text-[10px] uppercase tracking-widest ml-2">
          Navigate to {linkedPipelineName}
        </Text>
      </TouchableOpacity>
    );
  }

  // ─── STATE: Terminal Stage ──────────────────────────────────
  if (isTerminal) {
    const isSuccess = terminalType === 'success';
    const canArchive = profile?.is_owner || hasPermission('archive:create') || hasPermission('pipeline.edit');
    return (
      <View>
        <View className={`py-2.5 rounded-xl items-center justify-center border ${isSuccess ? 'bg-state-success/10 border-state-success/20' : 'bg-state-danger/10 border-state-danger/20'}`}>
          <View className="flex-row items-center">
            <FontAwesome name={isSuccess ? 'check-circle' : 'times-circle'} size={12} color={isSuccess ? 'var(--color-success)' : 'var(--color-danger)'} />
            <Text className={`${isSuccess ? 'text-state-success' : 'text-state-danger'} font-black text-[10px] uppercase tracking-widest ml-2`}>
              {isSuccess ? 'Completed' : 'Failed'}
            </Text>
          </View>
        </View>
        
        {canArchive && (
          <TouchableOpacity
            onPress={() => setShowArchiveConfirm(true)}
            className="mt-2 bg-surface-overlay py-2.5 rounded-xl border border-surface-border items-center justify-center flex-row"
          >
            <FontAwesome name="archive" size={10} className="text-typography-muted" />
            <Text className="text-typography-muted font-black text-[10px] uppercase tracking-widest ml-2">Archive Task</Text>
          </TouchableOpacity>
        )}

        <ConfirmModal
          visible={showArchiveConfirm}
          onCancel={() => setShowArchiveConfirm(false)}
          onConfirm={handleArchive}
          title="Snapshot Confirmation"
          description="Are you certain you want to move this task to Cold Storage? This will snapshot all telemetry and clear it from the active board."
          confirmLabel={loadingAction === '__archive__' ? 'Syncing...' : 'Archive Task'}
          variant="danger"
          loading={loadingAction === '__archive__'}
        />
      </View>
    );
  }

  // ─── STATE: Timer Required + Unassigned → Claim Task ────────
  if (stageRequiresTimer && !isAssignedToUser) {
    return (
      <TouchableOpacity
        onPress={handleClaim}
        disabled={loadingAction === '__claim__'}
        className={`bg-brand-primary/10 py-2.5 rounded-xl border border-brand-primary/20 items-center justify-center flex-row ${loadingAction === '__claim__' ? 'opacity-50' : ''}`}
       >
         {loadingAction === '__claim__' ? (
           <ActivityIndicator size="small" color={getPrimaryColor(activeTheme)} />
         ) : (
           <>
             <FontAwesome name="user-plus" size={12} color={getPrimaryColor(activeTheme)} />
             <Text className="text-brand-primary font-black text-[10px] uppercase tracking-widest ml-2">Claim Task</Text>
           </>
         )}
       </TouchableOpacity>
    );
  }

  // ─── STATE: Assigned to someone else ────────────────────────
  // Only bail out if the current user has no actions — reviewers with
  // review_approve/review_revise/review_reject must still see their buttons.
  if (isAssignedToUser && !isMyTask && availableActions.length === 0) {
    const assigneeName = task.assignments?.[0]?.user?.full_name || 'Another user';
    return (
      <View>
        {taskSessions.length > 0 && renderTimerBadge(assigneeName)}
        <View className="bg-surface-overlay py-2.5 rounded-xl border border-surface-border items-center justify-center">
          <Text className="text-typography-muted font-bold text-[10px] uppercase tracking-widest">
            In Progress by {assigneeName}
          </Text>
        </View>
      </View>
    );
  }

  // ─── STATE: My task + Timer required + No active session ────
  if (isMyTask && stageRequiresTimer && !isTimerActive) {
    return (
      <TouchableOpacity
        onPress={handleStartTimer}
        disabled={loadingAction === '__timer__'}
        className={`bg-state-warning/10 py-2.5 rounded-xl border border-state-warning/20 items-center justify-center flex-row ${loadingAction === '__timer__' ? 'opacity-50' : ''}`}
       >
         {loadingAction === '__timer__' ? (
           <ActivityIndicator size="small" color={getAccentColor(activeTheme)} />
         ) : (
           <>
             <FontAwesome name="play" size={10} color={getAccentColor(activeTheme)} />
             <Text className="text-state-warning font-black text-[10px] uppercase tracking-widest ml-2">Start Timer</Text>
           </>
         )}
       </TouchableOpacity>
    );
  }

  // ─── STATE: Ready for Action Buttons ────────────────────────
  // This covers:
  //   - My task + timer running → shows timer + actions
  //   - My task + no timer required → shows actions directly
  //   - Unassigned + non-timer stage → shows actions (anyone can act)

  // No actions configured — fallback advance
  if (availableActions.length === 0) {
    return (
      <View>
        {isTimerActive && renderTimerBadge()}
        {hasPermission('task.update') && (
          <TouchableOpacity
            onPress={handleFallbackAdvance}
            disabled={loadingAction === '__advance__'}
            className={`bg-brand-primary py-2.5 rounded-xl items-center justify-center flex-row ${loadingAction === '__advance__' ? 'opacity-50' : ''}`}
          >
            {loadingAction === '__advance__' ? (
              <ActivityIndicator size="small" color="rgb(var(--text-main))" />
            ) : (
              <>
                <Text className="text-typography-main font-black text-[10px] uppercase tracking-widest mr-2">Advance</Text>
                <FontAwesome name="chevron-right" size={10} color="rgb(var(--text-main))" />
              </>
            )}
          </TouchableOpacity>
        )}
      </View>
    );
  }

  // Render action buttons — all actions shown (conditional branching)
  return (
    <View>
      {isTimerActive && renderTimerBadge()}

      {/* Error / Warning Message Display */}
      {errorMsg && (
        <View className={`mb-2 rounded-xl p-3 ${
          errorMsg.variant === 'warning'
            ? 'bg-state-warning/10 border border-state-warning/30'
            : 'bg-state-danger/10 border border-state-danger/30'
        }`}>
          <Text className={`font-black text-xs uppercase tracking-wider mb-1 ${
            errorMsg.variant === 'warning' ? 'text-state-warning' : 'text-state-danger'
          }`}>
            {errorMsg.title}
          </Text>
          <Text className={`text-sm leading-5 ${
            errorMsg.variant === 'warning' ? 'text-state-warning' : 'text-state-danger'
          }`}>
            {errorMsg.message}
          </Text>
        </View>
      )}

      {/* Inline timer prompt if backend rejected action due to missing session */}
      {needsTimerActionId && (
        <TouchableOpacity
          onPress={handleStartTimer}
          disabled={loadingAction === '__timer__'}
          className={`mb-2 bg-state-warning/10 py-2 rounded-xl border border-state-warning/30 items-center justify-center flex-row gap-2 ${loadingAction === '__timer__' ? 'opacity-50' : ''}`}
        >
          {loadingAction === '__timer__' ? (
            <ActivityIndicator size="small" color={getAccentColor(activeTheme)} />
          ) : (
            <>
              <FontAwesome name="clock-o" size={10} color={getAccentColor(activeTheme)} />
              <Text className="text-state-warning font-black text-[10px] uppercase tracking-widest">Start Timer to Proceed</Text>
            </>
          )}
        </TouchableOpacity>
      )}

      <View className="flex-row gap-2 flex-wrap">
        {availableActions.map((action) => {
          const style = ACTION_STYLES[action.style] || ACTION_STYLES.neutral;
          const isLoading = loadingAction === action.id;

          // Disable if this specific action (or its stage) requires a timer and none is running.
          // IMPORTANT: Timer requirements are ignored for initial stages.
          const effectiveRequiresTimer = (action.requires_timer || stageRequiresTimer) && !isInitialStage;
          const actionNeedsTimer = effectiveRequiresTimer && !isTimerActive;
          const isComplex = isComplexActionType(action.action_type);
          const isNeedsTimerPending = needsTimerActionId === action.id;

          return (
            <TouchableOpacity
              key={action.id}
              onPress={() => handleExecuteAction(action)}
              disabled={isLoading || actionNeedsTimer}
              className={`flex-1 min-w-[30%] py-2.5 rounded-xl items-center justify-center border ${
                isNeedsTimerPending
                  ? 'bg-state-warning/10 border-state-warning/40'
                  : `${style.bg} ${style.border}`
              } ${(isLoading || actionNeedsTimer) ? 'opacity-40' : ''}`}
            >
              {isLoading ? (
                <ActivityIndicator size="small" color={getPrimaryColor(activeTheme)} />
              ) : (
                <View className="flex-row items-center justify-center">
                  {isComplex && <FontAwesome name="external-link" size={8} color="rgb(var(--text-main))" style={{ marginRight: 4, opacity: 0.7 }} />}
                  <Text className={`${
                    isNeedsTimerPending ? 'text-state-warning' : style.text
                  } font-black text-[10px] uppercase tracking-widest text-center`} numberOfLines={1}>
                    {actionNeedsTimer ? '🔒 ' : ''}{action.label}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      <ManualTimeModal
        visible={showManualTimeModal}
        taskId={task.id}
        stageId={task.current_stage_id}
        onSuccess={handleManualTimeSuccess}
        onCancel={() => { setShowManualTimeModal(false); setPendingAction(null); }}
      />
    </View>
  );
}
