import ConfirmModal from '@/components/common/ConfirmModal';
import ManualTimeModal from '@/components/common/ManualTimeModal';
import { useAuth } from '@/contexts/AuthContext';
import { useTaskDetail } from '@/contexts/TaskDetailContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useTimer } from '@/contexts/TimerContext';
import { useToast } from '@/contexts/ToastContext';
import { supabase } from '@/lib/supabase';
import { getMutedColor, getPrimaryColor } from '@/lib/themeColors';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import React from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
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
  high: { textClass: 'text-state-warning', label: 'HIGH' },
  medium: { textClass: 'text-typography-muted', label: 'NORMAL' },
  low: { textClass: 'text-state-success', label: 'LOW' },
};

export default function TaskHeaderWeb() {
  const { data, executeAction } = useTaskDetail();
  const { isActive, activeSession, startWork, stopWork } = useTimer();
  const { theme: activeTheme } = useTheme();
  const { hasPermission } = useAuth();
  const { infoToast, successToast, errorToast } = useToast();
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

  if (!data) return null;

  const { task, current_stage } = data;
  const prio = PRIORITY_MAP[task.priority?.toLowerCase()] || PRIORITY_MAP.medium;
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

      if (err.code === 'P0001' && err.message?.includes('Mandatory evidence missing')) {
        displayMessage = 'This stage requires a submission with text or attachments to proceed.';
      }

      setErrorMsg({
        title: 'Action Failed',
        message: displayMessage,
      });

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
    <View className="px-6 pt-10 pb-5 bg-surface-card border-b border-surface-border shadow-[0_1px_0_rgba(255,255,255,0.03)]">
      <View className="flex-row items-center gap-4 mb-4">
        <TouchableOpacity
          onPress={handleBack}
          className="w-11 h-11 items-center justify-center rounded-2xl bg-surface-background border border-surface-border hover:bg-surface-overlay transition-colors"
        >
          <FontAwesome name="chevron-left" size={15} className="text-typography-muted" />
        </TouchableOpacity>

        <View className="flex-1 flex-row items-center flex-wrap gap-2">
          <View className="bg-surface-background px-3 py-1 rounded-full border border-surface-border">
            <Text className={`${prio.textClass} text-[10px] font-black uppercase tracking-[0.18em]`}>
              {prio.label}
            </Text>
          </View>

          {current_stage && (
            <View className="flex-row items-center bg-brand-primary/10 px-3 py-1 rounded-full border border-brand-primary/25">
              <View style={{ backgroundColor: current_stage.color || 'var(--color-primary)' }} className="w-2 h-2 rounded-full mr-2" />
              <Text className="text-brand-primary text-[10px] font-black uppercase tracking-[0.18em]">
                {current_stage.name}
              </Text>
            </View>
          )}

          {task.parent_task_id && (
            <View className="bg-brand-primary/15 px-2.5 py-1 rounded-full border border-brand-primary/20">
              <Text className="text-brand-primary text-[9px] font-black uppercase tracking-[0.18em]">Sub-task</Text>
            </View>
          )}

          {task.error_state && (
            <View className="bg-state-danger/10 px-3 py-1 rounded-full border border-state-danger/25">
              <Text className="text-state-danger text-[9px] font-black uppercase tracking-[0.18em]">
                {task.error_state}
              </Text>
            </View>
          )}
        </View>
      </View>

      <View className="flex-row items-start justify-between gap-6">
        <View className="flex-1 min-w-0">
          <Text className="text-typography-main text-[clamp(1.75rem,3vw,2.75rem)] leading-tight font-black tracking-tight">
            {task.title}
          </Text>
          <View className="flex-row items-center flex-wrap gap-x-4 gap-y-1 mt-2">
            {task.category && (
              <Text className="text-typography-dim text-[10px] font-bold uppercase tracking-[0.18em]">
                {task.category}
              </Text>
            )}
            {data.pipeline && (
              <View className="flex-row items-center">
                <FontAwesome name="code-fork" size={9} className="text-typography-dim" />
                <Text className="text-typography-dim text-[10px] font-bold ml-1">{data.pipeline.name}</Text>
              </View>
            )}
          </View>
        </View>

        <View className="flex-row flex-wrap items-center justify-end gap-2 max-w-[52%]">
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
                    infoToast(
                      'This action will unlock once your manager approves it.',
                      'Locked - Awaiting Manager Approval'
                    );
                    return;
                  }
                  handleAction(a);
                }}
                className={`min-w-[128px] flex-row items-center justify-center px-4 py-2.5 rounded-2xl border transition-colors ${
                  isLocked
                    ? 'bg-state-warning/10 border-state-warning/30 opacity-80'
                    : `${style.bg} ${style.border} hover:opacity-95`
                } ${isLoading ? 'opacity-50' : ''}`}
              >
                {isLoading ? (
                  <ActivityIndicator size="small" color={getPrimaryColor(activeTheme)} />
                ) : isLocked ? (
                  <>
                    <FontAwesome name="lock" size={10} className="text-state-warning" />
                    <Text className="text-state-warning text-[10px] font-black uppercase tracking-[0.18em] ml-2">
                      {a.label}
                    </Text>
                  </>
                ) : (
                  <>
                    <FontAwesome name={(a.icon as any) || style.icon} size={10} className={style.text} />
                    <Text className={`${style.text} text-[10px] font-black uppercase tracking-[0.18em] ml-2`}>
                      {a.label}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            );
          })}

          {canArchive && (
            <TouchableOpacity
              onPress={() => setShowArchiveConfirm(true)}
              disabled={archiving}
              className={`min-w-[128px] flex-row items-center justify-center px-4 py-2.5 rounded-2xl border border-surface-border bg-surface-overlay hover:bg-surface-background transition-colors ${archiving ? 'opacity-50' : ''}`}
            >
              {archiving ? (
                <ActivityIndicator size="small" color={getMutedColor(activeTheme)} />
              ) : (
                <>
                  <FontAwesome name="archive" size={10} className="text-typography-muted" />
                  <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.18em] ml-2">
                    Archive
                  </Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>
      </View>

      {errorMsg && (
        <View className="mt-4 bg-state-danger/10 border border-state-danger/25 rounded-2xl p-4">
          <Text className="text-state-danger font-black text-xs uppercase tracking-[0.18em] mb-1">
            {errorMsg.title}
          </Text>
          <Text className="text-state-danger/90 text-sm leading-6">
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