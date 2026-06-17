import ClipboardControls from '@/components/common/ClipboardControls';
import ManualTimeModal from '@/components/common/ManualTimeModal';
import LockIndicator from '@/components/task-detail/LockIndicator';
import ManualTimeApprovalCard from '@/components/task-detail/ManualTimeApprovalCard';
import { useAuth } from '@/contexts/AuthContext';
import { useSubmission } from '@/contexts/SubmissionContext';
import { useTaskDetail, type StageActionData } from '@/contexts/TaskDetailContext';
import { useTimer } from '@/contexts/TimerContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { getPastedImageFile } from '@/lib/pasteImage';
import { openStorageFile, SUBMISSION_BUCKET } from '@/lib/storage';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Alert, AppState, Image, Platform, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { getActionDescriptor, splitStageActions } from './actionRegistry';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function getFileIcon(mimeType: string | null, colors: ReturnType<typeof useThemeColors>): { name: string; color: string } {
  const t = (mimeType || '').toLowerCase();
  if (t.includes('image')) return { name: 'file-image-o', color: colors.warning };
  if (t.includes('pdf')) return { name: 'file-pdf-o', color: colors.danger };
  if (t.includes('spreadsheet') || t.includes('excel') || t.includes('csv')) return { name: 'file-excel-o', color: colors.success };
  if (t.includes('word') || t.includes('document') || t.includes('text')) return { name: 'file-text-o', color: colors.info };
  return { name: 'file-o', color: colors.textMuted };
}

const STATUS_STYLES: Record<string, { bg: string; border: string; text: string; label: string }> = {
  approved: { bg: 'bg-state-success-dim', border: 'border-state-success/30', text: 'text-state-success', label: 'Approved' },
  needs_revision: { bg: 'bg-state-warning-dim', border: 'border-state-warning/30', text: 'text-state-warning', label: 'Needs Revision' },
  rejected: { bg: 'bg-state-danger-dim', border: 'border-state-danger/30', text: 'text-state-danger', label: 'Rejected' },
  pending: { bg: 'bg-state-info-dim', border: 'border-state-info/30', text: 'text-state-info', label: 'Pending Review' },
};

// ─── Adaptive File Grid ───────────────────────────────────────────────────────

