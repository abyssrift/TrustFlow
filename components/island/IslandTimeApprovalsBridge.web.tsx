// ====================================================================
// IslandTimeApprovalsBridge (web) — publishes pending time declarations
// to the island, one row per entry, Approve/Reject inline via `decisions`.
// ====================================================================
//
// Desktop web previously surfaced this via a dashboard widget and a
// banner buried mid-task-detail-page, opening a bespoke centered modal to
// review it. This bridge is mounted once at the root layout instead, so a
// pending approval reaches the topbar island no matter what page the
// manager is on — and on first load after login, if entries are already
// waiting, they publish with a `decisions` entry and the island
// auto-expands immediately (no separate "came back online" handling
// needed; see IslandContext's attention rising-edge).
//
// Deliberately renders no modal of its own: `IslandActivity.decisions` is
// the island's built-in mechanism for "resolve this without leaving the
// panel" (same one uploads use for filename conflicts), and it's styled
// entirely with inline JS colors from useThemeColors() rather than
// Tailwind classes — which is also what keeps it immune to the
// "theme classes render black" class of bug the old bespoke modal hit.
//
// One IslandActivity per entry (not one aggregate row) so that a second
// approval arriving while the first is still unreviewed adds a *new* id to
// the island's attention count — which is what makes the auto-expand
// rising-edge fire again.
// ====================================================================

import { useAuth } from '@/contexts/AuthContext';
import { useIsland, type IslandActivity } from '@/contexts/IslandContext';
import { useToast } from '@/contexts/ToastContext';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

type PendingEntry = {
  id: string;
  declared_minutes: number;
  reason: string | null;
  flag_reason: string | null;
  task_id: string;
  task_title: string;
  worker: { id: string; full_name: string | null };
};

function formatDeclaredMinutes(m: number) {
  const h = Math.floor(m / 60);
  const min = m % 60;
  if (h > 0 && min > 0) return `${h}h ${min}m`;
  if (h > 0) return `${h}h`;
  return `${min}m`;
}

const islandId = (entryId: string) => `time-approval:${entryId}`;

export default function IslandTimeApprovalsBridge() {
  const { profile } = useAuth();
  const { publish, remove } = useIsland();
  const { errorToast } = useToast();
  const router = useRouter();
  const [entries, setEntries] = useState<PendingEntry[]>([]);
  const publishedIds = useRef<Set<string>>(new Set());

  const fetchEntries = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('rpc_get_my_pending_time_approvals');
      if (error) throw error;
      setEntries((data as PendingEntry[]) ?? []);
    } catch (err) {
      console.error('[IslandTimeApprovalsBridge]', err);
    }
  }, []);

  useEffect(() => { if (profile?.company_id) fetchEntries(); }, [profile?.company_id, fetchEntries]);

  useEffect(() => {
    if (!profile?.company_id) return;
    const channel = supabase
      .channel(`pending-time-approvals-${profile.company_id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_manual_time_entries', filter: `company_id=eq.${profile.company_id}` }, () => fetchEntries())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile?.company_id, fetchEntries]);

  const handleReview = useCallback(async (entryId: string, approve: boolean) => {
    // Optimistic — don't wait on the realtime round-trip to clear the row.
    setEntries(prev => prev.filter(e => e.id !== entryId));
    try {
      const { error } = await supabase.rpc('rpc_review_manual_time', {
        p_entry_id: entryId,
        p_approve: approve,
        p_rejection_reason: null,
      });
      if (error) throw error;
    } catch (err: any) {
      errorToast(err?.message || 'Could not review entry');
      fetchEntries();
    }
  }, [errorToast, fetchEntries]);

  // Sync island rows to the current entry list: publish anything present,
  // remove anything that dropped out (reviewed, reassigned, etc).
  useEffect(() => {
    const currentIds = new Set(entries.map(e => e.id));
    for (const id of publishedIds.current) {
      if (!currentIds.has(id)) remove(islandId(id));
    }
    for (const e of entries) {
      const flagged = !!e.flag_reason;
      const activity: IslandActivity = {
        id: islandId(e.id),
        kind: 'approval',
        icon: 'hourglass-end',
        accent: flagged ? 'danger' : 'warning',
        compactLabel: formatDeclaredMinutes(e.declared_minutes),
        title: e.worker?.full_name ?? 'Worker',
        subtitle: `${e.task_title} · ${formatDeclaredMinutes(e.declared_minutes)} declared`,
        onPress: () => router.push(`/task/${e.task_id}` as any),
        decisions: [{
          id: e.id,
          title: flagged ? `Flagged: ${e.flag_reason}` : 'Review this declaration',
          message: e.reason ? `“${e.reason}”` : 'No reason given.',
          options: [
            { label: 'Reject', value: 'reject', tone: 'danger' },
            { label: 'Approve', value: 'approve', tone: 'success' },
          ],
          resolve: (value: string) => handleReview(e.id, value === 'approve'),
        }],
      };
      publish(activity);
    }
    publishedIds.current = currentIds;
  }, [entries, publish, remove, router, handleReview]);

  useEffect(() => () => {
    for (const id of publishedIds.current) remove(islandId(id));
  }, [remove]);

  return null;
}
