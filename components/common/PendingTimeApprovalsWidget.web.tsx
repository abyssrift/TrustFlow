import { supabase } from '@/lib/supabase';
import { useThemeColors } from '@/hooks/useThemeColors';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Text, TouchableOpacity, View } from 'react-native';

type PendingEntry = {
  id: string;
  declared_minutes: number;
  reason: string | null;
  flag_reason: string | null;
  logged_at: string;
  task_id: string;
  task_title: string;
  worker: { id: string; full_name: string | null; avatar_url: string | null };
};

function formatMinutes(m: number) {
  const h = Math.floor(m / 60);
  const min = m % 60;
  if (h > 0 && min > 0) return `${h}h ${min}m`;
  if (h > 0) return `${h}h`;
  return `${min}m`;
}

function CompactEntryRow({ entry, onReviewed }: { entry: PendingEntry; onReviewed: () => void }) {
  const colors = useThemeColors();
  const router = useRouter();
  const [loading, setLoading] = useState<'approve' | 'reject' | null>(null);

  const handleApprove = async () => {
    setLoading('approve');
    try {
      const { error } = await supabase.rpc('rpc_review_manual_time', {
        p_entry_id: entry.id,
        p_approve: true,
        p_rejection_reason: null,
      });
      if (error) throw error;
      onReviewed();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not approve entry');
    } finally {
      setLoading(null);
    }
  };

  const handleReject = () => {
    Alert.alert(
      'Reject Declaration',
      `Reject ${entry.worker.full_name ?? 'worker'}'s ${formatMinutes(entry.declared_minutes)} declaration on "${entry.task_title}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reject',
          style: 'destructive',
          onPress: async () => {
            setLoading('reject');
            try {
              const { error } = await supabase.rpc('rpc_review_manual_time', {
                p_entry_id: entry.id,
                p_approve: false,
                p_rejection_reason: null,
              });
              if (error) throw error;
              onReviewed();
            } catch (err: any) {
              Alert.alert('Error', err.message || 'Could not reject entry');
            } finally {
              setLoading(null);
            }
          },
        },
      ]
    );
  };

  return (
    <View className="border-t border-surface-border/40 pt-3">
      {/* Task title + time badge */}
      <TouchableOpacity
        onPress={() => router.push(`/task/${entry.task_id}` as any)}
        className="flex-row items-center justify-between mb-1.5 active:opacity-70"
      >
        <Text className="text-typography-main text-xs font-black flex-1 mr-2" numberOfLines={1}>
          {entry.task_title}
        </Text>
        <View className="bg-state-warning/15 border border-state-warning/30 px-2 py-0.5 rounded-lg flex-shrink-0">
          <Text className="text-state-warning text-[9px] font-black uppercase tracking-wider">
            {formatMinutes(entry.declared_minutes)}
          </Text>
        </View>
      </TouchableOpacity>

      {/* Worker */}
      <View className="flex-row items-center gap-1.5 mb-2">
        <FontAwesome name="user-circle" size={9} color={colors.primary} />
        <Text className="text-typography-dim text-[10px] font-medium">
          {entry.worker.full_name ?? 'Unknown'}
        </Text>
      </View>

      {/* Flag */}
      {entry.flag_reason && (
        <View className="flex-row items-start gap-1 mb-2">
          <FontAwesome name="exclamation-circle" size={9} color={colors.danger} style={{ marginTop: 1 }} />
          <Text className="text-state-danger text-[9px] leading-3 flex-1" numberOfLines={2}>
            {entry.flag_reason}
          </Text>
        </View>
      )}

      {/* Actions */}
      <View className="flex-row gap-2">
        <TouchableOpacity
          onPress={handleApprove}
          disabled={!!loading}
          className={`flex-1 bg-state-success/15 py-1.5 rounded-xl border border-state-success/25 items-center justify-center active:opacity-75 ${loading === 'approve' ? 'opacity-50' : ''}`}
        >
          {loading === 'approve' ? (
            <ActivityIndicator size="small" color={colors.success} />
          ) : (
            <Text className="text-state-success text-[9px] font-black uppercase tracking-wider">Approve</Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleReject}
          disabled={!!loading}
          className={`flex-1 bg-state-danger/15 py-1.5 rounded-xl border border-state-danger/25 items-center justify-center active:opacity-75 ${loading === 'reject' ? 'opacity-50' : ''}`}
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

type Props = {
  refreshKey?: number;
};

export default function PendingTimeApprovalsWidget({ refreshKey }: Props) {
  const colors = useThemeColors();
  const [entries, setEntries] = useState<PendingEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchEntries = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('rpc_get_my_pending_time_approvals');
      if (error) throw error;
      setEntries((data as PendingEntry[]) ?? []);
    } catch (err) {
      console.error('[PendingTimeApprovalsWidget]', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchEntries(); }, [fetchEntries, refreshKey]);

  if (loading || entries.length === 0) return null;

  const removeEntry = (id: string) =>
    setEntries(prev => prev.filter(e => e.id !== id));

  return (
    <View className="flex-1 min-w-[240px] bg-surface-card p-8 rounded-[32px] border border-state-warning/35 premium-shadow">
      {/* Icon */}
      <View className="w-14 h-14 rounded-2xl bg-state-warning/10 items-center justify-center mb-6 border border-state-warning/20">
        <FontAwesome name="hourglass-end" size={22} color={colors.warning} />
      </View>

      {/* Label + count */}
      <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.2em] mb-2">
        Declarations Pending
      </Text>
      <Text className="text-typography-main text-5xl font-black tracking-tighter">
        {entries.length}
      </Text>
      <Text className="text-state-warning text-[10px] font-black uppercase tracking-widest mt-3 mb-2">
        Awaiting review
      </Text>

      {/* Entries */}
      <View className="gap-3 mt-2">
        {entries.map(entry => (
          <CompactEntryRow
            key={entry.id}
            entry={entry}
            onReviewed={() => removeEntry(entry.id)}
          />
        ))}
      </View>
    </View>
  );
}