function AdaptiveFileGrid({
  files,
  onRemove,
  isUploading
}: {
  files: any[];
  onRemove: (id: string) => void;
  isUploading: boolean;
}) {
  const [containerWidth, setContainerWidth] = useState(0);
  const colors = useThemeColors();
  
  const gap = 12;
  const minSquareSize = 90; // Slightly smaller for the submission panel

  // Fallback width before layout calculation fires
  const availableWidth = containerWidth > 0 ? containerWidth : 300;
  
  let numCols = Math.floor((availableWidth + gap) / (minSquareSize + gap));
  if (numCols < 2) numCols = 2; 
  const exactSquareSize = Math.floor((availableWidth - (gap * (numCols - 1))) / numCols);

  if (files.length === 0) return null;

  return (
    <View 
      onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
      className="flex-row flex-wrap w-full bg-surface-background border border-surface-border rounded-xl p-3 mb-3"
      style={{ gap }}
    >
      {files.map((pf) => {
        const isImage = pf.type?.toLowerCase().includes('image');
        const { name: icon, color } = getFileIcon(pf.type || null, colors);

        return (
          <View 
            key={pf.id} 
            style={{ width: exactSquareSize, height: exactSquareSize }}
            className="rounded-xl overflow-hidden border border-surface-border bg-surface-card relative"
          >
            {isImage ? (
              <Image 
                source={{ uri: pf.uri }} 
                style={{ flex: 1, width: '100%', height: '100%', position: 'absolute' }} 
                resizeMode="cover" 
              />
            ) : (
              <View className="flex-1 items-center justify-center p-2" style={{ backgroundColor: color + '15' }}>
                <FontAwesome name={icon as any} size={exactSquareSize > 80 ? 32 : 24} color={color} />
                <View className="mt-2 bg-surface-background px-2 py-0.5 rounded-md border border-surface-border shadow-sm">
                  <Text className="text-[9px] font-black uppercase text-typography-muted" numberOfLines={1}>
                    {pf.name.split('.').pop() || 'FILE'}
                  </Text>
                </View>
              </View>
            )}

            {isUploading ? (
              <View className="absolute top-1.5 right-1.5 w-6 h-6 bg-black/60 rounded-full items-center justify-center">
                <ActivityIndicator size="small" color="#fff" style={{ transform: [{ scale: 0.6 }] }} />
              </View>
            ) : (
              <TouchableOpacity 
                onPress={() => onRemove(pf.id)}
                className="absolute top-1.5 right-1.5 w-6 h-6 bg-black/60 rounded-full items-center justify-center hover:bg-black/80 transition-colors"
                style={Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}}
              >
                <FontAwesome name="times" size={10} color="#fff" />
              </TouchableOpacity>
            )}

            <View className="absolute bottom-0 left-0 right-0 bg-black/60 px-2 py-1 backdrop-blur-md">
              <Text className="text-white text-[9px] font-bold text-center" numberOfLines={1}>
                {formatFileSize(pf.size)}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function StageActions() {
  const colors = useThemeColors();
  const { data, executeAction, submitWork, deleteSubmission } = useTaskDetail();
  const { isActive, activeSession, serverTimeOffset, stopWork, startWork, smartTimer } = useTimer();
  const router = useRouter();
  const { user } = useAuth();
  const [loadingActionId, setLoadingActionId] = useState<string | null>(null);
  const [submissionContent, setSubmissionContent] = useState('');
  const [stagedFiles, setStagedFiles] = useState<any[]>([]);
  const [elapsedLocal, setElapsedLocal] = React.useState(0);
  const [idleSeconds, setIdleSeconds] = React.useState(0);
  const [isTracking, setIsTracking] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<{ title: string; message: string; variant?: 'danger' | 'warning' } | null>(null);
  const [showManualTimeModal, setShowManualTimeModal] = useState(false);
  const [pendingAdvanceAction, setPendingAdvanceAction] = useState<StageActionData | null>(null);

  const { submitWithEvidence, activeJobs } = useSubmission();

  React.useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isActive && activeSession && data?.task.id && activeSession.task_id === data.task.id) {
      const start = new Date(activeSession.started_at).getTime();

      const tick = () => {
        const now = Date.now();
        setElapsedLocal(Math.floor((now + serverTimeOffset - start) / 1000));
        setIdleSeconds(Math.floor((now - smartTimer.getLastActivityTime()) / 1000));
        setIsTracking(
          Platform.OS === 'web'
            ? typeof document !== 'undefined' && document.visibilityState === 'visible'
            : AppState.currentState === 'active'
        );
      };

      tick();
      timer = setInterval(tick, 1000);
    } else {
      setIdleSeconds(0);
      setIsTracking(true);
    }
    return () => clearInterval(timer);
  }, [isActive, activeSession, data?.task.id, serverTimeOffset, smartTimer.getLastActivityTime]);

  const pickDocument = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: true });
    if (!result.canceled) {
      setStagedFiles(prev => [...prev, ...result.assets.map(a => ({
        id: Math.random().toString(36).substring(7),
        uri: a.uri,
        name: a.name,
        size: a.size || 0,
        type: a.mimeType || 'application/octet-stream',
      }))]);
    }
  };

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsMultipleSelection: true });
    if (!result.canceled) {
      setStagedFiles(prev => [...prev, ...result.assets.map(a => ({
        id: Math.random().toString(36).substring(7),
        uri: a.uri,
        name: a.fileName || `image_${Date.now()}.jpg`,
        size: a.fileSize || 0,
        type: a.mimeType || 'image/jpeg',
      }))]);
    }
  };

  const pasteImage = async () => {
    const file = await getPastedImageFile();
    if (file) setStagedFiles(prev => [...prev, file]);
    else Alert.alert('No Image', 'There is no image on the clipboard to paste.');
  };

  const removeFile = (id: string) => setStagedFiles(prev => prev.filter(f => f.id !== id));

  const handleManualTimeSuccess = (_isFlagged: boolean, _flagReason: string | null, _approvalStatus: string) => {
    setShowManualTimeModal(false);
    setPendingAdvanceAction(null);
    setErrorMsg({
      title: 'Awaiting Manager Approval',
      message: 'Your time declaration has been sent to your manager. The stage will advance automatically once they approve it.',
      variant: 'warning',
    });
  };

  if (!data) return null;

  const myEntry = data.my_manual_time_entry;
  const isMyEntryPending = myEntry?.approval_status === 'pending';
  const isMyEntryRejected = myEntry?.approval_status === 'rejected';
  const isMyEntryApproved = myEntry?.approval_status === 'approved';

  const activeJob = activeJobs[data.task.id];
  const isUploading = !!activeJob && (activeJob.status === 'processing' || activeJob.status === 'uploading' || activeJob.status === 'committing');

  const actionable = data.stage_actions.filter((a) => a.can_perform && a.precondition_met);

  // Registry-driven slots keep UI stable as action types grow.
  const grouped = splitStageActions(actionable);
  const buttonActions = grouped.buttons;
  const submitAction = grouped.submission[0] || null;
  const reviewApprove = grouped.review.find((a) => a.action_type === 'review_approve');
  const reviewRevise = grouped.review.find((a) => a.action_type === 'review_revise');
  const reviewReject = grouped.review.find((a) => a.action_type === 'review_reject');
  const hasReviewActions = !!(reviewApprove || reviewRevise || reviewReject);
  const reviewActionIds = grouped.review.map((a) => a.id);
  const pendingSubmission = data.submissions.find((s) => s.status === 'pending');
  const stageRequiresSubmission = !!data.current_stage?.requires_submission;
  const canSubmitEvidence = data.permissions.is_assigned || data.permissions.is_owner || data.permissions.is_manager || data.permissions.is_creator;
  const canDirectSubmit = stageRequiresSubmission && canSubmitEvidence;
  const submitButtonActionId = submitAction?.id || '__submit_work__';

  // The submission form shows if:
  // 1. The stage explicitly requires a submission (and we aren't a reviewer just looking at it)
  // 2. Or there is an explicit submit_work action for the user.
  const showSubmitForm = !!(
    canDirectSubmit || submitAction
  );

  // The whole section shows if there's a form, or history, or the stage implies it.
  const showSubmissionSection = !!(
    data.submissions.length > 0 || 
    showSubmitForm || 
    data.current_stage?.requires_submission
  );

  const stageRequiresTimer = !!data.current_stage?.requires_timer;
  const anyActionRequiresTimer = data.stage_actions.some(a => a.requires_timer && a.can_perform && a.precondition_met);
  const canStart = (data.permissions.is_assigned || data.permissions.is_owner || data.permissions.is_manager);

  const handleAction = async (action: StageActionData) => {
    try {
      setLoadingActionId(action.id);

      const descriptor = getActionDescriptor(action.action_type);

      // Timer gate fires ONLY on advancement actions ('advance', 'custom',
      // 'start_task') by the assigned worker. Submit Work just persists
      // evidence and is NOT gated; review actions are the reviewer's path.
      const isAdvancement =
        action.action_type === 'advance' ||
        action.action_type === 'custom' ||
        action.action_type === 'start_task';

      if (isAdvancement) {
        const stage = data.current_stage;
        const minSeconds = stage?.min_timer_seconds ?? 300;
        const gateActive =
          stage?.requires_timer &&
          !stage?.is_initial &&
          minSeconds > 0 &&
          data.permissions.is_assigned;

        if (gateActive) {
          if (isMyEntryPending) {
            setErrorMsg({
              title: 'Awaiting Manager Approval',
              message: 'Your time declaration is awaiting manager approval. The stage will advance automatically once approved.',
              variant: 'warning',
            });
            return;
          }

          const completedSeconds = (data.work_sessions || [])
            .filter((s: any) => s.status === 'completed' && s.stage_id === stage?.id && s.user_id === user?.id)
            .reduce((sum: number, s: any) => sum + (s.total_seconds_spent || 0), 0);
          const totalSeconds = completedSeconds + elapsedLocal;

          if (totalSeconds < minSeconds && !isMyEntryApproved) {
            setPendingAdvanceAction(action);
            setShowManualTimeModal(true);
            return;
          }
        }
      }

      if (activeSession?.task_id === data.task.id) {
        await stopWork();
      }

      if (descriptor.executionRoute === 'submit_work') {
        const content = submissionContent.trim();
        await submitWithEvidence({
          taskId: data.task.id,
          taskTitle: data.task.title,
          companyId: data.task.company_id,
          content: content,
          transitionId: action.transition_id,
          stagedFiles
        });

        setSubmissionContent('');
        setStagedFiles([]);
        return;
      }

      await executeAction(action.id);
    } catch (err: any) {
      // Backend safety net for advance gate (fires if frontend check was bypassed)
      if (err.message?.includes('LOW_TIMER_TIME')) {
        setPendingAdvanceAction(action);
        setShowManualTimeModal(true);
        return;
      }

      if (err.message?.includes('TIME_APPROVAL_PENDING')) {
        setErrorMsg({
          title: 'Awaiting Manager Approval',
          message: 'Your time declaration is awaiting manager approval. The stage will advance automatically once approved.',
          variant: 'warning',
        });
        return;
      }

      let displayMessage = err.message || 'Could not perform action';
      if (err.code === 'P0001' && err.message?.includes('Mandatory evidence missing')) {
        displayMessage = 'This stage requires a submission with text or attachments to proceed.';
      }

      setErrorMsg({ title: 'Action Failed', message: displayMessage });
      setTimeout(() => setErrorMsg(null), 5000);
    } finally {
      setLoadingActionId(null);
    }
  };

  const handleSubmitEvidence = async () => {
    const content = submissionContent.trim();

    if (!submitAction && !canDirectSubmit) return;

    setLoadingActionId(submitButtonActionId);

    try {
      if (activeSession?.task_id === data.task.id) {
        await stopWork();
      }

      if (submitAction) {
        await submitWithEvidence({
          taskId: data.task.id,
          taskTitle: data.task.title,
          companyId: data.task.company_id,
          content,
          transitionId: submitAction.transition_id,
          stagedFiles,
        });
      } else {
        await submitWithEvidence({
          taskId: data.task.id,
          taskTitle: data.task.title,
          companyId: data.task.company_id,
          content,
          transitionId: null,
          stagedFiles,
        });
      }

      setSubmissionContent('');
      setStagedFiles([]);
    } finally {
      setLoadingActionId(null);
    }
  };

  const showTimerCard = stageRequiresTimer || anyActionRequiresTimer || (isActive && activeSession?.task_id === data.task.id);

  const hasLinkedPipeline = !!data.current_stage?.linked_pipeline_id;
  const linkedPipelineName = data.current_stage?.linked_pipeline?.name || 'Sub-Pipeline';

  if (!buttonActions.length && !showSubmissionSection && !showTimerCard && !hasLinkedPipeline) return null;

  return (
    <View className="gap-4">
      {hasLinkedPipeline && (
        <View className="bg-surface-card rounded-2xl border border-surface-border p-4">
          <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.15em] mb-3">Sub-Pipeline Active</Text>
          <TouchableOpacity
            onPress={() => {
              if (data.current_stage?.linked_pipeline_id) {
                AsyncStorage.setItem('@TrustFlow_tasks_pipeline', data.current_stage.linked_pipeline_id);
                router.push(`/tasks?pipelineId=${data.current_stage.linked_pipeline_id}` as any);
              }
            }}
            className="bg-brand-primary/10 py-3 rounded-xl border border-brand-primary/30 items-center justify-center flex-row"
          >
            <FontAwesome name="bolt" size={14} color={colors.primary} />
            <Text className="text-brand-primary font-black text-xs uppercase tracking-widest ml-2">
              Navigate to {linkedPipelineName}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Manager: pending time approval card */}
      {data.permissions.is_manager && data.pending_time_approvals?.length > 0 && (
        <ManualTimeApprovalCard entries={data.pending_time_approvals} />
      )}

      {/* Worker: locked banner while time declaration is pending */}
      {isMyEntryPending && !errorMsg && (
        <LockIndicator
          declaredMinutes={myEntry?.declared_minutes}
          reason={myEntry?.rejection_reason ?? undefined}
        />
      )}

      {/* Worker: rejected entry banner — prompts re-declaration */}
      {isMyEntryRejected && !errorMsg && (
        <View className="bg-state-danger/10 border border-state-danger/30 rounded-xl p-3">
          <Text className="text-state-danger font-black text-xs uppercase tracking-wider mb-1">
            Time Declaration Rejected
          </Text>
          <Text className="text-state-danger text-sm leading-5">
            {myEntry?.rejection_reason
              ? `Reason: ${myEntry.rejection_reason}. Please re-declare your work hours.`
              : 'Your time declaration was rejected. Please re-declare your work hours.'}
          </Text>
        </View>
      )}

      {/* Error / Warning Message Display */}
      {errorMsg && (
        <View className={`rounded-xl p-3 ${
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
      
      {/* Timer Control Card — only shown when the stage/action requires it, or a session is already active */}
      {showTimerCard && (
        <View className="bg-surface-card rounded-2xl border border-surface-border p-4">
          <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.15em] mb-3">Time Tracking</Text>
          <View className="flex-row items-center justify-between">
            <View>
              <View className="flex-row items-center">
                <View className={`w-2 h-2 rounded-full mr-3 ${isActive && activeSession?.task_id === data.task.id ? 'bg-state-success animate-pulse' : 'bg-typography-muted'}`} />
                <Text className="text-typography-main font-mono text-xl font-black">
                  {Math.floor(elapsedLocal / 3600).toString().padStart(2, '0')}:
                  {Math.floor((elapsedLocal % 3600) / 60).toString().padStart(2, '0')}:
                  {(elapsedLocal % 60).toString().padStart(2, '0')}
                </Text>
              </View>
              {isActive && activeSession?.task_id === data.task.id && (
                <View className="flex-row items-center mt-1.5 ml-5 gap-2">
                  <View className={`w-1.5 h-1.5 rounded-full ${isTracking ? 'bg-state-success' : 'bg-typography-dim'}`} />
                  <Text className={`text-[9px] font-bold uppercase tracking-wider ${isTracking ? 'text-state-success' : 'text-typography-dim'}`}>
                    {isTracking ? 'Tracking' : 'Background'}
                  </Text>
                  <Text className="text-typography-dim text-[9px]">·</Text>
                  <Text className="text-typography-dim text-[9px]">
                    {idleSeconds < 60
                      ? 'Active now'
                      : idleSeconds < 3600
                        ? `${Math.floor(idleSeconds / 60)}m idle`
                        : `${Math.floor(idleSeconds / 3600)}h ${Math.floor((idleSeconds % 3600) / 60)}m idle`}
                  </Text>
                </View>
              )}
            </View>

            {isActive && activeSession?.task_id === data.task.id ? (
              <TouchableOpacity
                onPress={async () => {
                  setBusy(true);
                  await stopWork();
                  setBusy(false);
                }}
                disabled={busy}
                className="bg-state-danger px-6 py-2.5 rounded-xl active:opacity-75 flex-row items-center"
              >
                {busy ? (
                  <ActivityIndicator size="small" color="white" />
                ) : (
                  <>
                    <FontAwesome name="stop" size={10} color="white" />
                    <Text className="text-white text-xs font-black uppercase ml-2 tracking-wider">Stop Session</Text>
                  </>
                )}
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPress={async () => {
                  setBusy(true);
                  await startWork(data.task.id, data.task.title);
                  setBusy(false);
                }}
                disabled={busy}
                className="bg-brand-primary px-6 py-2.5 rounded-xl active:opacity-75 flex-row items-center"
              >
                {busy ? (
                  <ActivityIndicator size="small" color="white" />
                ) : (
                  <>
                    <FontAwesome name="play" size={10} color="white" />
                    <Text className="text-white text-xs font-black uppercase ml-2 tracking-wider">Start Working</Text>
                  </>
                )}
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      <ManualTimeModal
        visible={showManualTimeModal}
        taskId={data.task.id}
        stageId={data.current_stage?.id ?? ''}
        transitionId={pendingAdvanceAction?.transition_id ?? null}
        minTimerSeconds={data.current_stage?.min_timer_seconds ?? 300}
        onSuccess={handleManualTimeSuccess}
        onCancel={() => { setShowManualTimeModal(false); setPendingAdvanceAction(null); }}
      />

      {showSubmissionSection && (
        <View className="bg-surface-card rounded-2xl border border-surface-border p-4">
          <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.15em] mb-3">
            Submissions ({data.submissions.length})
          </Text>

          {showSubmitForm && (
            <View className="mb-4 pb-4 border-b border-surface-border/30">
              <View className="flex-row items-center justify-end mb-2">
                <ClipboardControls
                  value={submissionContent}
                  onPaste={(t) => {
                    setSubmissionContent((prev) => (prev ? `${prev}\n${t}` : t));
                    smartTimer.recordActivity();
                  }}
                />
              </View>
              <TextInput
                value={submissionContent}
                onChangeText={(val) => {
                  setSubmissionContent(val);
                  smartTimer.recordActivity();
                }}

                placeholder="Describe your work submission..."
                placeholderTextColor={colors.textDim}
                multiline
                numberOfLines={3}
                className="bg-surface-background border border-surface-border rounded-xl p-3 text-typography-main text-sm mb-3 min-h-[80px]"
              />
              
              {/* File Upload Queue -> Adaptive File Grid */}
              {stagedFiles.length > 0 && (
                <AdaptiveFileGrid 
                  files={stagedFiles} 
                  onRemove={removeFile} 
                  isUploading={isUploading} 
                />
              )}

              <View className="flex-row flex-wrap items-center justify-between gap-3">
                <View className="flex-row flex-wrap gap-3">
                  <TouchableOpacity 
                    onPress={pickImage}
                    disabled={isUploading}
                    className="flex-row items-center bg-surface-background px-3 py-2 rounded-xl border border-surface-border active:opacity-70"
                  >
                    <FontAwesome name="camera" size={11} color={colors.primary} />
                    <Text className="text-brand-primary text-[10px] font-black uppercase ml-1.5">Add Photo</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={pickDocument}
                    disabled={isUploading}
                    className="flex-row items-center bg-surface-background px-3 py-2 rounded-xl border border-surface-border active:opacity-70"
                  >
                    <FontAwesome name="paperclip" size={11} color={colors.primary} />
                    <Text className="text-brand-primary text-[10px] font-black uppercase ml-1.5">Attach File</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={pasteImage}
                    disabled={isUploading}
                    className="flex-row items-center bg-surface-background px-3 py-2 rounded-xl border border-surface-border active:opacity-70"
                  >
                    <FontAwesome name="clipboard" size={11} color={colors.primary} />
                    <Text className="text-brand-primary text-[10px] font-black uppercase ml-1.5">Paste Image</Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  onPress={handleSubmitEvidence}
                  disabled={(!(submitAction || canDirectSubmit)) || (submissionContent.trim() === '' && stagedFiles.length === 0) || loadingActionId === submitButtonActionId || isUploading}
                  className={`bg-brand-primary px-5 py-2.5 rounded-xl ${((!(submitAction || canDirectSubmit)) || (submissionContent.trim() === '' && stagedFiles.length === 0) || loadingActionId === submitButtonActionId || isUploading) ? 'opacity-50' : ''}`}
                >
                  {loadingActionId === submitButtonActionId || isUploading ? (
                    <View className="flex-row items-center">
                      <ActivityIndicator size="small" color="white" />
                      {activeJob?.currentAction && (
                        <Text className="text-white text-[9px] font-black uppercase ml-2 tracking-tighter">
                          {activeJob.currentAction}
                        </Text>
                      )}
                    </View>
                  ) : (
                    <Text className="text-white text-xs font-black uppercase tracking-wider">{submitAction?.label || 'Submit Evidence'}</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}

          {data.submissions.length === 0 ? (
            <View className="py-4 items-center opacity-40">
              <FontAwesome name="inbox" size={20} color={colors.textDim} />
              <Text className="text-typography-muted text-xs mt-2">No submissions yet</Text>
            </View>
          ) : (
            data.submissions.map((s) => {
              const style = STATUS_STYLES[s.status] || STATUS_STYLES.pending;
              const isReviewing = reviewActionIds.includes(loadingActionId as string);
              const showReviewActions = s.status === 'pending' && hasReviewActions;

              return (
                <View key={s.id} className="mb-3 pb-3 border-b border-surface-border/20 last:border-0">
                  <View className="flex-row items-center justify-between mb-2">
                    <View className={`${style.bg} ${style.border} border px-2 py-0.5 rounded-md`}>
                      <Text className={`${style.text} text-[9px] font-black uppercase`}>{style.label}</Text>
                    </View>
                    {s.stage_name && <Text className="text-typography-dim text-[9px] font-bold">{s.stage_name}</Text>}
                  </View>

                  {s.content && <Text className="text-typography-label text-sm leading-5 mb-2">{s.content}</Text>}

                  {s.attachments.length > 0 && (
                    <View className="mb-2 gap-1.5">
                      {s.attachments.map((a) => {
                        const { name: iconName, color: iconColor } = getFileIcon(a.mime_type, colors);
                        return (
                          <TouchableOpacity
                            key={a.id}
                            onPress={() => openStorageFile(SUBMISSION_BUCKET, a.storage_path || a.file_url, a.file_name)}
                            className="flex-row items-center bg-surface-background px-2.5 py-2 rounded-lg border border-surface-border/50 active:opacity-70"
                          >
                            <FontAwesome name={iconName as any} size={12} color={iconColor} />
                            <Text className="text-typography-main text-[11px] font-bold ml-2 flex-1" numberOfLines={1}>
                              {a.file_name}
                            </Text>
                            <FontAwesome name="external-link" size={9} color={colors.textMuted} />
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}

                  <View className="flex-row items-center gap-2">
                    <Text className="text-typography-dim text-[9px] font-bold">by {s.submitted_by?.full_name || 'Unknown'}</Text>
                    <Text className="text-typography-dim text-[9px]">{new Date(s.submitted_at).toLocaleDateString()}</Text>
                    {!!s.content && (
                      <View className="ml-2">
                        <ClipboardControls value={s.content} onPaste={() => {}} showPaste={false} />
                      </View>
                    )}
                    {(s.submitted_by?.id === user?.id || data.permissions.is_manager || data.permissions.is_owner) && (
                      <TouchableOpacity
                        onPress={() => Alert.alert(
                          'Delete Submission',
                          'This will permanently remove the submission and its attachments.',
                          [
                            { text: 'Cancel', style: 'cancel' },
                            { text: 'Delete', style: 'destructive', onPress: () => deleteSubmission(s.id).catch(err => setErrorMsg({ title: 'Delete Failed', message: err.message })) },
                          ]
                        )}
                        className="ml-auto p-1"
                      >
                        <FontAwesome name="trash-o" size={11} color={colors.danger} />
                      </TouchableOpacity>
                    )}
                  </View>

                  {s.review_notes && (
                    <View className="bg-surface-background rounded-lg p-2.5 mt-2 border border-surface-border/50">
                      <Text className="text-typography-dim text-[9px] font-black uppercase mb-1">Review Notes</Text>
                      <Text className="text-typography-label text-xs leading-4">{s.review_notes}</Text>
                      <Text className="text-typography-dim text-[9px] mt-1">- {s.reviewed_by?.full_name}</Text>
                    </View>
                  )}

                  {showReviewActions && (
                    <View className="flex-row gap-2 mt-3">
                      {reviewApprove && (
                        <TouchableOpacity
                          disabled={isReviewing}
                          onPress={() => handleAction(reviewApprove)}
                          className={`flex-1 bg-state-success/10 py-2 rounded-xl border border-state-success/30 items-center ${isReviewing ? 'opacity-50' : ''}`}
                        >
                          <Text className="text-state-success text-[10px] font-black uppercase">{reviewApprove.label}</Text>
                        </TouchableOpacity>
                      )}
                      {reviewRevise && (
                        <TouchableOpacity
                          disabled={isReviewing}
                          onPress={() => handleAction(reviewRevise)}
                          className={`flex-1 bg-state-warning/10 py-2 rounded-xl border border-state-warning/30 items-center ${isReviewing ? 'opacity-50' : ''}`}
                        >
                          <Text className="text-state-warning text-[10px] font-black uppercase">{reviewRevise.label}</Text>
                        </TouchableOpacity>
                      )}
                      {reviewReject && (
                        <TouchableOpacity
                          disabled={isReviewing}
                          onPress={() => handleAction(reviewReject)}
                          className={`flex-1 bg-state-danger/10 py-2 rounded-xl border border-state-danger/30 items-center ${isReviewing ? 'opacity-50' : ''}`}
                        >
                          <Text className="text-state-danger text-[10px] font-black uppercase">{reviewReject.label}</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                </View>
              );
            })
          )}
        </View>
      )}
    </View>
  );
}