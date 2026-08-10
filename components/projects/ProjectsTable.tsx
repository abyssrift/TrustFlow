import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';

import { ListCard, ListPagination, ListRow } from '@/components/common/ListRow';
import UserLink from '@/components/common/UserLink';
import {
  ClientMark,
  EntityEmptyState,
  EntityGlyph,
  FilterChip,
  HealthBadge,
  ProgressMeter,
  ProjectCard,
  StageChip,
} from '@/components/entities/EntityUI';
import { SkeletonList } from '@/components/Skeleton';
import { useDebounce } from '@/hooks/useDebounce';
import { useThemeColors } from '@/hooks/useThemeColors';
import { ageColor, dueColor, fmtDate, fmtDue } from '@/lib/projectPresentation';
import { supabase } from '@/lib/supabase';
import { formatCompact } from '@/lib/time';
import { InlineRename, ProjectActionsButton, useProjectActions } from './ProjectActionsMenu';

// Mirrors the rpc_projects_table contract (issue #173, Phase 3).
type ProjectRow = {
  id: string; name: string; color: string | null;
  client_id: string | null; client_name: string | null;
  portfolio_id: string | null; portfolio_name: string | null;
  current_stage_id: string | null; stage_name: string | null; stage_color: string | null;
  days_in_current_stage: number | null;
  due_date: string | null; days_remaining: number | null;
  tasks_total: number; tasks_done: number; weighted_progress: number;
  owner_id: string | null; owner_name: string | null; owner_avatar_url: string | null;
  blocked: boolean; blocked_reason: string | null;
  tracked_seconds: number;
  estimated_hours: number | null;
  updated_at: string;
};

type SortKey = 'name' | 'stage' | 'age' | 'due' | 'progress' | 'owner' | 'blocked' | 'hours';

const LIMIT = 25;

const SORT_LABELS: Record<SortKey, string> = {
  name: 'Name', stage: 'Stage', age: 'Days in stage', due: 'Due',
  progress: 'Completion', owner: 'Owner', blocked: 'Health', hours: 'Tracked',
};

function sortValue(row: ProjectRow, key: SortKey): number | string {
  switch (key) {
    case 'name': return row.name?.toLowerCase() ?? '';
    case 'stage': return row.stage_name?.toLowerCase() ?? '';
    case 'age': return row.days_in_current_stage ?? -1;
    case 'due': return row.days_remaining ?? Infinity;
    case 'progress': return row.weighted_progress ?? 0;
    case 'owner': return row.owner_name?.toLowerCase() ?? '';
    case 'blocked': return row.blocked ? 1 : 0;
    case 'hours': return row.tracked_seconds ?? 0;
  }
}

/**
 * Exported for ProjectsTimeline.tsx (Phase 10, #191): both surfaces read the
 * same RPC and therefore fail the same two ways, and "Projects couldn't load"
 * must not be worded two ways depending on which tab you were on.
 */
export function ErrorBanner({ rpcMissing, error }: { rpcMissing: boolean; error: string | null }) {
  const c = useThemeColors();
  return (
    <View className="mx-4 my-4 px-4 py-3 rounded-xl bg-state-danger/10 border border-state-danger/30 flex-row items-start gap-3">
      <FontAwesome name="exclamation-triangle" size={14} color={c.danger} style={{ marginTop: 2 }} />
      <View className="flex-1">
        <Text className="text-state-danger text-xs font-bold">
          {rpcMissing ? 'Projects can’t load on this environment' : 'Projects couldn’t load'}
        </Text>
        {/* §14.4.4 — never a raw database error string on its own. The cause
            still shows, but under a sentence that says what it means. */}
        <Text className="text-typography-muted text-[11px] mt-1 leading-4">
          {rpcMissing
            ? 'The projects backend hasn’t been deployed here yet. Ask an admin to run the pending migrations.'
            : (error || 'Reload the page; if it keeps happening, tell an admin.')}
        </Text>
      </View>
    </View>
  );
}

/**
 * The projects list (issue #173 Phase 3; re-skinned in Phase 8 / #187).
 *
 * A true dense table at >= 768px and a stacked `ProjectCard` list below it —
 * both driven by the same fetch/sort/filter state, and both routed through
 * `components/entities/EntityUI.tsx` so a project looks identical here, on the
 * board, and on every surface Phase 10 adds. Sorting is client-side over the
 * fetched page; paging via p_limit/p_offset keeps each fetch bounded.
 *
 * Phase 8 changes, all §14/§17: every row leads with the project's glyph and
 * its client rather than a bare name; the "blocked" boolean became a health
 * badge that can always explain itself; the loud Switch and the three
 * separately-outlined controls in the filter bar became one chip row; and
 * rename / roll-forward / save-as-template / archive are reachable from the
 * row (`useProjectActions`) instead of only from the detail route.
 */
