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

function EntryRow({ entry, onReviewed }: { entry: PendingEntry; onReviewed: () => void }) {
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
    <View className="py-3 border-b border-surface-border/20 last:border-0">
      {/* Task title */}
      <TouchableOpacity onPress={() => router.push(`/task/${entry.task_id}` as any)}>
        <Text className="text-typography-main text-xs font-bold mb-1.5" numberOfLines={1}>
          {entry.task_title}
        </Text>
      </TouchableOpacity>

      <View className="flex-row items-center justify-between">
        {/* Worker + time */}
        <View className="flex-row items-center gap-2 flex-1 mr-2">
          <View className="w-5 h-5 rounded-full bg-brand-primary/20 items-center justify-center flex-shrink-0">
            <FontAwesome name="user" size={8} color={colors.primary} />
          </View>
          <Text className="text-typography-dim text-[10px] font-medium flex-1" numberOfLines={1}>
            {entry.worker.full_name ?? 'Unknown'}
          </Text>
          <View className="bg-state-warning/10 border border-state-warning/30 px-2 py-0.5 rounded-md flex-shrink-0">
            <Text className="text-state-warning text-[9px] font-black uppercase tracking-wider">
              {formatMinutes(entry.declared_minutes)}
            </Text>
          </View>
        </View>

        {/* Action buttons */}
        <View className="flex-row gap-1.5">
          <TouchableOpacity
            onPress={handleApprove}
            disabled={!!loading}
            className={`px-3 py-1.5 rounded-lg bg-state-success/10 border border-state-success/30 items-center justify-center ${loading ? 'opacity-50' : ''}`}
          >
            {loading === 'approve' ? (
              <ActivityIndicator size="small" color={colors.success} />
            ) : (
              <FontAwesome name="check" size={10} color={colors.success} />
            )}
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleReject}
            disabled={!!loading}
            className={`px-3 py-1.5 rounded-lg bg-state-danger/10 border border-state-danger/30 items-center justify-center ${loading ? 'opacity-50' : ''}`}
          >
            {loading === 'reject' ? (
              <ActivityIndicator size="small" color={colors.danger} />
            ) : (
              <FontAwesome name="times" size={10} color={colors.danger} />
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Flag reason */}
      {entry.flag_reason && (
        <View className="mt-1.5 bg-state-danger/5 border border-state-danger/15 rounded-lg px-2.5 py-1.5">
          <Text className="text-state-danger text-[9px] leading-relaxed" numberOfLines={2}>
            {entry.flag_reason}
          </Text>
        </View>
      )}
    </View>
  );
}

type Props = {
  /** Pass a changing value (e.g. refreshing counter) to trigger a re-fetch from the parent */
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

  if (loading) return null;
  if (entries.length === 0) return null;

  const removeEntry = (id: string) =>
    setEntries(prev => prev.filter(e => e.id !== id));

  return (
    <View className="bg-surface-card rounded-2xl border border-state-warning/40 p-4 mb-6 premium-shadow">
      {/* Header */}
      <View className="flex-row items-center gap-2 mb-3">
        <View className="w-7 h-7 rounded-full bg-state-warning/15 items-center justify-center">
          <FontAwesome name="clock-o" size={12} color={colors.warning} />
        </View>
        <Text className="text-state-warning text-[10px] font-black uppercase tracking-[0.15em] flex-1">
          Time Declarations Pending
        </Text>
        <View className="bg-state-warning/20 border border-state-warning/40 w-6 h-6 rounded-full items-center justify-center">
          <Text className="text-state-warning text-[10px] font-black">{entries.length}</Text>
        </View>
      </View>

      {/* Entries */}
      {entries.map(entry => (
        <EntryRow
          key={entry.id}
          entry={entry}
          onReviewed={() => removeEntry(entry.id)}
        />
      ))}

      {/* Footer hint */}
      <Text className="text-typography-dim text-[9px] font-medium mt-2 text-center">
        Tap a task title to review full details
      </Text>
    </View>
  );
}
