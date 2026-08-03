import Calendar from '@/components/common/Calendar';
import DraggableSheet from '@/components/common/DraggableSheet';
import Popup from '@/components/common/Popup';
import Tooltip from '@/components/common/Tooltip';
import { EntityGlyph, EntityTag } from '@/components/entities/EntityUI';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { getQuickActionDate } from '@/lib/calendarPicker';
import { supabase } from '@/lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TextInput, TouchableOpacity, useWindowDimensions, View } from 'react-native';

// Issue #185 (plan §13.13) — "create next year's engagement from a live
// project, configurably". This sheet is the UI half of
// rpc_rollforward_project, which is rpc_create_template_from_project +
// rpc_instantiate_template COMPOSED against a live project instead of a
// stored template — see 20260801_rollforward_project.sql for the RPC and
// why every guarantee (reachability, duplicate-name legibility, undo) is
// inherited rather than reimplemented here.
//
// Deliberately NOT a paste-a-list batch like BulkCreateProjectsSheet:
// rollforward is "one project, next year", so there is no textarea/multi-row
// step — one name, four toggles, one schedule anchor, and (only when
// carry_mapping is turned off) a per-category board/team picker mirroring
// BulkCreateProjectsSheet's CategoryMappingRow.

function useIsDesktop(): boolean {
  const { width } = useWindowDimensions();
  return width >= 768;
}

