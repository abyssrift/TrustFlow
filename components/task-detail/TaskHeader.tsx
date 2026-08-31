import ActiveSessionAvatars from '@/components/task-detail/ActiveSessionAvatars';
import ConfirmModal from '@/components/common/ConfirmModal';
import ManualTimeModal from '@/components/common/ManualTimeModal';
import Tooltip from '@/components/common/Tooltip';
import type { ActiveSessionUser } from '@/components/task-detail/TaskCardActions';
import { useAlert } from '@/contexts/AlertContext';
import { useAuth } from '@/contexts/AuthContext';
import { useTaskDetail } from '@/contexts/TaskDetailContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useTimer } from '@/contexts/TimerContext';
import { useToast } from '@/contexts/ToastContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { offerForceStopOnArchiveError } from '@/lib/archiveForceStop';
import { supabase } from '@/lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import React from 'react';
import { ActivityIndicator, Platform, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import Animated, { interpolate, useAnimatedStyle } from 'react-native-reanimated';
import { cssInterop } from 'react-native-css-interop';
import { useCollapseProgress } from '@/hooks/useCollapsibleHeader';
import { buildTransitionTargetMap, splitStageActions, stageDirection, TYPE_STYLES } from './actionRegistry';
import { DirectionalActionButton } from './DirectionalActionButton';

// Full-size top padding differs by platform: native has no app chrome so the
// header must clear the status bar (pt-12), web sits under the app topbar (pt-4).
// Collapsed, both just need breathing room.
const PAD_TOP_FULL = Platform.OS === 'web' ? 16 : 48;
const PAD_TOP_CONDENSED = Platform.OS === 'web' ? 8 : 24;

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

function formatPingedNames(names: string[]): string {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]}, ${names[1]} +${names.length - 2} more`;
}

export default function TaskHeader() {
  const { data, executeAction, revertStage } = useTaskDetail();
  const { isActive, activeSession, startWork, stopWork } = useTimer();
  const { theme: activeTheme } = useTheme();
  const { hasPermission, user } = useAuth();
  const [busy, setBusy] = React.useState(false);
  const [loadingActionId, setLoadingActionId] = React.useState<string | null>(null);
  const [pingLoading, setPingLoading] = React.useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = React.useState(false);
  const [archiving, setArchiving] = React.useState(false);
  const [reverting, setReverting] = React.useState(false);
  const [showManualTimeModal, setShowManualTimeModal] = React.useState(false);
  const [pendingAction, setPendingAction] = React.useState<any | null>(null);

  const router = useRouter();
  const { successToast, errorToast, infoToast } = useToast();
  const { showConfirm } = useAlert();
  const colors = useThemeColors();

  // Scroll-linked collapse (#306): once the task body scrolls past ~64px this
  // settles the header into an inline strip — title shrinks, vertical padding
  // tightens, the muted category + pipeline row tucks away — and restores near
  // the top. The badge row and the horizontal action rail stay: that's the
  // "necessary things only" that survives. `collapse` is 0 (full) → 1
  // (condensed); the tween and Reduce-Motion handling live in the hook.
  const collapse = useCollapseProgress();
  const [metaH, setMetaH] = React.useState(0);
  const containerPadStyle = useAnimatedStyle(() => ({
    paddingTop: interpolate(collapse.value, [0, 1], [PAD_TOP_FULL, PAD_TOP_CONDENSED]),
    paddingBottom: interpolate(collapse.value, [0, 1], [16, 8]),
  }));
  const titleScaleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(collapse.value, [0, 1], [1, 0.75]) }],
    transformOrigin: 'left center',
  }));
  const metaRowStyle = useAnimatedStyle(() => ({
    height: metaH ? metaH * (1 - collapse.value) : undefined,
    opacity: interpolate(collapse.value, [0, 1], [1, 0]),
    marginTop: interpolate(collapse.value, [0, 1], [4, 0]),
  }));

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
      if (offerForceStopOnArchiveError(err, { hasPermission, showConfirm, errorToast, retry: handleArchive })) return;
      errorToast(err.message || 'Could not archive task.', 'Archival failed');
    } finally {
      setArchiving(false);
    }
  };

  const handleRevert = () => {
    showConfirm(
      'Revert Stage',
      'The task will move back to its previous stage. This does not re-run stage automations (spawned sub-tasks, handshakes, reassignment).',
      async () => {
        setReverting(true);
        try {
          await revertStage();
        } catch {
          // revertStage already toasts
        } finally {
          setReverting(false);
        }
      },
      undefined,
      'Revert',
      'Cancel',
      'destructive'
    );
  };

  const handlePingTask = async () => {
    if (!data) return;
    const targets = (data.assignments || []).filter(
      a => a.user !== null && a.user?.id !== user?.id
    );
    if (targets.length === 0) {
      infoToast('No one was pinged — this task has no other assignees.');
      return;
    }
    try {
      setPingLoading(true);
      const { error } = await supabase.rpc('rpc_ping_task', { p_task_id: data.task.id });
      if (error) throw error;
      const names = targets.map(a => a.user?.full_name || 'Someone');
      successToast(`Pinged ${formatPingedNames(names)} 📢`);
    } catch (err: any) {
      errorToast(err.message || 'Could not ping task.');
    } finally {
      setPingLoading(false);
    }
  };

  if (!data) return null;

  const { task, current_stage } = data;
  const prio = PRIORITY_MAP[task.priority?.toLowerCase()] || PRIORITY_MAP.medium;

  // Who's working right now. The detail context's realtime channel refetches on
  // every session write — including the 30s heartbeat — so idle state stays live.
  const activeSessions: ActiveSessionUser[] = (data.work_sessions || [])
    .filter(ws => ws.status === 'active')
    .map(ws => ({
      userId: ws.user_id,
      name: ws.user_name || 'User',
      avatar: ws.avatar_url ?? null,
      startedAt: ws.started_at,
      lastHeartbeatAt: ws.last_heartbeat_at ?? null,
    }));
  const canArchive = data.permissions.is_owner || hasPermission('archive:create') || hasPermission('pipeline.edit');
  const canPing = data.permissions.is_manager || hasPermission('task.ping') || data.permissions.is_owner;
  // #22: manager-only one-step-back correction. RPC is the real gate (it
  // re-checks permission and whether a same-pipeline prior stage actually
  // exists) — this just decides whether to show the button at all.
  const canRevert = (data.permissions.is_owner || hasPermission('pipeline.reverse')) && data.stage_history.length > 0;

  // Deterministic: the task page's back arrow always returns to this task's
  // pipeline board. History-based back (router.back / window.history.back) is
  // unreliable here — the web layouts are Slot-based, so both React
  // Navigation's GO_BACK and the browser history lose or skip the tasks tab
  // and land on the dashboard or whatever tab came before it. The browser's
  // own back button still gives true history for those who want it.
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

  // Map each action's transition to its target stage position so buttons can show
  // a directional arrow (back = left, forward = right).
  const stagePositionById = new Map((data.all_stages || []).map((s) => [s.id, s.position]));
  const transitionTargetPos = buildTransitionTargetMap(data.available_transitions || [], stagePositionById);
  const currentPosition = data.current_stage?.position ?? null;
  const directionOf = (a: { transition_id: string | null }) =>
    stageDirection(currentPosition, a.transition_id ? transitionTargetPos.get(a.transition_id) ?? null : null);
  const toneColor = (s: string) =>
    s === 'success' ? colors.success
      : s === 'warning' ? colors.warning
      : s === 'danger' ? colors.danger
      : s === 'primary' ? colors.primary
      : colors.muted;

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
        infoToast(
          'Your time declaration is awaiting manager approval. The stage will advance automatically once approved.',
          'Awaiting manager approval',
        );
        return;
      }

      let displayMessage = err.message || 'Could not perform action';

      // Handle P0001 error for missing evidence/submissions
      if (err.code === 'P0001' && err.message?.includes('Mandatory evidence missing')) {
        displayMessage = 'This stage requires a submission with text or attachments to proceed.';
      }

      errorToast(displayMessage, 'Action failed');
    } finally {
      setLoadingActionId(null);
    }
  };

  const handleManualTimeSuccess = async () => {
    setShowManualTimeModal(false);
    setPendingAction(null);
    infoToast(
      'Your time declaration has been sent to your manager. The stage will advance automatically once approved.',
      'Awaiting manager approval',
    );
  };

  return (
    <Animated.View className="px-5 bg-surface-card border-b border-surface-border relative z-50" style={containerPadStyle}>
      {/* Top row: back + badges. Elevated so the presence popover clears the rows below it. */}
      <View className="flex-row items-center mb-3 relative z-50">
        <Tooltip label="Go back">
          <TouchableOpacity
            onPress={handleBack}
            className="mr-4 bg-surface-background p-2 rounded-xl border border-surface-border active:opacity-50"
          >
            <FontAwesome name="chevron-left" size={16} className="text-typography-muted" />
          </TouchableOpacity>
        </Tooltip>

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

        {/* Live presence — centered so its popover clears the title below.
            The trailing flex-1 balances the badge zone to do the centering, so
            both must go when nobody's working or the badges lose half the row. */}
        {activeSessions.length > 0 && (
          <>
            <ActiveSessionAvatars sessions={activeSessions} className="mx-3" />
            <View className="flex-1" />
          </>
        )}
      </View>

      {/* Title Row — full width */}
      <View className="mt-1 mb-2">
        <Animated.View style={titleScaleStyle}>
          <Text className="text-typography-main text-2xl font-black tracking-tight" numberOfLines={3}>
            {task.title}
          </Text>
        </Animated.View>
        {/* Muted info row — collapse fuel: height/opacity driven to 0 when condensed. */}
        <Animated.View style={[metaRowStyle, { overflow: 'hidden' }]}>
          <View
            className="flex-row items-center gap-4"
            onLayout={(e) => { if (!metaH) setMetaH(e.nativeEvent.layout.height); }}
          >
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
        </Animated.View>
      </View>

      {/* Actions Row */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 2 }}>
        {/* Stage Actions Buttons */}
        {buttonActions.map((a) => {
            const style = TYPE_STYLES[a.style] || TYPE_STYLES.neutral;
            const isLoading = loadingActionId === a.id;
            const isLocked = advancementGateLocked && isAdvancementAction(a);
            const direction = directionOf(a);

            const onAct = () => {
              if (isLocked) {
                infoToast(
                  'Your time declaration is pending review. This action will unlock once your manager approves it.',
                  'Locked — awaiting manager approval',
                );
                return;
              }
              handleAction(a);
            };

            // Directional transitions render as an arrow-shaped button; everything
            // else keeps the standard rounded pill.
            if (direction) {
              return (
                <DirectionalActionButton
                  key={a.id}
                  direction={direction}
                  color={isLocked ? colors.warning : toneColor(a.style)}
                  label={a.label}
                  icon={isLocked ? 'lock' : (a.icon || style.icon)}
                  loading={isLoading}
                  disabled={isLocked}
                  onPress={onAct}
                />
              );
            }

            return (
              <TouchableOpacity
                key={a.id}
                disabled={isLoading || isLocked}
                onPress={onAct}
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
                  <FontAwesome name="bell-o" size={10} className="text-brand-primary" />
                  <Text className="text-brand-primary text-[10px] font-black uppercase tracking-wider ml-2">Ping</Text>
                </>
              )}
            </TouchableOpacity>
          )}

          {canRevert && (
            <TouchableOpacity
              onPress={handleRevert}
              disabled={reverting}
              className={`flex-row items-center px-4 py-2 rounded-xl border border-state-warning/40 bg-state-warning/10 ${reverting ? 'opacity-50' : ''}`}
            >
              {reverting ? (
                <ActivityIndicator size="small" color={colors.warning} />
              ) : (
                <>
                  <FontAwesome name="undo" size={10} className="text-state-warning" />
                  <Text className="text-state-warning text-[10px] font-black uppercase tracking-wider ml-2">Revert</Text>
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
    </Animated.View>
  );
}
