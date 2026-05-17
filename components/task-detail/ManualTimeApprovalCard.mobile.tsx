import { useTaskDetail, type ManualTimeApprovalEntry } from '@/contexts/TaskDetailContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useState } from 'react';
import { ActivityIndicator, Alert, Text, TouchableOpacity, View } from 'react-native';

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
  const [loading, setLoading] = useState<'approve' | 'reject' | null>(null);

  const handleApprove = async () => {
    setLoading('approve');
    try {
      await reviewManualTime(entry.id, true);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not approve time declaration');
    } finally {
      setLoading(null);
    }
  };

  const handleReject = () => {
    Alert.alert(
      'Reject Declaration',
      `Reject ${entry.user?.full_name ?? 'worker'}'s ${formatMinutes(entry.declared_minutes)} declaration?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reject',
          style: 'destructive',
          onPress: async () => {
            setLoading('reject');
            try {
              await reviewManualTime(entry.id, false);
            } catch (err: any) {
              Alert.alert('Error', err.message || 'Could not reject time declaration');
            } finally {
              setLoading(null);
            }
          },
        },
      ]
    );
  };

  const isLoading = !!loading;

  return (
    <View className="bg-surface-overlay rounded-xl p-3 mb-2 last:mb-0 border border-state-warning/25">
      <View className="flex-row items-center justify-between mb-2">
        <View className="flex-row items-center gap-2 flex-1">
          <View className="w-6 h-6 rounded-full bg-state-warning/20 items-center justify-center">
            <FontAwesome name="hourglass-end" size={11} color={colors.warning} />
          </View>
          <View className="flex-1">
            <Text className="text-state-warning font-black text-xs uppercase tracking-wider">
              {entry.user?.full_name || 'Worker'}
            </Text>
            <Text className="text-state-warning/70 text-[9px]">
              {formatMinutes(entry.declared_minutes)} declared
            </Text>
          </View>
        </View>
      </View>

      {entry.reason && (
        <Text className="text-typography-dim text-[10px] leading-4 mb-2">{entry.reason}</Text>
      )}

      {entry.flag_reason && (
        <View className="bg-state-danger/8 border border-state-danger/20 rounded-lg px-2 py-1.5 mb-2 flex-row items-start gap-1.5">
          <FontAwesome name="exclamation-circle" size={9} color={colors.danger} style={{ marginTop: 2 }} />
          <Text className="text-state-danger text-[9px] leading-3 flex-1">{entry.flag_reason}</Text>
        </View>
      )}

      <View className="flex-row gap-1.5">
        <TouchableOpacity
          onPress={handleApprove}
          disabled={isLoading}
          className={`flex-1 bg-state-success/20 py-1.5 rounded-lg border border-state-success/30 items-center justify-center active:opacity-75 ${loading === 'approve' ? 'opacity-60' : ''}`}
        >
          {loading === 'approve' ? (
            <ActivityIndicator size="small" color={colors.success} />
          ) : (
            <Text className="text-state-success text-[9px] font-black uppercase tracking-wider">Approve</Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleReject}
          disabled={isLoading}
          className={`flex-1 bg-state-danger/20 py-1.5 rounded-lg border border-state-danger/30 items-center justify-center active:opacity-75 ${loading === 'reject' ? 'opacity-60' : ''}`}
        >
          {loading === 'reject' ? (
            <ActivityIndicator size="small" color={colors.danger} />
          ) : (
            <Text className="text-state-danger text-[9px] font-black uppercase tracking-wider">Reject</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function ManualTimeApprovalCardMobile({ entries }: Props) {
  if (entries.length === 0) return null;

  return (
    <View>
      {entries.map(entry => (
        <EntryRow key={entry.id} entry={entry} />
      ))}
    </View>
  );
}