function randomKey(): string {
  // ponytail: crypto.randomUUID() isn't guaranteed on every RN/web runtime —
  // fall back to timestamp+random. Only needs to be unique per attempt, not
  // cryptographically strong. Same fallback BulkCreateProjectsSheet uses.
  // @ts-ignore
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// "2025 Audit" -> "2026 Audit"; falls back to appending "(Rollforward)" when
// no 4-digit year is found. A convenience default, not a requirement — the
// name field stays fully editable.
function suggestName(sourceName: string | undefined): string {
  if (!sourceName) return '';
  const m = sourceName.match(/\b(20\d{2})\b/);
  if (m) {
    const nextYear = String(Number(m[1]) + 1);
    return sourceName.replace(m[1], nextYear);
  }
  return `${sourceName} (Rollforward)`;
}

function nextMondayISO(): string {
  const d = new Date();
  const diff = ((8 - d.getDay()) % 7) || 7;
  d.setDate(d.getDate() + diff);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function endOfQuarterISO(): string {
  const d = new Date();
  const q = Math.floor(d.getMonth() / 3);
  const end = new Date(d.getFullYear(), q * 3 + 3, 0);
  return `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
}

type Pipeline = { id: string; name: string; hasStages: boolean };
type Team = { id: string; name: string; color: string | null };
type SourceCategory = { category: string; taskCount: number; currentPipelineName: string | null };
type CategoryValue = { pipeline_id: string | null; assignee_team_id: string | null };
type CategoryMapping = Record<string, CategoryValue>;
type ToggleKey = 'carry_assignments' | 'carry_mapping' | 'carry_estimates' | 'carry_files';

const TOGGLE_COPY: Record<ToggleKey, { label: string; hint: string }> = {
  carry_assignments: { label: 'Carry team assignments', hint: 'Reuse last year’s team per task category.' },
  carry_mapping: { label: 'Carry board mapping', hint: 'Reuse the board each category already lands on.' },
  carry_estimates: { label: 'Carry estimated hours', hint: 'Copy each task’s estimated hours forward.' },
  carry_files: { label: 'Link last year’s files', hint: 'Reference — never duplicate — last year’s sealed deliverable.' },
};

function ToggleRow({ toggleKey, value, onChange, c }: { toggleKey: ToggleKey; value: boolean; onChange: (v: boolean) => void; c: ReturnType<typeof useThemeColors> }) {
  const copy = TOGGLE_COPY[toggleKey];
  return (
    <TouchableOpacity
      onPress={() => onChange(!value)}
      className="flex-row items-center justify-between bg-surface-background border border-surface-border rounded-2xl px-4 py-3"
      style={{ minHeight: 44 }}
    >
      <View className="flex-1 mr-3">
        <Text className="text-typography-main text-sm font-black">{copy.label}</Text>
        <Text className="text-typography-muted text-[10px] mt-0.5">{copy.hint}</Text>
      </View>
      <View
        className="rounded-full"
        style={{ width: 40, height: 24, padding: 2, backgroundColor: value ? c.primary : c.border, justifyContent: 'center' }}
      >
        <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: 'white', alignSelf: value ? 'flex-end' : 'flex-start' }} />
      </View>
    </TouchableOpacity>
  );
}

// One row per distinct category the source project's tasks use — same shape
// as BulkCreateProjectsSheet's CategoryMappingRow, only rendered when
// carry_mapping is turned OFF (carry_mapping=true auto-derives this
// server-side from the source project's own board usage, see
// fn_resolve_batch_category_mapping's caller in rpc_rollforward_project).
function CategoryMappingRow({
  category, taskCount, currentPipelineName, value, pipelines, teams, onChange, c,
}: {
  category: string;
  taskCount: number;
  currentPipelineName: string | null;
  value: CategoryValue;
  pipelines: Pipeline[];
  teams: Team[];
  onChange: (next: CategoryValue) => void;
  c: ReturnType<typeof useThemeColors>;
}) {
  const [openField, setOpenField] = useState<'board' | 'team' | null>(null);
  const board = pipelines.find(p => p.id === value.pipeline_id) || null;
  const team = teams.find(t => t.id === value.assignee_team_id) || null;

  return (
    <View className="bg-surface-background border border-surface-border rounded-2xl p-3" style={{ gap: 8 }}>
      <View className="flex-row items-center justify-between">
        <Text className="text-typography-main text-sm font-black">{category || 'Uncategorized'}</Text>
        <Text className="text-typography-muted text-[10px] font-bold">
          {taskCount} task{taskCount === 1 ? '' : 's'}{currentPipelineName ? ` · was on ${currentPipelineName}` : ''}
        </Text>
      </View>
      <View className="flex-row gap-2">
        <TouchableOpacity
          onPress={() => setOpenField(f => (f === 'board' ? null : 'board'))}
          className={`flex-1 flex-row items-center justify-between px-3 rounded-lg border ${board ? 'border-surface-border' : 'border-state-danger'}`}
          style={{ minHeight: 44 }}
        >
          <Text className={`text-xs font-bold flex-1 ${board ? 'text-typography-main' : 'text-typography-dim'}`} numberOfLines={1}>
            {board ? board.name : 'Board (required)'}
          </Text>
          <FontAwesome name={openField === 'board' ? 'chevron-up' : 'chevron-down'} size={10} color={c.textDim} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setOpenField(f => (f === 'team' ? null : 'team'))}
          className="flex-1 flex-row items-center justify-between px-3 rounded-lg border border-surface-border"
          style={{ minHeight: 44 }}
        >
          <Text className={`text-xs font-bold flex-1 ${team ? 'text-typography-main' : 'text-typography-dim'}`} numberOfLines={1}>
            {team ? team.name : 'Team (optional)'}
          </Text>
          <FontAwesome name={openField === 'team' ? 'chevron-up' : 'chevron-down'} size={10} color={c.textDim} />
        </TouchableOpacity>
      </View>

      {openField === 'board' && (
        <View className="border-t border-surface-border pt-2" style={{ gap: 2 }}>
          {pipelines.length === 0 && <Text className="text-typography-dim text-xs italic px-2 py-1">No boards yet — create one first.</Text>}
          {pipelines.map(p => (
            <TouchableOpacity
              key={p.id}
              disabled={!p.hasStages}
              onPress={() => { onChange({ ...value, pipeline_id: p.id }); setOpenField(null); }}
              className="flex-row items-center justify-between px-3 py-2.5 rounded-lg"
              style={{ opacity: p.hasStages ? 1 : 0.4 }}
            >
              <Text className={`text-xs font-bold ${p.id === value.pipeline_id ? 'text-brand-primary' : 'text-typography-main'}`}>{p.name}</Text>
              {!p.hasStages && <Text className="text-state-danger text-[9px] font-black uppercase">No stages</Text>}
            </TouchableOpacity>
          ))}
        </View>
      )}

      {openField === 'team' && (
        <View className="border-t border-surface-border pt-2" style={{ gap: 2 }}>
          <TouchableOpacity onPress={() => { onChange({ ...value, assignee_team_id: null }); setOpenField(null); }} className="flex-row items-center px-3 py-2.5 rounded-lg">
            <Text className={`text-xs font-bold ${!value.assignee_team_id ? 'text-brand-primary' : 'text-typography-muted'}`}>No team</Text>
          </TouchableOpacity>
          {teams.map(t => (
            <TouchableOpacity key={t.id} onPress={() => { onChange({ ...value, assignee_team_id: t.id }); setOpenField(null); }} className="flex-row items-center gap-2 px-3 py-2.5 rounded-lg">
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.color ?? c.primary }} />
              <Text className={`text-xs font-bold ${t.id === value.assignee_team_id ? 'text-brand-primary' : 'text-typography-main'}`}>{t.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

export default function RollforwardSheet({
  visible, onClose, sourceProjectId, sourceProjectName, onRolledForward,
}: {
  visible: boolean;
  onClose: () => void;
  sourceProjectId: string;
  sourceProjectName?: string;
  onRolledForward?: (result: { project_id: string; portfolio_id: string; projects_created: number; tasks_created: number }) => void;
}) {
  const c = useThemeColors();
  const isDesktop = useIsDesktop();
  const todayISO = getQuickActionDate(0);
  const { profile } = useAuth();

  const [name, setName] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [loadingContext, setLoadingContext] = useState(true);
  const [carryAssignments, setCarryAssignments] = useState(true);
  const [carryMapping, setCarryMapping] = useState(true);
  const [carryEstimates, setCarryEstimates] = useState(true);
  const [carryFiles, setCarryFiles] = useState(true);
  const [anchorDate, setAnchorDate] = useState<string | null>(null);
  const [anchorDirection, setAnchorDirection] = useState<'start' | 'deadline' | null>(null);
  const [showCalendar, setShowCalendar] = useState(false);
  const [sourceCategories, setSourceCategories] = useState<SourceCategory[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [mapping, setMapping] = useState<CategoryMapping>({});
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mobilePage, setMobilePage] = useState<'form' | 'mapping'>('form');

  useEffect(() => {
    if (!visible) return;
    setError(null);
    setName(suggestName(sourceProjectName));
    setIdempotencyKey(randomKey());
    setAnchorDate(null);
    setAnchorDirection(null);
    setShowCalendar(false);
    setMobilePage('form');
    setLoadingContext(true);

    (async () => {
      const [{ data: company }, { data: taskRows }, { data: pipelineRows }, { data: teamRows }] = await Promise.all([
        profile?.company_id
          ? supabase.from('companies').select('rollforward_defaults').eq('id', profile.company_id).single()
          : Promise.resolve({ data: null as any }),
        supabase.from('tasks').select('category, pipeline_id, pipelines(name)').eq('project_id', sourceProjectId).is('deleted_at', null).is('parent_task_id', null),
        supabase.from('pipelines').select('id, name').eq('subject_kind', 'task').is('deleted_at', null).order('name'),
        supabase.from('teams').select('id, name, color').is('deleted_at', null).order('name'),
      ]);

      const defaults = (company?.rollforward_defaults ?? {}) as Partial<Record<ToggleKey, boolean>>;
      setCarryAssignments(defaults.carry_assignments ?? true);
      setCarryMapping(defaults.carry_mapping ?? true);
      setCarryEstimates(defaults.carry_estimates ?? true);
      setCarryFiles(defaults.carry_files ?? true);

      const byCategory = new Map<string, { count: number; pipelineId: string | null; pipelineName: string | null }>();
      for (const row of (taskRows || []) as any[]) {
        const key = row.category || '';
        const existing = byCategory.get(key) || { count: 0, pipelineId: null, pipelineName: null };
        existing.count += 1;
        existing.pipelineId = existing.pipelineId ?? row.pipeline_id ?? null;
        existing.pipelineName = existing.pipelineName ?? row.pipelines?.name ?? null;
        byCategory.set(key, existing);
      }
      const categories = Array.from(byCategory.entries())
        .map(([category, v]) => ({ category, taskCount: v.count, currentPipelineName: v.pipelineName }))
        .sort((a, b) => a.category.localeCompare(b.category));
      setSourceCategories(categories);

      const ids = (pipelineRows || []).map((p: any) => p.id);
      const { data: stageRows } = ids.length
        ? await supabase.from('pipeline_stages').select('pipeline_id').in('pipeline_id', ids)
        : { data: [] as any[] };
      const withStages = new Set((stageRows || []).map((s: any) => s.pipeline_id));
      const pipelinesList = (pipelineRows || []).map((p: any) => ({ id: p.id, name: p.name, hasStages: withStages.has(p.id) }));
      setPipelines(pipelinesList);
      setTeams((teamRows || []) as Team[]);

      // Pre-fill the mapping picker with what each category is CURRENTLY on
      // — a sane starting point if the user turns carry_mapping off to tweak
      // just one category rather than remapping everything from scratch.
      setMapping(prev => {
        const next: CategoryMapping = {};
        for (const cat of categories) {
          const src = byCategory.get(cat.category);
          next[cat.category] = prev[cat.category] || { pipeline_id: src?.pipelineId ?? null, assignee_team_id: null };
        }
        return next;
      });

      setLoadingContext(false);
    })();
  }, [visible, sourceProjectId]);

  const totalTasks = useMemo(() => sourceCategories.reduce((sum, c2) => sum + c2.taskCount, 0), [sourceCategories]);
  const anchorIsPast = !!anchorDate && anchorDate < todayISO;
  const anchorReady = !!anchorDate && !!anchorDirection && !anchorIsPast;
  const mappingReady = carryMapping || (sourceCategories.length > 0 && sourceCategories.every(cat => !!mapping[cat.category]?.pipeline_id));
  const mappedCount = sourceCategories.filter(cat => !!mapping[cat.category]?.pipeline_id).length;

  const canSubmit = !creating && !loadingContext && name.trim().length > 0 && anchorReady && mappingReady && totalTasks > 0;

  // §14.2 / §17 — a disabled control must always be able to say why. This used
  // to be a greyed-out button with no explanation anywhere on the sheet.
  const blockedReason: string | null =
    creating ? 'Creating the new project…'
    : loadingContext ? 'Still reading this project’s task list…'
    : !name.trim() ? 'Give the new project a name.'
    : totalTasks === 0 ? 'This project has no tasks to carry forward, so there is nothing to roll.'
    : !anchorDirection ? 'Choose whether the date you pick is the start or the deadline.'
    : !anchorDate ? 'Pick the date the new project hangs off.'
    : anchorIsPast ? 'That date has already passed — pick today or later.'
    : !mappingReady ? `Every category needs a board — ${mappedCount} of ${sourceCategories.length} done.`
    : null;

  const handleSubmit = async () => {
    if (!canSubmit || !anchorDate || !anchorDirection) return;
    setCreating(true);
    setError(null);

    const options: Record<string, unknown> = {
      carry_assignments: carryAssignments,
      carry_mapping: carryMapping,
      carry_estimates: carryEstimates,
      carry_files: carryFiles,
      target_date: new Date(anchorDate).toISOString(),
      anchor_direction: anchorDirection,
      idempotency_key: idempotencyKey,
    };
    if (!carryMapping) {
      options.category_mapping = sourceCategories.map(cat => ({
        category: cat.category,
        pipeline_id: mapping[cat.category]?.pipeline_id ?? null,
        assignee_team_id: mapping[cat.category]?.assignee_team_id ?? null,
      }));
    }

    const { data, error: err } = await supabase.rpc('rpc_rollforward_project', {
      p_source_project_id: sourceProjectId,
      p_new_name: name.trim(),
      p_options: options,
    });
    setCreating(false);

    if (err) {
      // rpc_rollforward_project's errors are already legible (named category/
      // pipeline/project offenders — see 20260801_rollforward_project.sql and
      // the batch RPCs it composes), so the raw message is the right thing
      // to surface, same convention BulkCreateProjectsSheet follows.
      setError(err.message);
      return;
    }

    onRolledForward?.(data);
    onClose();
  };

  const toggles: ToggleKey[] = ['carry_mapping', 'carry_assignments', 'carry_estimates', 'carry_files'];
  const toggleState: Record<ToggleKey, [boolean, (v: boolean) => void]> = {
    carry_assignments: [carryAssignments, setCarryAssignments],
    carry_mapping: [carryMapping, setCarryMapping],
    carry_estimates: [carryEstimates, setCarryEstimates],
    carry_files: [carryFiles, setCarryFiles],
  };

  const formContent = (
    <View style={{ gap: 16 }}>
      {/* What a rollforward IS. "Roll forward" is jargon; this is the closest
          thing the product has to "duplicate", and users will look for it
          under that word (plan §14.2). */}
      <View className="flex-row items-start gap-3 bg-surface-background border border-surface-border rounded-2xl p-3.5">
        <EntityGlyph kind="project" size={28} />
        <View className="flex-1">
          <Text className="text-typography-main text-xs font-bold">
            Copies {sourceProjectName ? `“${sourceProjectName}”` : 'this project'} into a new one
          </Text>
          <Text className="text-typography-muted text-[11px] mt-0.5 leading-4">
            Same task structure, new dates, nothing changed on the original. This is how next year’s engagement gets made.
          </Text>
        </View>
      </View>

      <View>
        <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-2">New Project Name</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="e.g. Abdallah Group — 2027 Audit"
          placeholderTextColor={c.textDim}
          className="bg-surface-background border border-surface-border rounded-lg px-4 py-3"
          style={{ color: c.textMain }}
        />
      </View>

      <View style={{ gap: 8 }}>
        <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest">What Carries Forward</Text>
        {toggles.map(key => {
          const [value, setValue] = toggleState[key];
          return <ToggleRow key={key} toggleKey={key} value={value} onChange={setValue} c={c} />;
        })}
        <Text className="text-typography-muted text-[10px]">
          Task structure ({totalTasks} task{totalTasks === 1 ? '' : 's'} across {sourceCategories.length} categor{sourceCategories.length === 1 ? 'y' : 'ies'}) always carries — that is what rollforward means.
        </Text>
      </View>

      <View style={{ gap: 8 }}>
        <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest">Schedule</Text>
        <View className="flex-row gap-2">
          <TouchableOpacity
            onPress={() => setAnchorDirection('deadline')}
            className={`flex-1 rounded-xl border px-3 justify-center ${anchorDirection === 'deadline' ? 'bg-brand-primary border-brand-primary' : 'bg-surface-background border-surface-border'}`}
            style={{ minHeight: 44 }}
          >
            <Text className={`text-xs font-black uppercase tracking-wider ${anchorDirection === 'deadline' ? 'text-white' : 'text-typography-main'}`}>Due by</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setAnchorDirection('start')}
            className={`flex-1 rounded-xl border px-3 justify-center ${anchorDirection === 'start' ? 'bg-brand-primary border-brand-primary' : 'bg-surface-background border-surface-border'}`}
            style={{ minHeight: 44 }}
          >
            <Text className={`text-xs font-black uppercase tracking-wider ${anchorDirection === 'start' ? 'text-white' : 'text-typography-main'}`}>Starts on</Text>
          </TouchableOpacity>
        </View>
        <View className="flex-row flex-wrap gap-2">
          {[{ label: 'Today', date: todayISO }, { label: 'Next Monday', date: nextMondayISO() }, { label: 'End of Quarter', date: endOfQuarterISO() }].map(preset => (
            <TouchableOpacity
              key={preset.label}
              onPress={() => setAnchorDate(preset.date)}
              className={`rounded-lg border px-3 justify-center ${anchorDate === preset.date ? 'bg-brand-primary border-brand-primary' : 'bg-surface-background border-surface-border'}`}
              style={{ minHeight: 44 }}
            >
              <Text className={`text-[10px] font-black uppercase tracking-wider ${anchorDate === preset.date ? 'text-white' : 'text-typography-muted'}`}>{preset.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity
          onPress={() => setShowCalendar(v => !v)}
          className={`flex-row items-center justify-between px-4 rounded-lg border ${anchorIsPast ? 'border-state-danger' : 'border-surface-border'} bg-surface-background`}
          style={{ minHeight: 44 }}
        >
          <Text className="text-sm font-black" style={{ color: anchorDate ? c.textMain : c.textDim }}>
            {anchorDate ? new Date(anchorDate).toLocaleDateString(undefined, { dateStyle: 'medium' }) : 'Pick a date'}
          </Text>
          <FontAwesome name="calendar-o" size={14} color={c.primary} />
        </TouchableOpacity>
        {showCalendar && <Calendar selectedDate={anchorDate} onSelect={d => { setAnchorDate(d); setShowCalendar(false); }} accentColor={c.primary} scale="compact" />}
        {anchorIsPast && <Text className="text-state-danger text-xs font-bold">{anchorDate} is in the past — pick a current or future date.</Text>}
      </View>

      {error && <Text className="text-state-danger text-xs font-bold">{error}</Text>}
    </View>
  );

  const mappingContent = loadingContext ? (
    <ActivityIndicator color={c.primary} />
  ) : carryMapping ? (
    <View className="bg-surface-background border border-surface-border rounded-2xl p-4 flex-row items-start gap-3">
      <FontAwesome name="magic" size={14} color={c.primary} style={{ marginTop: 2 }} />
      <Text className="text-typography-main text-sm font-bold flex-1">
        Each category lands back on the SAME board it used last year — turn "Carry board mapping" off to choose fresh boards instead.
      </Text>
    </View>
  ) : (
    <View style={{ gap: 8 }}>
      {sourceCategories.map(cat => (
        <CategoryMappingRow
          key={cat.category}
          category={cat.category}
          taskCount={cat.taskCount}
          currentPipelineName={cat.currentPipelineName}
          value={mapping[cat.category] || { pipeline_id: null, assignee_team_id: null }}
          pipelines={pipelines}
          teams={teams}
          onChange={next => setMapping(prev => ({ ...prev, [cat.category]: next }))}
          c={c}
        />
      ))}
    </View>
  );

  if (!isDesktop) {
    // Mobile: one DraggableSheet, sections stacked (ux-consistency.md's
    // "simple overflow" tier — the category list here is a handful of rows,
    // not the dozens/hundreds that warrant a dedicated drill-in screen), with
    // an optional second page for the mapping picker only when it is both
    // visible (carry_mapping off) and would otherwise crowd the form.
    return (
      <DraggableSheet visible={visible} onClose={onClose} dimBackdrop maxHeight="95%" dismissible={!creating} scrollable={false} containerClassName="rounded-t-[2rem] overflow-hidden">
        <View style={{ flex: 1, minHeight: 0 }}>
          {mobilePage === 'form' ? (
            <>
              <View className="flex-row items-center justify-between px-5 pt-3 pb-4">
                <View className="flex-1 mr-3 flex-row items-center gap-2.5">
                  <EntityGlyph kind="project" size={32} />
                  <View className="flex-1">
                    <EntityTag kind="project" />
                    <Text className="text-typography-main text-lg font-black tracking-tight" numberOfLines={1}>
                      {sourceProjectName ? `Roll ${sourceProjectName} forward` : 'Roll forward'}
                    </Text>
                  </View>
                </View>
                <TouchableOpacity onPress={onClose} disabled={creating} className="w-10 h-10 items-center justify-center rounded-full" style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border }}>
                  <FontAwesome name="times" size={16} color={c.textMain} />
                </TouchableOpacity>
              </View>
              <ScrollView className="px-5" showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 16, paddingBottom: 20 }}>
                {formContent}
                {!carryMapping && (
                  <TouchableOpacity
                    onPress={() => setMobilePage('mapping')}
                    className="flex-row items-center justify-between p-4 rounded-2xl"
                    style={{ backgroundColor: c.card, borderWidth: 1, borderColor: mappedCount === sourceCategories.length ? c.border : c.danger, minHeight: 44 }}
                  >
                    <View className="flex-1 mr-3">
                      <Text className="text-typography-main font-black text-sm">Map Categories To Boards</Text>
                      <Text className="text-typography-muted text-[10px] font-bold mt-0.5">{mappedCount} of {sourceCategories.length} mapped</Text>
                    </View>
                    <FontAwesome name="chevron-right" size={14} color={c.textMuted} />
                  </TouchableOpacity>
                )}
              </ScrollView>
              <View className="px-5 py-4" style={{ borderTopWidth: 1, borderTopColor: c.border }}>
                {!!blockedReason && (
                  <Text className="text-typography-muted text-[11px] mb-2.5">{blockedReason}</Text>
                )}
                <View className="flex-row gap-3">
                  <TouchableOpacity onPress={onClose} disabled={creating} className="flex-1 py-3.5 rounded-2xl items-center" style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border }}>
                    <Text className="font-bold text-sm" style={{ color: c.textMuted }}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={handleSubmit} disabled={!canSubmit} className="flex-[2] py-3.5 rounded-2xl items-center" style={{ backgroundColor: canSubmit ? c.primary : c.border }}>
                    <Text className="font-bold text-sm" style={{ color: canSubmit ? 'white' : c.textMuted }}>{creating ? 'Creating…' : 'Create the new project'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </>
          ) : (
            <>
              <View className="flex-row items-center px-3 pt-3 pb-3" style={{ borderBottomWidth: 1, borderBottomColor: c.border }}>
                <TouchableOpacity onPress={() => setMobilePage('form')} className="w-10 h-10 items-center justify-center rounded-full mr-2" style={{ backgroundColor: c.background }}>
                  <FontAwesome name="chevron-left" size={14} color={c.textMain} />
                </TouchableOpacity>
                <View className="flex-1">
                  <Text className="text-typography-muted text-[9px] font-black uppercase tracking-[0.3em] mb-0.5">Rollforward</Text>
                  <Text className="text-typography-main font-black text-base tracking-tight">Map Categories</Text>
                </View>
                <Text className="text-typography-muted text-[10px] font-black mr-1">{mappedCount}/{sourceCategories.length}</Text>
              </View>
              <ScrollView className="px-5 pt-4" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
                {mappingContent}
              </ScrollView>
            </>
          )}
        </View>
      </DraggableSheet>
    );
  }

  // Desktop: 2 peer columns (form+toggles / mapping-or-summary) per
  // ux-consistency.md's density rule — a toggles+preview sheet is
  // info-dense, 720-1100px with real columns, not a single tall scroll.
  return (
    <Popup
      visible={visible}
      onClose={onClose}
      presentation="centered"
      title={sourceProjectName ? `Roll “${sourceProjectName}” forward` : 'Roll this project forward'}
      footer="dual-action"
      secondaryAction={{ label: 'Cancel', onPress: onClose }}
      primaryAction={{ label: creating ? 'Creating…' : 'Create the new project', onPress: handleSubmit, variant: canSubmit ? 'default' : 'disabled' }}
      dismissible={!creating}
      maxWidth={820}
      containerStyle={{ height: '82%' }}
    >
      <View className="px-6 pb-5" style={{ flexDirection: 'row', flex: 1, minHeight: 0, gap: 24, paddingTop: 16 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
            {formContent}
          </ScrollView>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-2">
            {carryMapping ? 'Board Mapping' : `Map Each Category (${mappedCount}/${sourceCategories.length})`}
          </Text>
          <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
            {mappingContent}
          </ScrollView>
          {/* Popup's own footer button can't carry an explanation, so the
              reason it is disabled lives at the bottom of the column the user
              is most likely still working in. */}
          {!!blockedReason && (
            <Tooltip label={blockedReason}>
              <View className="flex-row items-center gap-2 mt-2 pt-2 border-t border-surface-border">
                <FontAwesome name="info-circle" size={11} color={c.textMuted} />
                <Text className="text-typography-muted text-[11px] flex-1">{blockedReason}</Text>
              </View>
            </Tooltip>
          )}
        </View>
      </View>
    </Popup>
  );
}
