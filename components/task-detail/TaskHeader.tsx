import ConfirmModal from '@/components/common/ConfirmModal';
import ManualTimeModal from '@/components/common/ManualTimeModal';
import { useAuth } from '@/contexts/AuthContext';
import { useTaskDetail } from '@/contexts/TaskDetailContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useTimer } from '@/contexts/TimerContext';
import { useToast } from '@/contexts/ToastContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { supabase } from '@/lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import React from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { cssInterop } from 'react-native-css-interop';
import { splitStageActions, TYPE_STYLES } from './actionRegistry';

cssInterop(FontAwesome, {
  className: {
    target: 'style',
    nativeStyleToProp: { color: true, size: true },
  },
} as any);

const PRIORITY_MAP: Record<string, { textClass: string; label: string }> = {
  urgent: { textClass: 'text-state-danger', label: 'URGENT' },
  high:   { textClass: 'text-state-warning', label: 'HIGH' },
  medium: { textClass: 'text-typography-muted', label: 'NORMAL' },
  low:    { textClass: 'text-state-success', label: 'LOW' },
};

export default function TaskHeader() {
  const { data, executeAction } = useTaskDetail();
  const { isActive, activeSession, startWork, stopWork } = useTimer();
  const { theme: activeTheme } = useTheme();
  const { hasPermission } = useAuth();
  const [busy, setBusy] = React.useState(false);
  const [loadingActionId, setLoadingActionId] = React.useState<string | null>(null);
  const [pingLoading, setPingLoading] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<{ title: string; message: string } | null>(null);
  const [showArchiveConfirm, setShowArchiveConfirm] = React.useState(false);
  const [archiving, setArchiving] = React.useState(false);
  const [showManualTimeModal, setShowManualTimeModal] = React.useState(false);
  const [pendingAction, setPendingAction] = React.useState<any | null>(null);
  const router = useRouter();
  const { successToast, errorToast } = useToast();
  const colors = useThemeColors();

  const handleArchive = async () => {
    if (!data) return;
    try {
      setArchiving(true);
      const { error } = await supabase.rpc('rpc_archive_task', { p_task_id: data.task.id });
      if (error) throw error;
      successToast('Task archived.');
      setShowArchiveConfirm(false);
      router.replace('/(tabs)/tasks' as any);
    } catch (err: any) {
      setShowArchiveConfirm(false);
      setErrorMsg({ title: 'Archival Failed', message: err.message || 'Could not archive task.' });
      errorToast(err.message || 'Could not archive task.');
      setTimeout(() => setErrorMsg(null), 10000);
    } finally {
      setArchiving(false);
    }
  };

  const handlePingTask = async () => {
    if (!data) return;
    try {
      setPingLoading(true);
      const { error } = await supabase.rpc('rpc_ping_task', { p_task_id: data.task.id });
      if (error) throw error;
      successToast('Task pinged! 📢');
    } catch (err: any) {
      errorToast(err.message || 'Could not ping task.');
    } finally {
      setPingLoading(false);
    }
  };

  if (!data) return null;

  const { task, current_stage } = data;
  const prio = PRIORITY_MAP[task.priority?.toLowerCase()] || PRIORITY_MAP.medium;
  const canArchive = data.permissions.is_owner || hasPermission('archive:create') || hasPermission('pipeline.edit');
  const canPing = data.permissions.is_manager || hasPermission('task.ping') || data.permissions.is_owner;

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

  const isMyEntryPending = data.my_manual_time_entry?.approval_status === 'pending';
  const advancementGateLocked =
    isMyEntryPending && data.permissions.is_assigned && !!data.current_stage?.requires_timer;
  const isAdvancementAction = (a: any) =>
    a.action_type === 'advance' || a.action_type === 'custom' || a.action_type === 'start_task';

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
      if (err.message?.includes('TIME_APPROVAL_PENDING')) {
        setErrorMsg({
          title: 'Awaiting Manager Approval',
          message: 'Your time declaration is awaiting manager approval. The stage will advance automatically once approved.',
        });
        setTimeout(() => setErrorMsg(null), 8000);
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

  const handleManualTimeSuccess = async () => {
    setShowManualTimeModal(false);
    setPendingAction(null);
    setErrorMsg({
      title: 'Awaiting Manager Approval',
      message: 'Your time declaration has been sent to your manager. The stage will advance automatically once approved.',
    });
    setTimeout(() => setErrorMsg(null), 8000);
  };

  return (
    <View className="px-5 pt-12 pb-4 bg-surface-card border-b border-surface-border">
      {/* Top row: back + badges */}
      <View className="flex-row items-center mb-3">
        <TouchableOpacity
          onPress={handleBack}
          className="mr-4 bg-surface-background p-2 rounded-xl border border-surface-border active:opacity-50"
        >
          <FontAwesome name="chevron-left" size={16} className="text-typography-muted" />
        </TouchableOpacity>

        <View className="flex-1 flex-row items-center flex-wrap gap-2">
          {/* Priority badge */}
          <View className="bg-surface-background px-2 py-0.5 rounded-md border border-surface-border">
            <Text className={`${prio.textClass} text-[9px] font-black uppercase tracking-tighter`}>
              {prio.label}
            </Text>
          </View>

          {/* Stage badge */}
          {current_stage && (
            <View className="flex-row items-center bg-brand-primary/10 px-2.5 py-0.5 rounded-full border border-brand-primary/30">
              <View style={{ backgroundColor: current_stage.color || colors.primary }} className="w-1.5 h-1.5 rounded-full mr-1.5" />
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

      {/* Title Row — full width */}
      <View className="mt-1 mb-2">
        <Text className="text-typography-main text-2xl font-black tracking-tight" numberOfLines={3}>
          {task.title}
        </Text>
        {/* Muted info row */}
        <View className="flex-row items-center gap-4 mt-1">
          {task.category && (
            <Text className="text-typography-dim text-[10px] font-bold uppercase tracking-wider">{task.category}</Text>
          )}
          {data.pipeline && (
            <View className="flex-row items-center">
              <FontAwesome name="code-fork" size={9} className="text-typography-dim" />
              <Text className="text-typography-dim text-[10px] font-bold ml-1">{data.pipeline.name}</Text>
            </View>
          )}
        </View>
      </View>

      {/* Actions Row */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 2 }}>
        {/* Stage Actions Buttons */}
        {buttonActions.map((a) => {
            const style = TYPE_STYLES[a.style] || TYPE_STYLES.neutral;
            const isLoading = loadingActionId === a.id;
            const isLocked = advancementGateLocked && isAdvancementAction(a);

            return (
              <TouchableOpacity
                key={a.id}
                disabled={isLoading || isLocked}
                onPress={() => {
                  if (isLocked) {
                    setErrorMsg({
                      title: 'Locked — Awaiting Manager Approval',
                      message: 'Your time declaration is pending review. This action will unlock once your manager approves it.',
                    });
                    setTimeout(() => setErrorMsg(null), 6000);
                    return;
                  }
                  handleAction(a);
                }}
                className={`flex-row items-center px-4 py-2 rounded-xl border ${
                  isLocked
                    ? 'bg-surface-overlay border-state-warning/40 opacity-70'
                    : `${style.bg} ${style.border}`
                } ${isLoading ? 'opacity-50' : ''}`}
              >
                {isLoading ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : isLocked ? (
                  <>
                    <FontAwesome name="lock" size={10} className="text-state-warning" />
                    <Text className="text-state-warning text-[10px] font-black uppercase tracking-wider ml-2">{a.label}</Text>
                  </>
                ) : (
                  <>
                    <FontAwesome name={(a.icon as any) || style.icon} size={10} className={style.text} />
                    <Text className={`${style.text} text-[10px] font-black uppercase tracking-wider ml-2`}>{a.label}</Text>
                  </>
                )}
              </TouchableOpacity>
            );
          })}

          {canPing && (
            <TouchableOpacity
              onPress={handlePingTask}
              disabled={pingLoading}
              className={`flex-row items-center px-4 py-2 rounded-xl border border-brand-primary/40 bg-brand-primary/10 ${pingLoading ? 'opacity-50' : ''}`}
            >
              {pingLoading ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <>
                  <FontAwesome name="bell" size={10} className="text-brand-primary" />
                  <Text className="text-brand-primary text-[10px] font-black uppercase tracking-wider ml-2">Ping</Text>
                </>
              )}
            </TouchableOpacity>
          )}

          {canArchive && (
            <TouchableOpacity
              onPress={() => setShowArchiveConfirm(true)}
              disabled={archiving}
              className={`flex-row items-center px-4 py-2 rounded-xl border border-surface-border bg-surface-overlay ${archiving ? 'opacity-50' : ''}`}
            >
              {archiving ? (
                <ActivityIndicator size="small" color={colors.muted} />
              ) : (
                <>
                  <FontAwesome name="archive" size={10} className="text-typography-muted" />
                  <Text className="text-typography-muted text-[10px] font-black uppercase tracking-wider ml-2">Archive</Text>
                </>
              )}
            </TouchableOpacity>
          )}
      </ScrollView>

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
        transitionId={pendingAction?.transition_id ?? null}
        minTimerSeconds={data.current_stage?.min_timer_seconds ?? 300}
        onSuccess={() => handleManualTimeSuccess()}
        onCancel={() => {
          setShowManualTimeModal(false);
          setPendingAction(null);
        }}
      />
    </View>
  );
}
