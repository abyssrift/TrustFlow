// Phase 10 (#191, plan §16.2) — "blocked projects, by exception" dashboard
// panel. Deliberately shows NOTHING when there is nothing to act on: this is
// an exceptions list, not a projects list, and the empty state is the state
// it is in most of the time (see the "all clear" branch below).
//
// Data: ONE call to rpc_projects_table, which already applies
// fn_project_accessible — the exact gate #185/#186 leaked without.
//
// It also decides, server-side, which rows qualify: `needs_attention` is
// public.fn_project_needs_attention(), the same function its own p_blocked
// filter and the Intelligence lens read (§16.1, issue #191). This panel does
// not re-derive that — see lib/projectExceptions.ts. Until
// 20260806_project_needs_attention.sql it did, from two follow-up selects
// (`projects` for flags/flag_note, `pipeline_stages` for the terminal-stage
// info); the RPC now returns those columns, so both round trips are gone and
// with them the merge that was free to drift.

import { ProjectCard, type ProjectCardRow } from '@/components/entities/EntityUI';
import { SkeletonList } from '@/components/Skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import {
  effectiveBlockedReason,
  exceptionUrgencyScore,
  isBlockedException,
  isExceptionProject,
  overrunStatus,
  type ExceptionSourceRow,
} from '@/lib/projectExceptions';
import { fmtDate } from '@/lib/projectPresentation';
import { supabase } from '@/lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

type Row = ProjectCardRow & ExceptionSourceRow;

const MAX_SHOWN = 6;

export default function BlockedExceptionsPanel() {
  const c = useThemeColors();
  const router = useRouter();
  const { hasPermission } = useAuth();
  const canView = hasPermission('project.view');

  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [rows, setRows] = useState<Row[]>([]);

  const load = async () => {
    setState('loading');
    try {
      // p_blocked is left unset on purpose: the panel needs the same rows the
      // rest of the dashboard would show, filtered by the same predicate it
      // renders from. Passing p_blocked: true would work identically today —
      // it calls the same function — but would leave the count and the list
      // depending on two calls agreeing.
      const { data: base, error } = await supabase.rpc('rpc_projects_table', { p_limit: 500 });
      if (error) throw error;

      const exceptions = ((base || []) as Row[])
        .filter(isExceptionProject)
        // Normalize into ProjectCard's own blocked/blocked_reason fields so its
        // built-in HealthBadge shows the unioned state without ProjectCard
        // needing to know about `flags` at all.
        .map((p) => ({ ...p, blocked: isBlockedException(p), blocked_reason: effectiveBlockedReason(p) }))
        .sort((a, b) => exceptionUrgencyScore(b) - exceptionUrgencyScore(a));

      setRows(exceptions);
      setState('ready');
    } catch (err) {
      console.error('[BlockedExceptionsPanel] load error', err);
      setState('error');
    }
  };

  useEffect(() => {
    if (canView) load();
  }, [canView]);

  if (!canView) return null;

  return (
    <View className="mb-10">
      <View className="flex-row items-center justify-between mb-4">
        <View className="flex-row items-center gap-2.5">
          <View className="w-1.5 h-4 bg-state-danger rounded-full" />
          <Text className="text-typography-main text-lg font-black tracking-tight">Needs Attention</Text>
          {state === 'ready' && rows.length > 0 && (
            <View className="bg-state-danger/10 border border-state-danger/20 px-2.5 py-0.5 rounded-full">
              <Text className="text-state-danger text-[10px] font-black">{rows.length}</Text>
            </View>
          )}
        </View>
        {state === 'ready' && rows.length > MAX_SHOWN && (
          <TouchableOpacity onPress={() => router.push('/projects' as any)} className="flex-row items-center gap-1.5" style={{ minHeight: 44, paddingHorizontal: 4 }}>
            <Text className="text-brand-primary text-xs font-bold">View all in Projects</Text>
            <FontAwesome name="arrow-right" size={10} color={c.primary} />
          </TouchableOpacity>
        )}
      </View>

      {state === 'loading' && <SkeletonList count={2} itemHeight={116} />}

      {state === 'error' && (
        <View className="bg-surface-card border border-surface-border rounded-2xl p-6 items-center">
          <FontAwesome name="exclamation-triangle" size={20} color={c.warning} />
          <Text className="text-typography-main text-sm font-bold mt-3">Couldn't check project status</Text>
          <Text className="text-typography-muted text-xs mt-1 text-center">This panel failed to load — it isn't saying nothing's wrong.</Text>
          <TouchableOpacity
            onPress={load}
            className="mt-4 px-5 rounded-xl bg-brand-primary items-center justify-center"
            style={{ minHeight: 44 }}
          >
            <Text className="text-white text-xs font-bold">Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {state === 'ready' && rows.length === 0 && (
        <View className="bg-state-success/5 border border-state-success/20 rounded-2xl p-6 items-center">
          <View className="w-11 h-11 rounded-full bg-state-success/10 items-center justify-center border border-state-success/20">
            <FontAwesome name="check" size={16} color={c.success} />
          </View>
          <Text className="text-typography-main text-sm font-bold mt-3">All clear</Text>
          <Text className="text-typography-muted text-xs mt-1 text-center" style={{ maxWidth: 340 }}>
            No projects are blocked, overdue, or projected to miss their deadline.
          </Text>
        </View>
      )}

      {state === 'ready' && rows.length > 0 && (
        // A plain vertical stack, not a CSS grid: this component renders on
        // native too (via _index_adaptive.tsx), where `grid`/`grid-cols-*`
        // utilities don't apply. Exceptions are rare by design (§16.2), so a
        // single column reads fine on desktop as well — no per-platform split
        // needed here.
        <View className="gap-3">
          {rows.slice(0, MAX_SHOWN).map((row) => {
            const overrun = overrunStatus(row);
            return (
              <ProjectCard
                key={row.id}
                row={row}
                onPress={() => router.push(`/projects/${row.id}` as any)}
                footer={
                  overrun.fires ? (
                    <View className="flex-row items-center gap-1.5 mt-2.5 pt-2.5 border-t border-surface-border/50">
                      <FontAwesome name="line-chart" size={10} color={c.warning} />
                      <Text className="text-[11px] font-semibold flex-1" style={{ color: c.warning }}>
                        Projected {fmtDate(row.projected_end ?? null)} — after its {fmtDate(row.due_date ?? null)} due date
                        {overrun.uncertain ? ' (uncertain forecast)' : ''}
                      </Text>
                    </View>
                  ) : undefined
                }
              />
            );
          })}
        </View>
      )}
    </View>
  );
}
