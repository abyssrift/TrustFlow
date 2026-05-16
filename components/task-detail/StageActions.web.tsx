import ManualTimeModal from '@/components/common/ManualTimeModal';
import ManualTimeApprovalCard from '@/components/task-detail/ManualTimeApprovalCard';
import { useAuth } from '@/contexts/AuthContext';
import { useSubmission } from '@/contexts/SubmissionContext';
import { useTaskDetail, type StageActionData } from '@/contexts/TaskDetailContext';
import { useTimer } from '@/contexts/TimerContext';
import { openStorageFile, SUBMISSION_BUCKET } from '@/lib/storage';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Alert, AppState, Platform, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { getActionDescriptor, splitStageActions } from './actionRegistry';

function getFileIcon(mimeType: string | null): { name: string; color: string } {
  const t = (mimeType || '').toLowerCase();
  if (t.includes('image')) return { name: 'file-image-o', color: 'var(--color-warning)' };
  if (t.includes('pdf')) return { name: 'file-pdf-o', color: 'var(--color-danger)' };
  if (t.includes('spreadsheet') || t.includes('excel') || t.includes('csv')) return { name: 'file-excel-o', color: 'var(--color-success)' };
  if (t.includes('word') || t.includes('document') || t.includes('text')) return { name: 'file-text-o', color: 'var(--color-info)' };
  return { name: 'file-o', color: 'var(--color-text-muted)' };
}

const STATUS_STYLES: Record<string, { bg: string; border: string; text: string; label: string }> = {
  approved: { bg: 'bg-state-success-dim', border: 'border-state-success/30', text: 'text-state-success', label: 'Approved' },
  needs_revision: { bg: 'bg-state-warning-dim', border: 'border-state-warning/30', text: 'text-state-warning', label: 'Needs Revision' },
  rejected: { bg: 'bg-state-danger-dim', border: 'border-state-danger/30', text: 'text-state-danger', label: 'Rejected' },
  pending: { bg: 'bg-state-info-dim', border: 'border-state-info/30', text: 'text-state-info', label: 'Pending Review' },
};

