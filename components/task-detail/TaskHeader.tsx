import React from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View, Platform } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import { useTaskDetail } from '@/contexts/TaskDetailContext';
import { useTimer } from '@/contexts/TimerContext';
import { useAuth } from '@/contexts/AuthContext';
import { splitStageActions, TYPE_STYLES } from './actionRegistry';
import ConfirmModal from '@/components/common/ConfirmModal';
import ManualTimeModal from '@/components/common/ManualTimeModal';
import { supabase } from '@/lib/supabase';

const PRIORITY_MAP: Record<string, { color: string; label: string }> = {
  urgent: { color: '#ef4444', label: 'URGENT' },
  high:   { color: '#f59e0b', label: 'HIGH' },
  medium: { color: '#94a3b8', label: 'NORMAL' },
  low:    { color: '#22c55e', label: 'LOW' },
};

export default function TaskHeader() {
  const { data, executeAction } = useTaskDetail();
  const { isActive, activeSession, startWork, stopWork } = useTimer();
  const { hasPermission, profile } = useAuth();
  const [busy, setBusy] = React.useState(false);
  const [loadingActionId, setLoadingActionId] = React.useState<string | null>(null);
  const [errorMsg, setErrorMsg] = React.useState<{ title: string; message: string } | null>(null);
  const [showArchiveConfirm, setShowArchiveConfirm] = React.useState(false);
  const [archiving, setArchiving] = React.useState(false);
  const [showManualTimeModal, setShowManualTimeModal] = React.useState(false);
  const [pendingAction, setPendingAction] = React.useState<any | null>(null);
  const router = useRouter();

  const handleArchive = async () => {
    if (!data) return;
    try {
      setArchiving(true);
      const { error } = await supabase.rpc('rpc_archive_task', { p_task_id: data.task.id });
      if (error) throw error;
      setShowArchiveConfirm(false);
      router.replace('/(tabs)/tasks' as any);
    } catch (err: any) {
      setShowArchiveConfirm(false);
      setErrorMsg({ title: 'Archival Failed', message: err.message || 'Could not archive task.' });
      setTimeout(() => setErrorMsg(null), 10000);
    } finally {
      setArchiving(false);
    }
  };

  if (!data) return null;

  const { task, current_stage } = data;
  const prio = PRIORITY_MAP[task.priority] || PRIORITY_MAP.medium;
  const canArchive = data.permissions.is_owner || hasPermission('archive:create') || hasPermission('pipeline.edit');

  const handleBack = () => {
    if (data.pipeline?.id) {
      router.replace(`/(tabs)/tasks?pipelineId=${data.pipeline.id}` as any);
    } else if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/tasks' as any);
    }
  };

  const actionable = data.stage_actions.filter((a) => a.can_perform && a.precondition_met);
  const { buttons: buttonActions } = splitStageActions(actionable);

  const handleAction = async (action: any) => {
    try {
      setLoadingActionId(action.id);

      if (activeSession?.task_id === data.task.id) {
        await stopWork();
      }

      await executeAction(action.id);
    } catch (err: any) {
      if (err.message?.includes('LOW_TIMER_TIME')) {
        setPendingAction(action);
        setShowManualTimeModal(true);
        return;
      }

      let displayMessage = err.message || 'Could not perform action';

      // Handle P0001 error for missing evidence/submissions
      if (err.code === 'P0001' && err.message?.includes('Mandatory evidence missing')) {
        displayMessage = 'This stage requires a submission with text or attachments to proceed.';
      }

      setErrorMsg({
        title: 'Action Failed',
        message: displayMessage
      });

      // Auto-clear error after 5 seconds
      setTimeout(() => setErrorMsg(null), 5000);
    } finally {
      setLoadingActionId(null);
    }
  };

  const handleManualTimeSuccess = async (isFlagged: boolean) => {
    setShowManualTimeModal(false);
    if (isFlagged) {
      setErrorMsg({ title: 'Declaration Flagged', message: 'Your time declaration has been flagged for manager review. The task will proceed.' });
      setTimeout(() => setErrorMsg(null), 6000);
    }
    if (pendingAction) {
      const action = pendingAction;
      setPendingAction(null);
      try {
        setLoadingActionId(action.id);
        await executeAction(action.id);
      } catch (err: any) {
        setErrorMsg({ title: 'Action Failed', message: err.message || 'Could not perform action' });
        setTimeout(() => setErrorMsg(null), 5000);
      } finally {
        setLoadingActionId(null);
      }
    }
  };

  return (
    <View className="px-5 pt-12 pb-4 bg-surface-card border-b border-surface-border">
      {/* Top row: back + badges */}
      <View className="flex-row items-center mb-3">
        <TouchableOpacity
          onPress={handleBack}
          className="mr-4 bg-surface-background p-2 rounded-xl border border-surface-border active:opacity-50"
        >
          <FontAwesome name="chevron-left" size={16} color="#94a3b8" />
        </TouchableOpacity>

        <View className="flex-1 flex-row items-center flex-wrap gap-2">
          {/* Priority badge */}
          <View className="bg-surface-background px-2 py-0.5 rounded-md border border-surface-border">
            <Text style={{ color: prio.color }} className="text-[9px] font-black uppercase tracking-tighter">
              {prio.label}
            </Text>
          </View>

          {/* Stage badge */}
          {current_stage && (
            <View className="flex-row items-center bg-brand-primary/10 px-2.5 py-0.5 rounded-full border border-brand-primary/30">
              <View style={{ backgroundColor: current_stage.color || '#6366f1' }} className="w-1.5 h-1.5 rounded-full mr-1.5" />
              <Text className="text-brand-primary text-[9px] font-black uppercase tracking-wider">
                {current_stage.name}
              </Text>
            </View>
          )}

          {/* Sub-task badge */}
          {task.parent_task_id && (
            <View className="bg-brand-primary/20 px-1.5 py-0.5 rounded-sm">
              <Text className="text-brand-primary text-[8px] font-black italic">SUB-TASK</Text>
            </View>
          )}

          {/* Error state badge */}
          {task.error_state && (
            <View className="bg-state-danger/10 px-2 py-0.5 rounded-md border border-state-danger/30">
              <Text className="text-state-danger text-[8px] font-black uppercase">{task.error_state}</Text>
            </View>
          )}
        </View>
      </View>

      {/* Title & Actions Row */}
      <View className="flex-row items-center justify-between mt-1">
        <View className="flex-1 mr-4">
          <Text className="text-typography-main text-2xl font-black tracking-tight">
            {task.title}
          </Text>
          {/* Muted info row */}
          <View className="flex-row items-center gap-4 mt-1">
            {task.category && (
              <Text className="text-typography-dim text-[10px] font-bold uppercase tracking-wider">{task.category}</Text>
            )}
            {data.pipeline && (
              <Text className="text-typography-dim text-[10px] font-bold">
                <FontAwesome name="code-fork" size={9} color="#64748b" /> {data.pipeline.name}
              </Text>
            )}
          </View>
        </View>

        {/* Stage Actions Buttons (Swapped from middle) */}
        <View className="flex-row items-center gap-2">
          {buttonActions.map((a) => {
            const style = TYPE_STYLES[a.style] || TYPE_STYLES.neutral;
            const isLoading = loadingActionId === a.id;

            return (
              <TouchableOpacity
                key={a.id}
                disabled={isLoading}
                onPress={() => handleAction(a)}
                className={`flex-row items-center px-4 py-2 rounded-xl border ${style.bg} ${style.border} ${isLoading ? 'opacity-50' : ''}`}
              >
                {isLoading ? (
                  <ActivityIndicator size="small" color="rgb(var(--brand-primary))" />
                ) : (
                  <>
                    <FontAwesome name={(a.icon as any) || style.icon} size={10} color={undefined} />
                    <Text className={`${style.text} text-[10px] font-black uppercase tracking-wider ml-2`}>{a.label}</Text>
                  </>
                )}
              </TouchableOpacity>
            );
          })}

          {canArchive && (
            <TouchableOpacity
              onPress={() => setShowArchiveConfirm(true)}
              disabled={archiving}
              className={`flex-row items-center px-4 py-2 rounded-xl border border-surface-border bg-surface-overlay ${archiving ? 'opacity-50' : ''}`}
            >
              {archiving ? (
                <ActivityIndicator size="small" color="rgb(var(--text-muted))" />
              ) : (
                <>
                  <FontAwesome name="archive" size={10} color="rgb(var(--text-muted))" />
                  <Text className="text-typography-muted text-[10px] font-black uppercase tracking-wider ml-2">Archive</Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Error Message Display */}
      {errorMsg && (
        <View className="mt-3 bg-state-danger/10 border border-state-danger/30 rounded-xl p-3">
          <Text className="text-state-danger font-black text-xs uppercase tracking-wider mb-1">
            {errorMsg.title}
          </Text>
          <Text className="text-state-danger text-sm leading-5">
            {errorMsg.message}
          </Text>
        </View>
      )}

      <ConfirmModal
        visible={showArchiveConfirm}
        onCancel={() => setShowArchiveConfirm(false)}
        onConfirm={handleArchive}
        title="Move to Cold Storage"
        description="This will snapshot all task data and remove it from the active pipeline. The archive can be inspected or restored from Intelligence > Archives."
        confirmLabel={archiving ? 'Archiving...' : 'Archive Task'}
        variant="danger"
        loading={archiving}
      />

      <ManualTimeModal
        visible={showManualTimeModal}
        taskId={data.task.id}
        stageId={data.current_stage?.id ?? ''}
        onSuccess={(isFlagged) => handleManualTimeSuccess(isFlagged)}
        onCancel={() => {
          setShowManualTimeModal(false);
          setPendingAction(null);
        }}
      />
    </View>
  );
}
