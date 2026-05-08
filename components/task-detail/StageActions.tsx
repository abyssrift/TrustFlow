import { useAuth } from '@/contexts/AuthContext';
import { useSubmission } from '@/contexts/SubmissionContext';
import { useTaskDetail, type StageActionData } from '@/contexts/TaskDetailContext';
import { useTimer } from '@/contexts/TimerContext';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import React, { useState } from 'react';
import { ActivityIndicator, Alert, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { openStorageFile, SUBMISSION_BUCKET } from '@/lib/storage';
import { getActionDescriptor, splitStageActions } from './actionRegistry';
import ManualTimeModal from '@/components/common/ManualTimeModal';

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

export default function StageActions() {
  const { data, executeAction, submitWork, reviewSubmission, deleteSubmission } = useTaskDetail();
  const { isActive, activeSession, serverTimeOffset, stopWork, startWork, smartTimer } = useTimer();
  const { user } = useAuth();
  const [loadingActionId, setLoadingActionId] = useState<string | null>(null);
  const [submissionContent, setSubmissionContent] = useState('');
  const [stagedFiles, setStagedFiles] = useState<any[]>([]);
  const [elapsedLocal, setElapsedLocal] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<{ title: string; message: string; variant?: 'danger' | 'warning' } | null>(null);
  const [showManualTimeModal, setShowManualTimeModal] = useState(false);
  const [pendingSubmitAction, setPendingSubmitAction] = useState<StageActionData | null>(null);
  const [manualTimeLogged, setManualTimeLogged] = useState(false);

  const { submitWithEvidence, activeJobs } = useSubmission();

  React.useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isActive && activeSession && data?.task.id && activeSession.task_id === data.task.id) {
      const start = new Date(activeSession.started_at).getTime();
      setElapsedLocal(Math.floor((Date.now() + serverTimeOffset - start) / 1000));
      timer = setInterval(() => {
        setElapsedLocal(Math.floor((Date.now() + serverTimeOffset - start) / 1000));
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [isActive, activeSession, data?.task.id, serverTimeOffset]);

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

  const handleManualTimeSuccess = async (isFlagged: boolean) => {
    setShowManualTimeModal(false);
    setManualTimeLogged(true);
    const actionToRetry = pendingSubmitAction;
    setPendingSubmitAction(null);
    if (isFlagged) {
      setErrorMsg({
        title: 'Entry Flagged for Review',
        message: 'Your time declaration has been forwarded to your manager. Proceeding with submission.',
        variant: 'warning',
      });
      setTimeout(() => setErrorMsg(null), 5000);
    }
    if (actionToRetry) {
      await handleAction(actionToRetry, true);
    }
  };

  if (!data) return null;

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

  // The submission form shows if:
  // 1. The stage explicitly requires a submission (and we aren't a reviewer just looking at it)
  // 2. Or there is a specific submit action available for the user.
  const showSubmitForm = !!(
    (data.current_stage?.requires_submission && (!hasReviewActions || data.permissions.is_assigned)) ||
    (submitAction && (data.permissions.is_assigned || (data.permissions.is_owner && !hasReviewActions)))
  );

  // The whole section shows if there's a form, or history, or the stage implies it.
  const showSubmissionSection = !!(
    data.submissions.length > 0 || 
    showSubmitForm || 
    submitAction || 
    data.current_stage?.requires_submission
  );

  const stageRequiresTimer = !!data.current_stage?.requires_timer;
  const anyActionRequiresTimer = data.stage_actions.some(a => a.requires_timer && a.can_perform && a.precondition_met);
  const canStart = (data.permissions.is_assigned || data.permissions.is_owner || data.permissions.is_manager);

  const handleAction = async (action: StageActionData, skipTimerCheck: boolean = false) => {
    try {
      setLoadingActionId(action.id);

      if (activeSession?.task_id === data.task.id) {
        await stopWork();
      }

      const descriptor = getActionDescriptor(action.action_type);

      if (descriptor.executionRoute === 'submit_work') {
        // Pre-upload timer check — prevents partial file uploads when gate would block.
        // Uses stale work_sessions data + elapsedLocal (the just-stopped session's time).
        const stage = data.current_stage;
        if (stage?.requires_timer && !stage?.is_initial && !data.permissions.is_owner && !manualTimeLogged && !skipTimerCheck) {
          const completedSeconds = (data.work_sessions || [])
            .filter((s: any) => s.status === 'completed')
            .reduce((sum: number, s: any) => sum + (s.total_seconds_spent || 0), 0);
          const totalSeconds = completedSeconds + elapsedLocal;
          if (totalSeconds < 300) {
            setPendingSubmitAction(action);
            setShowManualTimeModal(true);
            return;
          }
        }

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
        setManualTimeLogged(false);
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
      // Backend safety net: LOW_TIMER_TIME (fires if frontend check was bypassed)
      if (err.message?.includes('LOW_TIMER_TIME')) {
        setPendingSubmitAction(action);
        setShowManualTimeModal(true);
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

  if (!buttonActions.length && !showSubmissionSection && !showTimerCard) return null;

  return (
    <View className="gap-4">
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
            <View className="flex-row items-center">
              <View className={`w-2 h-2 rounded-full mr-3 ${isActive && activeSession?.task_id === data.task.id ? 'bg-state-success animate-pulse' : 'bg-typography-muted'}`} />
              <Text className="text-typography-main font-mono text-xl font-black">
                {Math.floor(elapsedLocal / 3600).toString().padStart(2, '0')}:
                {Math.floor((elapsedLocal % 3600) / 60).toString().padStart(2, '0')}:
                {(elapsedLocal % 60).toString().padStart(2, '0')}
              </Text>
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
                <FontAwesome name="stop" size={10} color="white" />
                <Text className="text-white text-xs font-black uppercase ml-2 tracking-wider">Stop Session</Text>
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
        onSuccess={handleManualTimeSuccess}
        onCancel={() => { setShowManualTimeModal(false); setPendingSubmitAction(null); }}
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
              {/* File Upload Queue */}
              {stagedFiles.length > 0 && (
                <View className="mb-3 gap-2">
                  {stagedFiles.map((file) => (
                    <View key={file.id} className="flex-row items-center bg-surface-overlay px-3 py-2 rounded-lg border border-surface-border/50">
                      <FontAwesome 
                        name={file.type.includes('image') ? 'file-image-o' : 'file-o'} 
                        size={12} 
                        color="var(--color-primary)" 
                      />
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
                  ))}
                </View>
              )}

              <View className="flex-row items-center justify-between">
                <View className="flex-row gap-3">
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
                        <Text className="text-white text-[9px] font-black uppercase ml-2 tracking-tighter">
                          {activeJob.currentAction}
                        </Text>
                      )}
                    </View>
                  ) : (
                    <Text className="text-white text-xs font-black uppercase tracking-wider">{submitAction?.label || 'Submit Work'}</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}

          {data.submissions.length === 0 ? (
            <View className="py-4 items-center opacity-40">
              <FontAwesome name="inbox" size={20} color="var(--color-text-dim)" />
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
                        const { name: iconName, color: iconColor } = getFileIcon(a.mime_type);
                        return (
                          <TouchableOpacity
                            key={a.id}
                            onPress={() => openStorageFile(SUBMISSION_BUCKET, a.storage_path || a.file_url)}
                            className="flex-row items-center bg-surface-background px-2.5 py-2 rounded-lg border border-surface-border/50 active:opacity-70"
                          >
                            <FontAwesome name={iconName as any} size={12} color={iconColor} />
                            <Text className="text-typography-main text-[11px] font-bold ml-2 flex-1" numberOfLines={1}>
                              {a.file_name}
                            </Text>
                            <FontAwesome name="external-link" size={9} color="var(--color-text-muted)" />
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}

                  <View className="flex-row items-center gap-2">
                    <Text className="text-typography-dim text-[9px] font-bold">by {s.submitted_by?.full_name || 'Unknown'}</Text>
                    <Text className="text-typography-dim text-[9px]">{new Date(s.submitted_at).toLocaleDateString()}</Text>
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
                        <FontAwesome name="trash-o" size={11} color="var(--color-danger)" />
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