export default function StageActionsWeb() {
  const { data, executeAction, submitWork, reviewSubmission, deleteSubmission } = useTaskDetail();
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
  const grouped = splitStageActions(actionable);
  const buttonActions = grouped.buttons;
  const submitAction = grouped.submission[0] || null;
  const reviewApprove = grouped.review.find((a) => a.action_type === 'review_approve');
  const reviewRevise = grouped.review.find((a) => a.action_type === 'review_revise');
  const reviewReject = grouped.review.find((a) => a.action_type === 'review_reject');
  const hasReviewActions = !!(reviewApprove || reviewRevise || reviewReject);
  const pendingSubmission = data.submissions.find((s) => s.status === 'pending');

  const showSubmitForm = !!(
    (data.current_stage?.requires_submission && (!hasReviewActions || data.permissions.is_assigned)) ||
    (submitAction && (data.permissions.is_assigned || (data.permissions.is_owner && !hasReviewActions)))
  );

  const showSubmissionSection = !!(
    data.submissions.length > 0 ||
    showSubmitForm ||
    submitAction ||
    data.current_stage?.requires_submission
  );

  const stageRequiresTimer = !!data.current_stage?.requires_timer;
  const anyActionRequiresTimer = data.stage_actions.some(a => a.requires_timer && a.can_perform && a.precondition_met);

  const handleAction = async (action: StageActionData) => {
    try {
      setLoadingActionId(action.id);

      const descriptor = getActionDescriptor(action.action_type);

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
          stagedFiles,
        });

        setSubmissionContent('');
        setStagedFiles([]);
        return;
      }

      if (descriptor.executionRoute === 'review_submission') {
        if (!pendingSubmission) {
          Alert.alert('No Pending Submission', 'There is no pending submission available for review.');
          return;
        }
        const decision =
          action.action_type === 'review_approve'
            ? 'approved'
            : action.action_type === 'review_revise'
              ? 'needs_revision'
              : 'rejected';
        const targetTransition = action.transition_id
          ? data.available_transitions.find(t => t.id === action.transition_id)
          : null;
        await reviewSubmission(pendingSubmission.id, decision, undefined, targetTransition?.to_stage_id);
        return;
      }

      await executeAction(action.id);
    } catch (err: any) {
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
            <FontAwesome name="bolt" size={14} color="var(--color-primary)" />
            <Text className="text-brand-primary font-black text-xs uppercase tracking-widest ml-2">
              Navigate to {linkedPipelineName}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {data.permissions.is_manager && data.pending_time_approvals?.length > 0 && (
        <ManualTimeApprovalCard entries={data.pending_time_approvals} />
      )}

      {isMyEntryPending && !errorMsg && (
        <View className="bg-state-warning/10 border border-state-warning/30 rounded-2xl p-4 flex-row items-start gap-4">
          <View className="w-10 h-10 rounded-xl bg-state-warning/20 items-center justify-center">
            <FontAwesome name="lock" size={14} color="var(--color-warning)" />
          </View>
          <View className="flex-1">
            <View className="flex-row items-center gap-2 mb-2">
              <View className="bg-state-warning/20 px-2.5 py-1 rounded-full border border-state-warning/20 flex-row items-center gap-1.5">
                <FontAwesome name="lock" size={10} color="var(--color-warning)" />
                <Text className="text-state-warning text-[9px] font-black uppercase tracking-[0.18em]">Stage Locked</Text>
              </View>
              <Text className="text-state-warning text-[9px] font-bold uppercase tracking-[0.18em]">
                Awaiting Manager Approval
              </Text>
            </View>
            <Text className="text-state-warning text-sm leading-6">
              You declared {myEntry?.declared_minutes ?? 0} min of work on this stage. Advancement is locked until your manager approves the declaration.
            </Text>
          </View>
        </View>
      )}

      {isMyEntryRejected && !errorMsg && (
        <View className="bg-state-danger/10 border border-state-danger/30 rounded-2xl p-4">
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

      {errorMsg && (
        <View className={`rounded-2xl p-4 ${
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

      {showTimerCard && (
        <View className="bg-surface-card rounded-2xl border border-surface-border p-4">
          <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.15em] mb-3">Time Tracking</Text>
          <View className="flex-row items-center justify-between gap-4">
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
              <TextInput
                value={submissionContent}
                onChangeText={(val) => {
                  setSubmissionContent(val);
                  smartTimer.recordActivity();
                }}
                placeholder="Describe your work submission..."
                placeholderTextColor="var(--color-text-dim)"
                multiline
                numberOfLines={3}
                className="bg-surface-background border border-surface-border rounded-xl p-3 text-typography-main text-sm mb-3 min-h-[80px]"
              />
              {stagedFiles.length > 0 && (
                <View className="mb-3 gap-2">
                  {stagedFiles.map((file) => {
                    const fileIcon = getFileIcon(file.type);
                    return (
                      <View key={file.id} className="flex-row items-center bg-surface-overlay px-3 py-2 rounded-lg border border-surface-border/50">
                        <FontAwesome name={fileIcon.name as any} size={12} color={fileIcon.color} />
                        <Text className="text-typography-main text-[11px] font-bold ml-2 flex-1" numberOfLines={1}>
                          {file.name}
                        </Text>
                        {isUploading ? (
                          <ActivityIndicator size="small" color="var(--color-primary)" className="scale-75" />
                        ) : (
                          <TouchableOpacity onPress={() => removeFile(file.id)} className="ml-2 p-1">
                            <FontAwesome name="times-circle" size={12} color="var(--color-danger)" />
                          </TouchableOpacity>
                        )}
                      </View>
                    );
                  })}
                </View>
              )}

              <View className="flex-row flex-wrap items-center justify-between gap-3">
                <View className="flex-row flex-wrap gap-3">
                  <TouchableOpacity
                    onPress={pickImage}
                    disabled={isUploading}
                    className="flex-row items-center bg-surface-background px-3 py-2 rounded-xl border border-surface-border active:opacity-70"
                  >
                    <FontAwesome name="camera" size={11} color="var(--color-primary)" />
                    <Text className="text-brand-primary text-[10px] font-black uppercase ml-1.5">Add Photo</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={pickDocument}
                    disabled={isUploading}
                    className="flex-row items-center bg-surface-background px-3 py-2 rounded-xl border border-surface-border active:opacity-70"
                  >
                    <FontAwesome name="paperclip" size={11} color="var(--color-primary)" />
                    <Text className="text-brand-primary text-[10px] font-black uppercase ml-1.5">Attach File</Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  onPress={() => {
                    if (submitAction) {
                      handleAction(submitAction);
                    }
                  }}
                  disabled={!submitAction || (submissionContent.trim() === '' && stagedFiles.length === 0) || loadingActionId === submitAction.id || isUploading}
                  className={`bg-brand-primary px-5 py-2.5 rounded-xl ${(!submitAction || (submissionContent.trim() === '' && stagedFiles.length === 0) || loadingActionId === submitAction?.id || isUploading) ? 'opacity-50' : ''}`}
                >
                  {loadingActionId === submitAction?.id || isUploading ? (
                    <View className="flex-row items-center">
                      <ActivityIndicator size="small" color="white" />
                      {activeJob?.currentAction && (
                        <Text className="text-white text-xs font-black uppercase ml-2 tracking-wider">
                          {activeJob.currentAction}
                        </Text>
                      )}
                    </View>
                  ) : (
                    <Text className="text-white text-xs font-black uppercase tracking-wider">Submit Work</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}

          {data.submissions.length > 0 && (
            <View className="gap-3">
              {data.submissions.map((submission) => {
                const status = STATUS_STYLES[submission.status] || STATUS_STYLES.pending;
                return (
                  <View key={submission.id} className="bg-surface-background rounded-xl border border-surface-border p-4">
                    <View className="flex-row items-center justify-between mb-3">
                      <View className="flex-row items-center gap-2">
                        <View className={`px-2.5 py-1 rounded-full border ${status.bg} ${status.border}`}>
                          <Text className={`${status.text} text-[9px] font-black uppercase tracking-[0.18em]`}>
                            {status.label}
                          </Text>
                        </View>
                        <Text className="text-typography-dim text-[10px] font-bold uppercase tracking-[0.18em]">
                          {submission.created_at ? new Date(submission.created_at).toLocaleString() : 'Recently'}
                        </Text>
                      </View>

                      <View className="flex-row items-center gap-2">
                        {submission.status === 'pending' && data.permissions.is_manager && (
                          <Text className="text-typography-dim text-[10px] font-bold uppercase tracking-[0.18em]">
                            Awaiting review
                          </Text>
                        )}
                      </View>
                    </View>

                    {submission.content && (
                      <Text className="text-typography-main text-sm leading-6 mb-3">
                        {submission.content}
                      </Text>
                    )}

                    {submission.files?.length > 0 && (
                      <View className="gap-2 mb-3">
                        {submission.files.map((file: any) => (
                          <TouchableOpacity
                            key={file.id}
                            onPress={() => openStorageFile(SUBMISSION_BUCKET, file.path)}
                            className="flex-row items-center bg-surface-card px-3 py-2 rounded-lg border border-surface-border/50"
                          >
                            <FontAwesome name={file.file_type?.includes('image') ? 'file-image-o' : 'file-o'} size={12} color="var(--color-primary)" />
                            <Text className="text-typography-main text-[11px] font-bold ml-2 flex-1" numberOfLines={1}>
                              {file.name}
                            </Text>
                            <Text className="text-typography-dim text-[9px] font-bold uppercase tracking-wider">
                              Open
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}

                    {submission.status === 'pending' && data.permissions.is_manager && (
                      <View className="flex-row gap-2 pt-1">
                        <TouchableOpacity
                          onPress={async () => {
                            await reviewSubmission(submission.id, 'approved');
                          }}
                          className="flex-1 bg-state-success/10 border border-state-success/30 rounded-xl py-2.5 items-center"
                        >
                          <Text className="text-state-success text-[10px] font-black uppercase tracking-[0.18em]">Approve</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={async () => {
                            await reviewSubmission(submission.id, 'rejected');
                          }}
                          className="flex-1 bg-state-danger/10 border border-state-danger/30 rounded-xl py-2.5 items-center"
                        >
                          <Text className="text-state-danger text-[10px] font-black uppercase tracking-[0.18em]">Reject</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          )}
        </View>
      )}
    </View>
  );
}