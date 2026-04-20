import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Alert, TextInput } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useTaskDetail } from '@/contexts/TaskDetailContext';

const TYPE_STYLES: Record<string, { bg: string; border: string; text: string; icon: string }> = {
  success:  { bg: 'bg-state-success/10', border: 'border-state-success/30', text: 'text-state-success', icon: 'check' },
  warning:  { bg: 'bg-state-warning/10', border: 'border-state-warning/30', text: 'text-state-warning', icon: 'refresh' },
  danger:   { bg: 'bg-state-danger/10',  border: 'border-state-danger/30',  text: 'text-state-danger',  icon: 'times' },
  neutral:  { bg: 'bg-surface-overlay',  border: 'border-surface-border',   text: 'text-typography-main', icon: 'arrow-right' },
  primary:  { bg: 'bg-brand-primary/10', border: 'border-brand-primary/30', text: 'text-brand-primary', icon: 'play' }
};

const STATUS_STYLES: Record<string, { bg: string; border: string; text: string; label: string }> = {
  approved:       { bg: 'bg-state-success/10', border: 'border-state-success/30', text: 'text-state-success', label: 'Approved' },
  needs_revision: { bg: 'bg-state-warning/10', border: 'border-state-warning/30', text: 'text-state-warning', label: 'Needs Revision' },
  rejected:       { bg: 'bg-state-danger/10',  border: 'border-state-danger/30',  text: 'text-state-danger',  label: 'Rejected' },
  pending:        { bg: 'bg-state-info/10',    border: 'border-state-info/30',    text: 'text-state-info',    label: 'Pending Review' },
};

