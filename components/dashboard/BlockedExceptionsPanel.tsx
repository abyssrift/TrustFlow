// Phase 10 (#191, plan §16.2) — "blocked projects, by exception" dashboard
// panel. Deliberately shows NOTHING loud when there is nothing to act on: this
// is an exceptions list, not a projects list, and the empty state is the state
// it is in most of the time.
//
// Data: ONE call to rpc_projects_table, which already applies
// fn_project_accessible — the exact gate #185/#186 leaked without. The call
// itself now lives in `hooks/useDashboardProjects.ts` so the projection strip
// beside this panel shares the round trip instead of firing a second identical
// 500-row read. Nothing about WHICH rows qualify moved: `needs_attention` is
// still public.fn_project_needs_attention(), the same function the RPC's own
// p_blocked filter and the Intelligence lens read (§16.1), and this panel still
// does not re-derive it — see lib/projectExceptions.ts.
//
// THE EMPTY STATE IS ONE QUIET LINE, not a card. It used to be a full-width
// filled green box with an icon medallion: the tallest, loudest element on the
// dashboard, and what it said was "nothing is wrong". An all-clear that
// out-shouts real content trains people to stop reading the section. It still
// says something rather than vanishing entirely — unlike the projection strip,
// silence here is ambiguous ("checked and fine" vs "never loaded"), and the
// error branch below exists precisely because that distinction matters.

import { ProjectCard, type ProjectCardRow } from '@/components/entities/EntityUI';
import { SkeletonList } from '@/components/Skeleton';
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
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

type Row = ProjectCardRow & ExceptionSourceRow;

const MAX_SHOWN = 6;

export default function BlockedExceptionsPanel({
  rows: source,
  state,
  reload,
  canView,
}: {
  rows: any[];
  state: 'loading' | 'ready' | 'error';
  reload: () => void;
  canView: boolean;
}) {
  const c = useThemeColors();
  const router = useRouter();

  const rows: Row[] = useMemo(
    () =>
      ((source || []) as Row[])
        .filter(isExceptionProject)
        // Normalize into ProjectCard's own blocked/blocked_reason fields so its
        // built-in HealthBadge shows the unioned state without ProjectCard
        // needing to know about `flags` at all.
        .map((p) => ({ ...p, blocked: isBlockedException(p), blocked_reason: effectiveBlockedReason(p) }))
        .sort((a, b) => exceptionUrgencyScore(b) - exceptionUrgencyScore(a)),
    [source]
  );

  if (!canView) return null;

  // Loading: one hairline placeholder, not two 116px card skeletons. Most of the
  // time this section resolves to a single line, so reserving a card's worth of
  // space guarantees a layout jump on every load.
  if (state === 'loading') {
    return (
      <View className="mb-8">
        <SkeletonList count={1} itemHeight={18} />
      </View>
    );
  }

  if (state === 'error') {
    return (
      <View className="mb-8 flex-row items-center gap-2 flex-wrap">
        <FontAwesome name="exclamation-triangle" size={11} color={c.warning} />
        <Text className="text-typography-muted text-xs">
          Couldn't check project status — this isn't saying nothing's wrong.
        </Text>
        <TouchableOpacity
          onPress={reload}
          className="px-3 rounded-xl border border-surface-border hover:bg-surface-overlay items-center justify-center"
          style={{ minHeight: 44 }}
        >
          <Text className="text-brand-primary text-xs font-bold">Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // The all-clear: one line, no box, no fill, no icon medallion.
  if (rows.length === 0) {
    return (
      <View className="mb-8 flex-row items-center gap-2">
        <FontAwesome name="check" size={10} color={c.textDim} />
        <Text className="text-typography-dim text-xs">
          Nothing blocked, overdue, or forecast to miss a deadline.
        </Text>
      </View>
    );
  }

  return (
    <View className="mb-8">
      <View className="flex-row items-center justify-between mb-3">
        <View className="flex-row items-center gap-2">
          <Text className="text-typography-dim text-[10px] font-bold uppercase tracking-[0.12em]">
            Needs attention
          </Text>
          <Text className="text-state-danger text-[10px] font-bold">{rows.length}</Text>
        </View>
        {rows.length > MAX_SHOWN && (
          <TouchableOpacity
            onPress={() => router.push('/projects' as any)}
            className="flex-row items-center gap-1.5"
            style={{ minHeight: 44, paddingHorizontal: 4, justifyContent: 'center' }}
          >
            <Text className="text-brand-primary text-xs font-bold">View all</Text>
            <FontAwesome name="arrow-right" size={9} color={c.primary} />
          </TouchableOpacity>
        )}
      </View>

      {/* A plain vertical stack, not a CSS grid: this component renders on
          native too (via _index_adaptive.tsx), where `grid`/`grid-cols-*`
          utilities don't apply. Exceptions are rare by design (§16.2), so a
          single column reads fine on desktop as well — no per-platform split
          needed here. */}
      <View className="gap-2.5">
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
    </View>
  );
}
