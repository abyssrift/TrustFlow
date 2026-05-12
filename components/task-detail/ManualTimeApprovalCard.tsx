import { useTaskDetail, type ManualTimeApprovalEntry } from '@/contexts/TaskDetailContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useState } from 'react';
import { ActivityIndicator, Alert, Text, TextInput, TouchableOpacity, View } from 'react-native';

type Props = { entries: ManualTimeApprovalEntry[] };

function formatMinutes(m: number) {
  const h = Math.floor(m / 60);
  const min = m % 60;
  if (h > 0 && min > 0) return `${h}h ${min}m`;
  if (h > 0) return `${h}h`;
  return `${min}m`;
}

function EntryRow({ entry }: { entry: ManualTimeApprovalEntry }) {
  const colors = useThemeColors();
  const { reviewManualTime } = useTaskDetail();
  const [rejectionNote, setRejectionNote] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [loading, setLoading] = useState<'approve' | 'reject' | null>(null);

  const handleApprove = async () => {
    setLoading('approve');
    try {
      await reviewManualTime(entry.id, true);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not approve entry');
    } finally {
      setLoading(null);
    }
  };

  const handleReject = async () => {
    if (!showRejectInput) {
      setShowRejectInput(true);
      return;
    }
    setLoading('reject');
    try {
      await reviewManualTime(entry.id, false, rejectionNote.trim() || undefined);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not reject entry');
    } finally {
      setLoading(null);
      setShowRejectInput(false);
      setRejectionNote('');
    }
  };

  return (
    <View className="mb-3 pb-3 border-b border-surface-border/20 last:border-0">
      {/* User + time */}
      <View className="flex-row items-center justify-between mb-2">
        <View className="flex-row items-center gap-2">
          <View className="w-6 h-6 rounded-full bg-brand-primary/20 items-center justify-center">
            <FontAwesome name="user" size={10} color={colors.primary} />
          </View>
          <Text className="text-typography-main text-xs font-bold">
            {entry.user?.full_name || 'Unknown'}
          </Text>
        </View>
        <View className="bg-state-warning/10 border border-state-warning/30 px-2 py-0.5 rounded-md">
          <Text className="text-state-warning text-[9px] font-black uppercase tracking-wider">
            {formatMinutes(entry.declared_minutes)}
          </Text>
        </View>
      </View>

      {/* Flag reason */}
      <View className="bg-state-danger/5 border border-state-danger/20 rounded-xl p-3 mb-2">
        <View className="flex-row items-start gap-2">
          <FontAwesome name="flag" size={10} color={colors.danger} style={{ marginTop: 1 }} />
          <Text className="text-state-danger text-[10px] font-medium flex-1 leading-relaxed">
            {entry.flag_reason}
          </Text>
        </View>
      </View>

      {/* Worker's reason */}
      {entry.reason && (
        <View className="mb-2">
          <Text className="text-typography-dim text-[9px] font-black uppercase tracking-wider mb-1">Worker's Note</Text>
          <Text className="text-typography-label text-xs leading-4">{entry.reason}</Text>
        </View>
      )}

      {/* Rejection note input */}
      {showRejectInput && (
        <TextInput
          className="bg-surface-background border border-state-danger/40 rounded-xl px-3 py-2 text-typography-main text-xs mb-2"
          placeholder="Reason for rejection (optional)"
          placeholderTextColor={colors.textMuted}
          value={rejectionNote}
          onChangeText={setRejectionNote}
          multiline
          numberOfLines={2}
          autoFocus
        />
      )}

      {/* Actions */}
      <View className="flex-row gap-2 mt-1">
        <TouchableOpacity
          onPress={handleApprove}
          disabled={!!loading}
          className={`flex-1 bg-state-success/10 py-2.5 rounded-xl border border-state-success/30 items-center ${loading ? 'opacity-50' : ''}`}
        >
          {loading === 'approve' ? (
            <ActivityIndicator size="small" color={colors.success} />
          ) : (
            <Text className="text-state-success text-[10px] font-black uppercase tracking-wider">Approve</Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleReject}
          disabled={!!loading}
          className={`flex-1 bg-state-danger/10 py-2.5 rounded-xl border border-state-danger/30 items-center ${loading ? 'opacity-50' : ''}`}
        >
          {loading === 'reject' ? (
            <ActivityIndicator size="small" color={colors.danger} />
          ) : (
            <Text className="text-state-danger text-[10px] font-black uppercase tracking-wider">
              {showRejectInput ? 'Confirm Reject' : 'Reject'}
            </Text>
          )}
        </TouchableOpacity>
        {showRejectInput && (
          <TouchableOpacity
            onPress={() => { setShowRejectInput(false); setRejectionNote(''); }}
            className="px-3 py-2.5 rounded-xl border border-surface-border items-center"
          >
            <FontAwesome name="times" size={12} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

export default function ManualTimeApprovalCard({ entries }: Props) {
  if (entries.length === 0) return null;

  return (
    <View className="bg-surface-card rounded-2xl border border-state-warning/40 p-4">
      <View className="flex-row items-center gap-2 mb-3">
        <View className="w-5 h-5 rounded-full bg-state-warning/20 items-center justify-center">
          <FontAwesome name="clock-o" size={10} color="var(--color-warning)" />
        </View>
        <Text className="text-state-warning text-[10px] font-black uppercase tracking-[0.15em]">
          Time Declarations Pending ({entries.length})
        </Text>
      </View>
      {entries.map(e => <EntryRow key={e.id} entry={e} />)}
    </View>
  );
}
