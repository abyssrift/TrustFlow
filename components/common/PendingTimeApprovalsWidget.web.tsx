import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { useThemeColors } from '@/hooks/useThemeColors';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Text, TouchableOpacity, View } from 'react-native';
import ManualTimeApprovalsModal from './ManualTimeApprovalsModal';

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

type Props = {
  refreshKey?: number;
};

export default function PendingTimeApprovalsWidget({ refreshKey }: Props) {
  const colors = useThemeColors();
  const router = useRouter();
  const { profile } = useAuth();
  const [entries, setEntries] = useState<PendingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

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

  // Live-refresh whenever anyone in the company logs or reviews a manual time entry.
  useEffect(() => {
    if (!profile?.company_id) return;
    const channel = supabase
      .channel(`pending-time-approvals-${profile.company_id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_manual_time_entries', filter: `company_id=eq.${profile.company_id}` }, () => fetchEntries())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile?.company_id, fetchEntries]);

  if (loading || entries.length === 0) return null;

  const removeEntry = (id: string) =>
    setEntries(prev => prev.filter(e => e.id !== id));

  const handleReview = async (entryId: string, approve: boolean) => {
    try {
      const { error } = await supabase.rpc('rpc_review_manual_time', {
        p_entry_id: entryId,
        p_approve: approve,
        p_rejection_reason: null,
      });
      if (error) throw error;
      removeEntry(entryId);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not review entry');
    }
  };

  return (
    <>
      <TouchableOpacity
        onPress={() => setModalOpen(true)}
        className="flex-1 min-w-[240px] bg-surface-card p-8 rounded-[32px] border border-state-warning/35 premium-shadow active:opacity-90"
      >
        <View className="w-14 h-14 rounded-2xl bg-state-warning/10 items-center justify-center mb-6 border border-state-warning/20">
          <FontAwesome name="hourglass-end" size={22} color={colors.warning} />
        </View>

        <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.2em] mb-2">
          Declarations Pending
        </Text>
        <Text className="text-typography-main text-5xl font-black tracking-tighter">
          {entries.length}
        </Text>

        <View className="flex-row items-center gap-2 mt-4">
          <Text className="text-state-warning text-[10px] font-black uppercase tracking-widest">Review now</Text>
          <FontAwesome name="arrow-right" size={10} color={colors.warning} />
        </View>
      </TouchableOpacity>

      <ManualTimeApprovalsModal
        visible={modalOpen}
        onClose={() => setModalOpen(false)}
        entries={entries.map(e => ({
          id: e.id,
          declared_minutes: e.declared_minutes,
          reason: e.reason,
          flag_reason: e.flag_reason,
          worker_name: e.worker?.full_name ?? null,
          task: { id: e.task_id, title: e.task_title },
        }))}
        onReview={handleReview}
        onNavigateToTask={(taskId) => { setModalOpen(false); router.push(`/task/${taskId}` as any); }}
      />
    </>
  );
}