export default function ProjectsTable({
  onOpenProject,
  refreshKey = 0,
  onBrowseStarters,
  onCreateProject,
  portfolioId = null,
}: {
  onOpenProject: (id: string) => void;
  refreshKey?: number;
  /**
   * #191 Phase 10 — scope every fetch to one portfolio. Passed to the RPC, not
   * applied client-side: filtering a fetched page would silently shrink it
   * below LIMIT and break paging. NULL = every project the caller can see.
   */
  portfolioId?: string | null;
  /** Shown on the genuinely-empty state (no search, zero projects). Omit to hide it (e.g. no project.create permission). */
  onBrowseStarters?: () => void;
  /** Primary action on the genuinely-empty state. Omit when the user can't create. */
  onCreateProject?: () => void;
}) {
  const c = useThemeColors();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 768;

  const [rows, setRows] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rpcMissing, setRpcMissing] = useState(false);
  const [page, setPage] = useState(0);
  const [localRefresh, setLocalRefresh] = useState(0);

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 400);
  const [stageId, setStageId] = useState<string | null>(null);
  const [blockedOnly, setBlockedOnly] = useState(false);
  // Stage filter chips accumulate from every page seen so far — the contract
  // has no "list of stages" endpoint, so this is the cheapest way to offer a
  // stable filter without a second query. Ceiling: a stage nobody's project
  // currently sits in never appears. Fine for a filter, not a source of truth.
  const [knownStages, setKnownStages] = useState<Map<string, { name: string; color: string | null }>>(new Map());

  const [sortKey, setSortKey] = useState<SortKey>('age');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const actions = useProjectActions({
    onChanged: () => setLocalRefresh(k => k + 1),
    onOpenProject,
  });

  useEffect(() => { setPage(0); }, [debouncedSearch, stageId, blockedOnly, portfolioId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      const { data, error: err } = await supabase.rpc('rpc_projects_table', {
        p_search: debouncedSearch || null,
        p_stage_id: stageId,
        p_blocked: blockedOnly ? true : null,
        p_limit: LIMIT,
        p_offset: page * LIMIT,
        p_portfolio_id: portfolioId,
      });
      if (cancelled) return;
      if (err) {
        setRpcMissing(err.code === 'PGRST202' || /could not find the function|does not exist/i.test(err.message || ''));
        setError(err.message);
        setRows([]);
      } else {
        const list = (data as ProjectRow[]) || [];
        setRpcMissing(false);
        setRows(list);
        setKnownStages(prev => {
          const next = new Map(prev);
          list.forEach(r => { if (r.current_stage_id) next.set(r.current_stage_id, { name: r.stage_name || 'Stage', color: r.stage_color }); });
          return next;
        });
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [debouncedSearch, stageId, blockedOnly, page, refreshKey, localRefresh, portfolioId]);

  const sortedRows = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  }, [rows, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('desc'); }
  };

  const hasMore = rows.length === LIMIT;
  const activeFilters = (stageId ? 1 : 0) + (blockedOnly ? 1 : 0);

  // One row of quiet controls, not a search box + a chip rail + a red Switch
  // all competing. "Blocked only" is now the same chip shape as the stage
  // filters because it IS a filter — the Switch read as a system setting.
  const filterBar = (
    <View className={isDesktop ? 'flex-row items-center gap-3 px-5 py-3 border-b border-surface-border' : 'px-4 pt-4'}>
      <View className={`flex-row items-center bg-surface-background border border-surface-border rounded-xl px-3 gap-2 ${isDesktop ? 'w-[240px] py-2' : 'w-full mb-3 py-2.5'}`}>
        <FontAwesome name="search" size={12} color={c.textMuted} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search projects or clients"
          placeholderTextColor={c.textDim}
          accessibilityLabel="Search projects"
          className="flex-1 text-typography-main text-sm bg-transparent"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')} hitSlop={8} accessibilityLabel="Clear search">
            <FontAwesome name="times-circle" size={12} color={c.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        // flexGrow:0 ONLY on mobile. There this row sits in a column and RNW's
        // ScrollView would otherwise stretch vertically and balloon the chips
        // into full-height pills. On desktop it sits in a flex-row, where the
        // same inline style beats the `flex-1` class and collapsed the whole
        // stage-filter rail to zero width — the chips were in the DOM and
        // invisible. Found by looking at the screen, not by tsc.
        style={isDesktop ? undefined : { flexGrow: 0 }}
        className={isDesktop ? 'flex-1' : 'mb-3'}
        contentContainerStyle={{ gap: 8, alignItems: 'center' }}
      >
        <FilterChip label="All stages" active={!stageId} onPress={() => setStageId(null)} touchTarget={!isDesktop} />
        {Array.from(knownStages.entries()).map(([id, s]) => (
          <FilterChip
            key={id}
            label={s.name}
            dotColor={s.color ?? c.primary}
            active={stageId === id}
            onPress={() => setStageId(prev => (prev === id ? null : id))}
            touchTarget={!isDesktop}
          />
        ))}
        <View className="w-px h-5 bg-surface-border mx-1" />
        <FilterChip
          label="Needs attention"
          icon="ban"
          active={blockedOnly}
          onPress={() => setBlockedOnly(v => !v)}
          touchTarget={!isDesktop}
        />
      </ScrollView>

      {isDesktop && activeFilters > 0 && (
        <TouchableOpacity
          onPress={() => { setStageId(null); setBlockedOnly(false); }}
          className="flex-row items-center gap-1.5 px-2 py-1.5"
        >
          <FontAwesome name="times" size={10} color={c.textMuted} />
          <Text className="text-typography-muted text-[11px] font-semibold">Clear</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  // Mobile has no clickable column headers, so sort is a chip row instead.
  const mobileSortRow = !isDesktop && (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} className="px-4 mb-3" contentContainerStyle={{ gap: 8 }}>
      <Text className="text-typography-dim text-[10px] font-black uppercase tracking-[0.15em] self-center mr-1">Sort</Text>
      {(Object.keys(SORT_LABELS) as SortKey[]).map(key => (
        <FilterChip
          key={key}
          label={SORT_LABELS[key]}
          icon={sortKey === key ? (sortDir === 'asc' ? 'sort-asc' : 'sort-desc') : undefined}
          active={sortKey === key}
          onPress={() => toggleSort(key)}
          touchTarget
        />
      ))}
    </ScrollView>
  );

  const pagination = (
    <ListPagination
      page={page}
      count={sortedRows.length}
      limit={LIMIT}
      hasMore={hasMore}
      onPrev={() => setPage(p => Math.max(0, p - 1))}
      onNext={() => setPage(p => p + 1)}
      isDesktop={isDesktop}
      itemNoun="projects"
    />
  );

  const SortHeader = ({ label, sortK, flex = 1, align = 'left' }: { label: string; sortK: SortKey; flex?: number; align?: 'left' | 'center' | 'right' }) => (
    <TouchableOpacity
      onPress={() => toggleSort(sortK)}
      style={{ flex }}
      accessibilityRole="button"
      accessibilityLabel={`Sort by ${label}`}
      className={`flex-row items-center gap-1.5 ${align === 'center' ? 'justify-center' : align === 'right' ? 'justify-end' : ''}`}
    >
      <Text className="text-typography-dim text-[9px] font-black uppercase tracking-[0.15em]">{label}</Text>
      <FontAwesome
        name={sortKey !== sortK ? 'sort' : sortDir === 'asc' ? 'sort-asc' : 'sort-desc'}
        size={9}
        color={sortKey === sortK ? c.primary : c.textDim}
      />
    </TouchableOpacity>
  );

  const emptyState = (
    <EntityEmptyState
      kind="project"
      title={debouncedSearch ? `Nothing matches “${debouncedSearch}”` : activeFilters > 0 ? 'No projects match these filters' : undefined}
      body={
        debouncedSearch
          ? 'Search covers project and client names. Try a shorter word, or clear the search to see everything.'
          : activeFilters > 0
            ? 'Clear the stage or attention filter to see the rest.'
            : undefined
      }
      actionLabel={!debouncedSearch && !activeFilters && onCreateProject ? 'Create a project' : undefined}
      onAction={!debouncedSearch && !activeFilters ? onCreateProject : undefined}
      secondaryLabel={
        debouncedSearch || activeFilters
          ? 'Clear filters'
          : onBrowseStarters ? 'Start from a template' : undefined
      }
      onSecondary={
        debouncedSearch || activeFilters
          ? () => { setSearch(''); setStageId(null); setBlockedOnly(false); }
          : onBrowseStarters
      }
    />
  );

  const body = loading ? (
    <View className="p-5"><SkeletonList count={isDesktop ? 6 : 4} itemHeight={isDesktop ? 56 : 170} /></View>
  ) : error ? (
    <ErrorBanner rpcMissing={rpcMissing} error={error} />
  ) : sortedRows.length === 0 ? (
    emptyState
  ) : isDesktop ? (
    sortedRows.map((row, i) => (
      <ListRow
        key={row.id}
        onPress={() => onOpenProject(row.id)}
        isLast={i === sortedRows.length - 1}
        accessibilityLabel={`Open ${row.name}`}
      >
        {/* Project — glyph first, so the row is identifiable before it's read */}
        <View style={{ flex: 2.6 }} className="pr-3 flex-row items-center gap-2.5">
          <EntityGlyph kind="project" size={28} color={row.color} />
          <View className="flex-1 min-w-0">
            {actions.renamingId === row.id ? (
              <InlineRename
                initialValue={row.name}
                onCommit={(next) => actions.commitRename(row, next)}
                onCancel={actions.cancelRename}
              />
            ) : (
              <Text className="text-typography-main font-bold text-sm" numberOfLines={1}>{row.name}</Text>
            )}
            <View className="mt-0.5">
              <ClientMark name={row.client_name} portfolioName={row.portfolio_name} size={16} />
            </View>
          </View>
        </View>

        <View style={{ flex: 1.2 }} className="pr-3">
          <StageChip name={row.stage_name} color={row.stage_color} size="sm" />
        </View>

        <View style={{ flex: 0.9 }} className="pr-3">
          <Text style={{ color: ageColor(row.days_in_current_stage, c) }} className="text-sm font-bold">
            {row.days_in_current_stage == null ? 'Not staged' : `${row.days_in_current_stage}d`}
          </Text>
        </View>

        <View style={{ flex: 1.1 }} className="pr-3">
          <Text style={{ color: dueColor(row.days_remaining, c) }} className="text-xs font-bold">
            {fmtDue(row.days_remaining, row.due_date)}
          </Text>
          {!!row.due_date && <Text className="text-typography-dim text-[10px] mt-0.5">{fmtDate(row.due_date)}</Text>}
        </View>

        <View style={{ flex: 1.5 }} className="pr-3">
          <ProgressMeter
            done={row.tasks_done}
            total={row.tasks_total}
            percent={row.weighted_progress}
            tone={row.blocked ? c.danger : undefined}
            height={5}
          />
        </View>

        <View style={{ flex: 1.05 }} className="pr-3">
          <HealthBadge
            blocked={row.blocked}
            blockedReason={row.blocked_reason}
            daysRemaining={row.days_remaining}
            size="sm"
          />
        </View>

        <View style={{ flex: 1.2 }} className="pr-3 flex-row items-center gap-2">
          {row.owner_name ? (
            <>
              <EntityGlyph kind="client" size={22} name={row.owner_name} />
              <UserLink userId={row.owner_id} name={row.owner_name} className="text-typography-main text-xs font-semibold flex-shrink" numberOfLines={1} />
            </>
          ) : <Text className="text-typography-dim text-xs">Nobody yet</Text>}
        </View>

        <View style={{ flex: 1.05 }} className="items-end pr-2">
          <Text className="text-typography-main text-xs font-bold">{formatCompact(row.tracked_seconds)}</Text>
          <Text className="text-typography-dim text-[10px] mt-0.5">
            {row.estimated_hours != null ? `of ${row.estimated_hours}h est.` : 'no estimate'}
          </Text>
        </View>

        <View style={{ width: 32 }} className="items-end">
          <ProjectActionsButton onPress={() => actions.openMenu(row)} label={`Actions for ${row.name}`} />
        </View>
      </ListRow>
    ))
  ) : (
    <View className="px-4" style={{ gap: 10 }}>
      {sortedRows.map(row => (
        <ProjectCard
          key={row.id}
          row={row}
          showOwner
          onPress={() => onOpenProject(row.id)}
          actions={<ProjectActionsButton onPress={() => actions.openMenu(row)} label={`Actions for ${row.name}`} />}
          footer={
            actions.renamingId === row.id ? (
              <View className="mt-2.5">
                <InlineRename
                  initialValue={row.name}
                  onCommit={(next) => actions.commitRename(row, next)}
                  onCancel={actions.cancelRename}
                />
              </View>
            ) : (
              <Text className="text-typography-dim text-[10px] mt-2">
                Tracked {formatCompact(row.tracked_seconds)}{row.estimated_hours != null ? ` of ${row.estimated_hours}h est.` : ''}
              </Text>
            )
          }
        />
      ))}
    </View>
  );

  if (!isDesktop) {
    return (
      <View>
        {filterBar}
        {mobileSortRow}
        {body}
        {!loading && !rpcMissing && pagination}
        {actions.overlay}
      </View>
    );
  }

  return (
    <ListCard>
      {filterBar}
      <View className="flex-row items-center px-5 py-2 border-b border-surface-border bg-surface-background/50">
        <SortHeader label="Project" sortK="name" flex={2.6} />
        <SortHeader label="Stage" sortK="stage" flex={1.2} />
        <SortHeader label="In stage" sortK="age" flex={0.9} />
        <SortHeader label="Due" sortK="due" flex={1.1} />
        <SortHeader label="Completion" sortK="progress" flex={1.5} />
        <SortHeader label="Health" sortK="blocked" flex={1.05} />
        <SortHeader label="Owner" sortK="owner" flex={1.2} />
        <SortHeader label="Tracked" sortK="hours" flex={1.05} align="right" />
        <View style={{ width: 32 }} />
      </View>
      {body}
      {!loading && !rpcMissing && pagination}
      {actions.overlay}
    </ListCard>
  );
}
