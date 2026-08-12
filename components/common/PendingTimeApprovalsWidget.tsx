import { useAuth } from '@/contexts/AuthContext';
import { supabase, freshChannel } from '@/lib/supabase';
import { useThemeColors } from '@/hooks/useThemeColors';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { useAlert } from '@/contexts/AlertContext';
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
  /** Pass a changing value (e.g. refreshing counter) to trigger a re-fetch from the parent */
  refreshKey?: number;
  /**
   * Fires whenever this widget flips between rendering its card and rendering
   * nothing. Only this component can know: it owns the fetch and the realtime
   * channel, and React gives a parent no signal that a child returned null.
   * The dashboard grid (#213) needs it — a 0px widget there leaves a phantom
   * cell whose edit controls land on the widget below. Optional, so every
   * existing caller is unchanged.
   */
  onEmptyChange?: (empty: boolean) => void;
};

export default function PendingTimeApprovalsWidget({ refreshKey, onEmptyChange }: Props) {
  const colors = useThemeColors();
  const router = useRouter();
  const { profile } = useAuth();
  const { showAlert } = useAlert();
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
    const channel = freshChannel(`pending-time-approvals-${profile.company_id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_manual_time_entries', filter: `company_id=eq.${profile.company_id}` }, () => fetchEntries())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile?.company_id, fetchEntries]);

  const empty = loading || entries.length === 0;
  useEffect(() => { onEmptyChange?.(empty); }, [empty, onEmptyChange]);

  if (empty) return null;

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
      showAlert('Error', err.message || 'Could not review entry');
    }
  };

  return (
    <>
      <TouchableOpacity
        onPress={() => setModalOpen(true)}
        className="bg-surface-overlay/30 rounded-2xl border border-state-warning/30 p-4 mb-4 flex-row items-center gap-3 active:opacity-80"
      >
        <View className="w-11 h-11 rounded-2xl bg-state-warning/20 items-center justify-center">
          <FontAwesome name="hourglass-end" size={16} color={colors.warning} />
        </View>
        <View className="flex-1">
          <Text className="text-state-warning text-xs font-black uppercase tracking-wider">
            {entries.length} Declaration{entries.length === 1 ? '' : 's'} Pending
          </Text>
          <Text className="text-typography-dim text-[10px] mt-0.5">Tap to review and approve</Text>
        </View>
        <FontAwesome name="chevron-right" size={12} color={colors.warning} />
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
