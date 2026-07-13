import { useAlert } from '@/contexts/AlertContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';

export type ApprovalQueueEntry = {
  id: string;
  declared_minutes: number;
  reason: string | null;
  flag_reason: string | null;
  worker_name: string | null;
  task?: { id: string; title: string } | null;
};

function formatDeclaredMinutes(m: number) {
  const h = Math.floor(m / 60);
  const min = m % 60;
  if (h > 0 && min > 0) return `${h}h ${min}m`;
  if (h > 0) return `${h}h`;
  return `${min}m`;
}

type Props = {
  visible: boolean;
  onClose: () => void;
  entries: ApprovalQueueEntry[];
  onReview: (entryId: string, approve: boolean) => Promise<void>;
  onNavigateToTask?: (taskId: string) => void;
};

export default function ManualTimeApprovalsModal({ visible, onClose, entries, onReview, onNavigateToTask }: Props) {
  const colors = useThemeColors();
  const { showConfirm } = useAlert();
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState<'approve' | 'reject' | null>(null);

  useEffect(() => {
    if (index > entries.length - 1) setIndex(Math.max(0, entries.length - 1));
  }, [entries.length, index]);

  useEffect(() => {
    if (visible && entries.length === 0) onClose();
  }, [visible, entries.length, onClose]);

  if (!visible) return null;

  const entry = entries[index];
  if (!entry) return null;

  const handleApprove = async () => {
    setLoading('approve');
    try {
      await onReview(entry.id, true);
    } finally {
      setLoading(null);
    }
  };

  const handleReject = () => {
    showConfirm(
      'Reject Declaration',
      `Reject ${entry.worker_name ?? 'this worker'}'s ${formatDeclaredMinutes(entry.declared_minutes)} declaration?`,
      async () => {
        setLoading('reject');
        try {
          await onReview(entry.id, false);
        } finally {
          setLoading(null);
        }
      },
      undefined,
      'Reject',
      'Cancel',
      'destructive'
    );
  };

  const isLoading = !!loading;

  return (
    <View className="absolute inset-0 bg-surface-background/40 z-[999] items-center justify-center p-6" style={{ backdropFilter: 'blur(16px)' } as any}>
      <View className="bg-surface-card w-full max-w-[560px] rounded-[2.5rem] border border-surface-border overflow-hidden premium-shadow-lg p-8">

        {/* Header */}
        <View className="flex-row items-center justify-between mb-6">
          <View className="flex-row items-center gap-3 flex-1">
            <View className="w-12 h-12 rounded-2xl bg-state-warning/15 items-center justify-center">
              <FontAwesome name="hourglass-end" size={18} color={colors.warning} />
            </View>
            <View>
              <Text className="text-typography-main text-xl font-black tracking-tight">Time Declarations</Text>
              <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mt-0.5">
                {entries.length > 1 ? `${index + 1} of ${entries.length} pending` : '1 pending'}
              </Text>
            </View>
          </View>
          <TouchableOpacity
            onPress={onClose}
            className="w-9 h-9 bg-surface-background rounded-full items-center justify-center border border-surface-border hover:bg-surface-overlay transition-colors"
          >
            <FontAwesome name="times" size={14} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Queue position dots */}
        {entries.length > 1 && (
          <View className="flex-row gap-1.5 justify-center mb-6">
            {entries.map((e, i) => (
              <View
                key={e.id}
                style={{
                  width: i === index ? 18 : 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: i === index ? colors.warning : colors.border,
                }}
              />
            ))}
          </View>
        )}

        {/* Current entry */}
        <View className="bg-surface-background border border-surface-border rounded-3xl p-6 mb-6">
          <View className="flex-row items-center justify-between mb-4">
            <View className="flex-row items-center gap-2.5 flex-1 min-w-0">
              <View className="w-8 h-8 rounded-full bg-brand-primary/15 items-center justify-center flex-shrink-0">
                <FontAwesome name="user" size={12} color={colors.primary} />
              </View>
              <Text className="text-typography-main font-black text-sm flex-1" numberOfLines={1}>
                {entry.worker_name ?? 'Worker'}
              </Text>
            </View>
            {entry.task && (
              <TouchableOpacity
                onPress={() => onNavigateToTask?.(entry.task!.id)}
                className="bg-brand-primary/10 px-2.5 py-1 rounded-lg ml-2 flex-shrink-0 hover:bg-brand-primary/20 transition-colors"
              >
                <Text className="text-brand-primary text-[9px] font-black uppercase tracking-wide" numberOfLines={1}>
                  {entry.task.title}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          <Text className="text-typography-main text-4xl font-black tracking-tighter mb-1">
            {formatDeclaredMinutes(entry.declared_minutes)}
          </Text>
          <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-4">
            Declared
          </Text>

          {entry.reason && (
            <Text className="text-typography-dim text-sm leading-5 italic mb-3">
              “{entry.reason}”
            </Text>
          )}

          {entry.flag_reason && (
            <View className="bg-state-danger/8 border border-state-danger/20 rounded-xl p-3 flex-row items-start gap-2">
              <FontAwesome name="exclamation-circle" size={11} color={colors.danger} style={{ marginTop: 2 }} />
              <Text className="text-state-danger text-xs leading-4 flex-1">{entry.flag_reason}</Text>
            </View>
          )}
        </View>

        {/* Manual paging */}
        {entries.length > 1 && (
          <View className="flex-row items-center justify-between mb-6 px-2">
            <TouchableOpacity
              onPress={() => setIndex(i => Math.max(0, i - 1))}
              disabled={index === 0}
              style={{ opacity: index === 0 ? 0.3 : 1 }}
              className="flex-row items-center gap-2 py-2"
            >
              <FontAwesome name="chevron-left" size={11} color={colors.textMuted} />
              <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">Prev</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setIndex(i => Math.min(entries.length - 1, i + 1))}
              disabled={index === entries.length - 1}
              style={{ opacity: index === entries.length - 1 ? 0.3 : 1 }}
              className="flex-row items-center gap-2 py-2"
            >
              <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">Next</Text>
              <FontAwesome name="chevron-right" size={11} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        )}

        {/* Actions */}
        <View className="flex-row gap-4">
          <TouchableOpacity
            onPress={handleReject}
            disabled={isLoading}
            className={`flex-1 py-4 rounded-2xl bg-state-danger/15 border border-state-danger/30 items-center justify-center hover:bg-state-danger/25 transition-colors ${loading === 'reject' ? 'opacity-60' : ''}`}
          >
            {loading === 'reject' ? (
              <ActivityIndicator size="small" color={colors.danger} />
            ) : (
              <Text className="text-state-danger font-black uppercase tracking-widest text-xs">Reject</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleApprove}
            disabled={isLoading}
            className={`flex-[2] py-4 rounded-2xl bg-state-success items-center justify-center premium-shadow active:scale-[0.98] transition-all ${loading === 'approve' ? 'opacity-60' : ''}`}
          >
            {loading === 'approve' ? (
              <ActivityIndicator size="small" color="white" />
            ) : (
              <Text className="text-white font-black uppercase tracking-widest text-xs">Approve</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}
