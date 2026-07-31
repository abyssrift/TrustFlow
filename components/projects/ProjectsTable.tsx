import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Switch,
  useWindowDimensions,
} from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { supabase } from '@/lib/supabase';
import { useThemeColors } from '@/hooks/useThemeColors';
import { useDebounce } from '@/hooks/useDebounce';
import { formatCompact } from '@/lib/time';
import UserLink from '@/components/common/UserLink';
import Tooltip from '@/components/common/Tooltip';
import { SkeletonList } from '@/components/Skeleton';

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
type ThemeColors = ReturnType<typeof useThemeColors>;

const LIMIT = 25;

const SORT_LABELS: Record<SortKey, string> = {
  name: 'Name', stage: 'Stage', age: 'Days in Stage', due: 'Due',
  progress: 'Progress', owner: 'Owner', blocked: 'Blocked', hours: 'Hours',
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

// ponytail: fixed thresholds, not a config value — revisit if a company wants a custom ageing scale.
function ageColor(days: number | null, c: ThemeColors): string {
  if (days == null) return c.textMuted;
  if (days >= 14) return c.danger;
  if (days >= 7) return c.warning;
  return c.textMuted;
}
function dueColor(daysRemaining: number | null, c: ThemeColors): string {
  if (daysRemaining == null) return c.textMuted;
  if (daysRemaining < 0) return c.danger;
  if (daysRemaining <= 3) return c.warning;
  return c.textMuted;
}
function fmtDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtDue(daysRemaining: number | null, dueDate: string | null): string {
  if (!dueDate) return '—';
  if (daysRemaining == null) return fmtDate(dueDate);
  if (daysRemaining < 0) return `${Math.abs(daysRemaining)}d overdue`;
  if (daysRemaining === 0) return 'Due today';
  return `${daysRemaining}d left`;
}
function initials(name: string | null): string {
  if (!name) return '?';
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || '?';
}

function ErrorBanner({ rpcMissing, error }: { rpcMissing: boolean; error: string | null }) {
  const c = useThemeColors();
  return (
    <View className="mx-4 my-4 px-4 py-3 rounded-xl bg-state-danger/10 border border-state-danger/30 flex-row items-center gap-3">
      <FontAwesome name="exclamation-triangle" size={14} color={c.danger} />
      <Text className="text-state-danger text-xs font-bold flex-1">
        {rpcMissing ? 'The projects table backend is not deployed yet on this environment.' : (error || 'Could not load projects.')}
      </Text>
    </View>
  );
}

function EmptyState({ search }: { search: string }) {
  const c = useThemeColors();
  return (
    <View className="items-center justify-center py-16 px-6">
      <FontAwesome name="folder-open-o" size={32} color={c.textMuted} />
      <Text className="text-typography-main text-lg font-black mt-4">{search ? 'No matches' : 'No projects yet'}</Text>
      <Text className="text-typography-muted text-sm text-center mt-2">
        {search ? `No projects match "${search}".` : 'Projects will show up here once created.'}
      </Text>
    </View>
  );
}

/**
 * Dense, sortable projects table (issue #173, Phase 3). Renders a true dense
 * table at >= 768px and a stacked card list below it — both are driven by
 * the same fetch/sort/filter state so the two are never out of sync.
 *
 * Sorting is client-side over the currently fetched page (not the whole
 * dataset) — simplest option that satisfies "sortable" without a second
 * server contract; paging via p_limit/p_offset keeps each fetch bounded.
 */
export default function ProjectsTable({
  onOpenProject,
  refreshKey = 0,
}: {
  onOpenProject: (id: string) => void;
  refreshKey?: number;
}) {
  const c = useThemeColors();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 768;

  const [rows, setRows] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rpcMissing, setRpcMissing] = useState(false);
  const [page, setPage] = useState(0);

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

  useEffect(() => { setPage(0); }, [debouncedSearch, stageId, blockedOnly]);

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
  }, [debouncedSearch, stageId, blockedOnly, page, refreshKey]);

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

  const filterBar = (
    <View className={isDesktop ? 'flex-row items-center gap-3 px-6 py-4 border-b border-surface-border' : 'px-4 pt-4'}>
      <View className={`flex-row items-center bg-surface-background border border-surface-border rounded-xl px-3 py-2.5 gap-2 ${isDesktop ? 'w-[240px]' : 'w-full mb-3'}`}>
        <FontAwesome name="search" size={12} color={c.textMuted} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search projects..."
          placeholderTextColor={c.textDim}
          className="flex-1 text-typography-main text-sm outline-none bg-transparent"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <FontAwesome name="times-circle" size={12} color={c.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className={isDesktop ? 'flex-1' : 'mb-3'}
        contentContainerStyle={{ gap: 8, alignItems: 'center' }}
      >
        <TouchableOpacity
          onPress={() => setStageId(null)}
          // ui-style-guide.md 4.3: 44x44 minimum tap target on mobile. These chips
          // ARE the mobile control (they replace clickable column headers below
          // 768px), so they cannot stay at py-1.5 (~26px). Desktop keeps compact.
          className={`${isDesktop ? 'px-3 py-1.5' : 'px-4 min-h-[44px] justify-center'} rounded-full border ${!stageId ? 'bg-brand-primary/10 border-brand-primary' : 'border-surface-border'}`}
        >
          <Text className={`text-[10px] font-black uppercase ${!stageId ? 'text-brand-primary' : 'text-typography-muted'}`}>All Stages</Text>
        </TouchableOpacity>
        {Array.from(knownStages.entries()).map(([id, s]) => (
          <TouchableOpacity
            key={id}
            onPress={() => setStageId(prev => (prev === id ? null : id))}
            className={`flex-row items-center gap-1.5 ${isDesktop ? 'px-3 py-1.5' : 'px-4 min-h-[44px]'} rounded-full border ${stageId === id ? 'bg-brand-primary/10 border-brand-primary' : 'border-surface-border'}`}
          >
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: s.color ?? c.primary }} />
            <Text className={`text-[10px] font-black uppercase ${stageId === id ? 'text-brand-primary' : 'text-typography-muted'}`} numberOfLines={1}>{s.name}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View className={`flex-row items-center gap-2 ${isDesktop ? '' : 'mb-1'}`}>
        <Text className="text-typography-muted text-[10px] font-black uppercase">Blocked only</Text>
        <Switch value={blockedOnly} onValueChange={setBlockedOnly} trackColor={{ false: c.border, true: c.danger }} thumbColor="white" />
      </View>
    </View>
  );

  // Mobile has no clickable column headers, so sort is a chip row instead.
  const mobileSortRow = !isDesktop && (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} className="px-4 mb-3" contentContainerStyle={{ gap: 8 }}>
      {(Object.keys(SORT_LABELS) as SortKey[]).map(key => (
        <TouchableOpacity
          key={key}
          onPress={() => toggleSort(key)}
          className={`flex-row items-center gap-1.5 ${isDesktop ? 'px-3 py-1.5' : 'px-4 min-h-[44px]'} rounded-full border ${sortKey === key ? 'bg-brand-primary/10 border-brand-primary' : 'border-surface-border'}`}
        >
          <Text className={`text-[10px] font-black uppercase ${sortKey === key ? 'text-brand-primary' : 'text-typography-muted'}`}>{SORT_LABELS[key]}</Text>
          {sortKey === key && <FontAwesome name={sortDir === 'asc' ? 'sort-asc' : 'sort-desc'} size={10} color={c.primary} />}
        </TouchableOpacity>
      ))}
    </ScrollView>
  );

  const pagination = (
    <View className={`flex-row items-center justify-between border-t border-surface-border ${isDesktop ? 'px-6 py-3' : 'px-4 py-3'}`}>
      <Text className="text-typography-muted text-[10px] font-bold uppercase">
        {sortedRows.length === 0 ? 'No projects' : `Showing ${page * LIMIT + 1}–${page * LIMIT + sortedRows.length}`}
      </Text>
      <View className="flex-row items-center gap-2">
        <TouchableOpacity
          disabled={page === 0}
          onPress={() => setPage(p => Math.max(0, p - 1))}
          className={`w-8 h-8 items-center justify-center rounded-lg border border-surface-border ${page === 0 ? 'opacity-30' : ''}`}
        >
          <FontAwesome name="chevron-left" size={11} color={c.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity
          disabled={!hasMore}
          onPress={() => setPage(p => p + 1)}
          className={`w-8 h-8 items-center justify-center rounded-lg border border-surface-border ${!hasMore ? 'opacity-30' : ''}`}
        >
          <FontAwesome name="chevron-right" size={11} color={c.textMuted} />
        </TouchableOpacity>
      </View>
    </View>
  );

  const SortHeader = ({ label, sortK, flex = 1, align = 'left' }: { label: string; sortK: SortKey; flex?: number; align?: 'left' | 'center' | 'right' }) => (
    <TouchableOpacity
      onPress={() => toggleSort(sortK)}
      style={{ flex }}
      className={`flex-row items-center gap-1.5 ${align === 'center' ? 'justify-center' : align === 'right' ? 'justify-end' : ''}`}
    >
      <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest">{label}</Text>
      <FontAwesome
        name={sortKey !== sortK ? 'sort' : sortDir === 'asc' ? 'sort-asc' : 'sort-desc'}
        size={10}
        color={sortKey === sortK ? c.primary : c.textDim}
      />
    </TouchableOpacity>
  );

  const body = loading ? (
    <View className="p-6"><SkeletonList count={isDesktop ? 6 : 4} itemHeight={isDesktop ? 52 : 120} /></View>
  ) : error ? (
    <ErrorBanner rpcMissing={rpcMissing} error={error} />
  ) : sortedRows.length === 0 ? (
    <EmptyState search={debouncedSearch} />
  ) : isDesktop ? (
    sortedRows.map((row, i) => (
      <TouchableOpacity
        key={row.id}
        onPress={() => onOpenProject(row.id)}
        className={`flex-row items-center px-6 py-4 ${i < sortedRows.length - 1 ? 'border-b border-surface-border/50' : ''} hover:bg-surface-background/40`}
      >
        <View style={{ flex: 2.4 }} className="pr-3">
          <Text className="text-typography-main font-black text-sm" numberOfLines={1}>{row.name}</Text>
          <Text className="text-typography-muted text-[10px] mt-0.5" numberOfLines={1}>
            {[row.client_name, row.portfolio_name].filter(Boolean).join(' · ') || '—'}
          </Text>
        </View>

        <View style={{ flex: 1.1 }} className="pr-3">
          {row.stage_name ? (
            <View className="flex-row items-center gap-1.5 self-start px-2.5 py-1 rounded-full border border-surface-border">
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: row.stage_color ?? c.primary }} />
              <Text className="text-typography-main text-[10px] font-bold" numberOfLines={1}>{row.stage_name}</Text>
            </View>
          ) : <Text className="text-typography-dim text-xs">—</Text>}
        </View>

        <View style={{ flex: 1.1 }} className="pr-3">
          <Text style={{ color: ageColor(row.days_in_current_stage, c) }} className="text-base font-black">
            {row.days_in_current_stage == null ? '—' : `${row.days_in_current_stage}d`}
          </Text>
        </View>

        <View style={{ flex: 1.1 }} className="pr-3">
          <Text style={{ color: dueColor(row.days_remaining, c) }} className="text-xs font-bold">
            {fmtDue(row.days_remaining, row.due_date)}
          </Text>
          {row.due_date && <Text className="text-typography-dim text-[10px] mt-0.5">{fmtDate(row.due_date)}</Text>}
        </View>

        <View style={{ flex: 1.5 }} className="pr-3">
          <View className="flex-row justify-between mb-1">
            <Text className="text-typography-muted text-[10px] font-bold">{row.tasks_done}/{row.tasks_total}</Text>
            <Text className="text-typography-main text-[10px] font-black">{Math.round(row.weighted_progress)}%</Text>
          </View>
          <View className="h-1.5 w-full bg-surface-background rounded-full overflow-hidden">
            <View style={{ width: `${Math.min(100, Math.max(0, row.weighted_progress))}%`, backgroundColor: row.blocked ? c.danger : c.primary }} className="h-full rounded-full" />
          </View>
        </View>

        <View style={{ flex: 1.2 }} className="pr-3 flex-row items-center gap-2">
          {row.owner_name ? (
            <>
              <View className="w-6 h-6 rounded-full items-center justify-center bg-surface-background border border-surface-border">
                <Text className="text-typography-muted text-[9px] font-black">{initials(row.owner_name)}</Text>
              </View>
              <UserLink userId={row.owner_id} name={row.owner_name} className="text-typography-main text-xs font-bold flex-shrink" numberOfLines={1} />
            </>
          ) : <Text className="text-typography-dim text-xs">Unassigned</Text>}
        </View>

        <View style={{ flex: 0.8 }} className="items-center">
          {row.blocked ? (
            <Tooltip label={row.blocked_reason || 'Blocked'}>
              <View className="w-6 h-6 rounded-full items-center justify-center bg-state-danger/10">
                <FontAwesome name="exclamation" size={11} color={c.danger} />
              </View>
            </Tooltip>
          ) : <FontAwesome name="check" size={11} color={c.textDim} />}
        </View>

        <View style={{ flex: 1.2 }} className="items-end">
          <Text className="text-typography-main text-xs font-bold">{formatCompact(row.tracked_seconds)}</Text>
          <Text className="text-typography-dim text-[10px] mt-0.5">of {row.estimated_hours != null ? `${row.estimated_hours}h` : '—'} est.</Text>
        </View>
      </TouchableOpacity>
    ))
  ) : (
    <View className="px-4" style={{ gap: 12 }}>
      {sortedRows.map(row => (
        <TouchableOpacity
          key={row.id}
          onPress={() => onOpenProject(row.id)}
          className="bg-surface-card border border-surface-border rounded-2xl p-4"
        >
          <View className="flex-row items-start justify-between mb-2">
            <View className="flex-1 pr-2">
              <Text className="text-typography-main font-black text-base" numberOfLines={1}>{row.name}</Text>
              <Text className="text-typography-muted text-[11px]" numberOfLines={1}>
                {[row.client_name, row.portfolio_name].filter(Boolean).join(' · ') || '—'}
              </Text>
            </View>
            {row.blocked && (
              <View className="px-2 py-1 rounded-full bg-state-danger/10 flex-row items-center gap-1">
                <FontAwesome name="exclamation-triangle" size={9} color={c.danger} />
                <Text className="text-state-danger text-[9px] font-black uppercase">Blocked</Text>
              </View>
            )}
          </View>

          <View className="flex-row items-center flex-wrap gap-2 mb-3">
            {row.stage_name && (
              <View className="flex-row items-center gap-1.5 px-2.5 py-1 rounded-full border border-surface-border">
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: row.stage_color ?? c.primary }} />
                <Text className="text-typography-main text-[10px] font-bold">{row.stage_name}</Text>
              </View>
            )}
            <Text style={{ color: ageColor(row.days_in_current_stage, c) }} className="text-sm font-black">
              {row.days_in_current_stage == null ? 'Never staged' : `${row.days_in_current_stage}d in stage`}
            </Text>
          </View>

          <View className="mb-3">
            <View className="flex-row justify-between mb-1">
              <Text className="text-typography-muted text-[10px] font-bold">{row.tasks_done}/{row.tasks_total} tasks</Text>
              <Text className="text-typography-main text-[10px] font-black">{Math.round(row.weighted_progress)}%</Text>
            </View>
            <View className="h-1.5 w-full bg-surface-background rounded-full overflow-hidden">
              <View style={{ width: `${Math.min(100, Math.max(0, row.weighted_progress))}%`, backgroundColor: row.blocked ? c.danger : c.primary }} className="h-full rounded-full" />
            </View>
          </View>

          <View className="flex-row items-center justify-between">
            <Text className="text-typography-muted text-[11px]" numberOfLines={1}>{row.owner_name || 'Unassigned'}</Text>
            {row.due_date && (
              <Text style={{ color: dueColor(row.days_remaining, c) }} className="text-[11px] font-bold">
                {fmtDue(row.days_remaining, row.due_date)}
              </Text>
            )}
          </View>
          <Text className="text-typography-dim text-[10px] mt-1">
            Tracked {formatCompact(row.tracked_seconds)} of {row.estimated_hours != null ? `${row.estimated_hours}h` : '—'} est.
          </Text>
        </TouchableOpacity>
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
      </View>
    );
  }

  return (
    <View className="bg-surface-card rounded-[24px] border border-surface-border overflow-hidden">
      {filterBar}
      <View className="flex-row items-center px-6 py-3 border-b border-surface-border bg-surface-background/50">
        <SortHeader label="Project" sortK="name" flex={2.4} />
        <SortHeader label="Stage" sortK="stage" flex={1.1} />
        <SortHeader label="Days in Stage" sortK="age" flex={1.1} />
        <SortHeader label="Due" sortK="due" flex={1.1} />
        <SortHeader label="Completion" sortK="progress" flex={1.5} />
        <SortHeader label="Owner" sortK="owner" flex={1.2} />
        <SortHeader label="Blocked" sortK="blocked" flex={0.8} align="center" />
        <SortHeader label="Tracked / Est." sortK="hours" flex={1.2} align="right" />
      </View>
      {body}
      {!loading && !rpcMissing && pagination}
    </View>
  );
}