export default function StageActions() {
  const { data, executeAction } = useTaskDetail();
  
  // States
  const [loadingActionId, setLoadingActionId] = useState<string | null>(null);
  const [submissionContent, setSubmissionContent] = useState('');

  if (!data) return null;

  const handleAction = async (actionId: string, payload: any = {}) => {
    try {
      setLoadingActionId(actionId);
      await executeAction(actionId, payload);
      if (payload.content) setSubmissionContent('');
    } catch (err: any) {
      Alert.alert('Action Failed', err.message || 'Could not perform action');
    } finally {
      setLoadingActionId(null);
    }
  };

  const actionable = data.stage_actions.filter(a => a.can_perform && a.precondition_met);
  
  // Group actions by type
  const submitAction = actionable.find(a => a.action_type === 'submit_work');
  const reviewApprove = actionable.find(a => a.action_type === 'review_approve');
  const reviewRevise = actionable.find(a => a.action_type === 'review_revise');
  const reviewReject = actionable.find(a => a.action_type === 'review_reject');
  
  const hasReviewActions = reviewApprove || reviewRevise || reviewReject;

  const buttonActions = actionable.filter(a => 
    !['submit_work', 'review_approve', 'review_revise', 'review_reject'].includes(a.action_type)
  );

  const hasAnyActions = buttonActions.length > 0;
  const hasSubmissions = data.submissions.length > 0;

  // Don't render anything if there's absolutely nothing to show (no actions, no submissions)
  if (!hasAnyActions && !submitAction && !hasSubmissions) return null;

  return (
    <View className="gap-4">
      {/* 1. Normal Stage Action Buttons */}
      {buttonActions.length > 0 && (
        <View className="bg-surface-card rounded-2xl border border-surface-border p-4">
          <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.15em] mb-3">Stage Actions</Text>
          <View className="flex-row flex-wrap gap-2">
            {buttonActions.map(a => {
              const style = TYPE_STYLES[a.style] || TYPE_STYLES.neutral;
              const isLoading = loadingActionId === a.id;
              
              return (
                <TouchableOpacity
                  key={a.id}
                  disabled={isLoading}
                  onPress={() => handleAction(a.id)}
                  className={`flex-row items-center px-4 py-2.5 rounded-xl border ${style.bg} ${style.border} ${isLoading ? 'opacity-50' : ''}`}
                >
                  {isLoading ? (
                    <ActivityIndicator size="small" color="#6366f1" />
                  ) : (
                    <>
                      <FontAwesome name={(a.icon as any) || style.icon} size={11} color={undefined} />
                      <Text className={`${style.text} text-xs font-black uppercase tracking-wider ml-2`}>
                        {a.label}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )}

      {/* 2. Submissions / Work Output Panel */}
      {(submitAction || hasSubmissions) && (
        <View className="bg-surface-card rounded-2xl border border-surface-border p-4">
          <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.15em] mb-3">
            Submissions ({data.submissions.length})
          </Text>

          {/* Submit Work Form */}
          {submitAction && (
            <View className="mb-4 pb-4 border-b border-surface-border/30">
              <TextInput
                value={submissionContent}
                onChangeText={setSubmissionContent}
                placeholder="Describe your work submission..."
                placeholderTextColor="#64748b"
                multiline
                numberOfLines={3}
                className="bg-surface-background border border-surface-border rounded-xl p-3 text-typography-main text-sm mb-3 min-h-[80px]"
                style={{ textAlignVertical: 'top' }}
              />
              <View className="flex-row items-center justify-between">
                <TouchableOpacity disabled className="flex-row items-center opacity-30">
                  <FontAwesome name="paperclip" size={14} color="#64748b" />
                  <Text className="text-typography-dim text-[10px] font-bold ml-1.5">Attach (Coming Soon)</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleAction(submitAction.id, { content: submissionContent.trim() })}
                  disabled={loadingActionId === submitAction.id || !submissionContent.trim()}
                  className={`bg-brand-primary px-5 py-2.5 rounded-xl ${(!submissionContent.trim() || loadingActionId === submitAction.id) ? 'opacity-50' : ''}`}
                >
                  {loadingActionId === submitAction.id ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text className="text-typography-main text-xs font-black">{submitAction.label}</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Submission History */}
          {!hasSubmissions ? (
            <View className="py-4 items-center opacity-40">
              <FontAwesome name="inbox" size={20} color="#64748b" />
              <Text className="text-typography-muted text-xs mt-2">No submissions yet</Text>
            </View>
          ) : (
            data.submissions.map(s => {
              const style = STATUS_STYLES[s.status] || STATUS_STYLES.pending;
              const isReviewing = [reviewApprove?.id, reviewRevise?.id, reviewReject?.id].includes(loadingActionId as any);

              // Render review actions only for the latest pending submission
              // Note: the backend verifies 'latest pending view' inside the RPC
              const showReviewActions = s.status === 'pending' && hasReviewActions;

              return (
                <View key={s.id} className="mb-3 pb-3 border-b border-surface-border/20 last:border-0">
                  <View className="flex-row items-center justify-between mb-2">
                    <View className={`${style.bg} ${style.border} border px-2 py-0.5 rounded-md`}>
                      <Text className={`${style.text} text-[9px] font-black uppercase`}>{style.label}</Text>
                    </View>
                    {s.stage_name && (
                      <Text className="text-typography-dim text-[9px] font-bold">{s.stage_name}</Text>
                    )}
                  </View>

                  {s.content && (
                    <Text className="text-typography-label text-sm leading-5 mb-2">{s.content}</Text>
                  )}

                  <View className="flex-row items-center gap-2">
                    <Text className="text-typography-dim text-[9px] font-bold">
                      by {s.submitted_by?.full_name || 'Unknown'}
                    </Text>
                    <Text className="text-typography-dim text-[9px]">
                      {new Date(s.submitted_at).toLocaleDateString()}
                    </Text>
                  </View>

                  {s.review_notes && (
                    <View className="bg-surface-background rounded-lg p-2.5 mt-2 border border-surface-border/50">
                      <Text className="text-typography-dim text-[9px] font-black uppercase mb-1">Review Notes</Text>
                      <Text className="text-typography-label text-xs leading-4">{s.review_notes}</Text>
                      <Text className="text-typography-dim text-[9px] mt-1">— {s.reviewed_by?.full_name}</Text>
                    </View>
                  )}

                  {showReviewActions && (
                    <View className="flex-row gap-2 mt-3">
                      {reviewApprove && (
                        <TouchableOpacity
                          disabled={isReviewing}
                          onPress={() => handleAction(reviewApprove.id)}
                          className={`flex-1 bg-state-success/10 py-2 rounded-xl border border-state-success/30 items-center ${isReviewing ? 'opacity-50' : ''}`}
                        >
                          <Text className="text-state-success text-[10px] font-black uppercase">{reviewApprove.label}</Text>
                        </TouchableOpacity>
                      )}
                      {reviewRevise && (
                        <TouchableOpacity
                          disabled={isReviewing}
                          onPress={() => handleAction(reviewRevise.id)}
                          className={`flex-1 bg-state-warning/10 py-2 rounded-xl border border-state-warning/30 items-center ${isReviewing ? 'opacity-50' : ''}`}
                        >
                          <Text className="text-state-warning text-[10px] font-black uppercase">{reviewRevise.label}</Text>
                        </TouchableOpacity>
                      )}
                      {reviewReject && (
                        <TouchableOpacity
                          disabled={isReviewing}
                          onPress={() => handleAction(reviewReject.id)}
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
