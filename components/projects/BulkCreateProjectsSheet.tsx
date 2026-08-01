import Calendar from '@/components/common/Calendar';
import DraggableSheet from '@/components/common/DraggableSheet';
import Popup from '@/components/common/Popup';
import StarterTemplatePickerSheet from '@/components/projects/StarterTemplatePickerSheet';
import { useAuth } from '@/contexts/AuthContext';
import { useUploadManager } from '@/contexts/UploadManagerContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { getQuickActionDate } from '@/lib/calendarPicker';
import { supabase } from '@/lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TextInput, TouchableOpacity, useWindowDimensions, View } from 'react-native';

// Popup's presentation="auto" resolves sheet-vs-centered itself for the
// "setup" step, but the "configure" step below is hand-rolled per-branch
// (DraggableSheet vs centered Popup) because the two need structurally
// different children (mobile drill-in vs a 3-column desktop layout), not
// just a different width — see .agents/rules/ux-consistency.md's mobile
// overflow / desktop density guidance. Mirror Popup's own default
// desktopBreakpoint of 768 so the two never disagree.
function useIsDesktop(): boolean {
  const { width } = useWindowDimensions();
  return width >= 768;
}

function randomKey(): string {
  // ponytail: crypto.randomUUID() isn't guaranteed on every RN/web runtime this
  // app ships to — fall back to a timestamp+random string. Only needs to be
  // unique per bulk-create attempt, not cryptographically strong.
  // @ts-ignore
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// "Next Monday" / "End of quarter" aren't in lib/calendarPicker's QUICK_ACTIONS
// (those are relative +N-day offsets) — issue #182 asks for these two by name,
// so they're computed locally rather than added to a shared picker that has no
// other caller wanting them yet. Same YYYY-MM-DD shape getQuickActionDate(0)
// returns, so all three stay directly comparable as strings.
function nextMondayISO(): string {
  const d = new Date();
  const diff = ((8 - d.getDay()) % 7) || 7; // always strictly in the future, never "today"
  d.setDate(d.getDate() + diff);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function endOfQuarterISO(): string {
  const d = new Date();
  const q = Math.floor(d.getMonth() / 3);
  const end = new Date(d.getFullYear(), q * 3 + 3, 0); // day 0 of the month after = last day of the quarter
  return `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
}
function fmtShort(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

type Template = { id: string; name: string; body: any[] };
type Pipeline = { id: string; name: string; hasStages: boolean };
type Team = { id: string; name: string; color: string | null };
type CategoryValue = { pipeline_id: string | null; assignee_team_id: string | null };
type CategoryMapping = Record<string, CategoryValue>;
type PreviewResult = { projects: number; tasks: number; boards: number; first_task_date: string | null; last_task_date: string | null };

// client_ref defaults to `name` for the textarea path (see parseLines below);
// spreadsheet intake (issue #188) is the first caller that can supply a
// client_ref distinct from the project name, via `initialRows`.
type ParsedLine = { raw: string; name: string; client_ref: string; start_date: string | null; external_ref: string | null };

// One line = one project. "Name" doubles as the client name to upsert — the
// issue frames this feature as "paste a list of client names", and the
// textarea format the issue specifies (`Name, 2026-08-01`) has no separate
// client column, so project name and client_ref are the same string here.
// Judgment call: split into a real "Name | Client" column later if a firm's
// project names and client names diverge often enough to need it.
//
// Third optional field: a stable client identifier (issue #171 gap 1 / plan
// §13.3) — e.g. a commercial-registration or file number. When present, the
// client is matched/created on that ref instead of on name, so "Abdallah
// Group" this year and "Abdallah Group LLC" next year resolve to the same
// client instead of silently forking into two. Leave a line's date field
// blank (two commas) to supply a ref with no date.
function parseLines(text: string): ParsedLine[] {
  return text
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(raw => {
      const [namePart, datePart, refPart] = raw.split(',');
      const name = (namePart || '').trim();
      const dateStr = (datePart || '').trim();
      const external_ref = (refPart || '').trim() || null;
      let start_date: string | null = null;
      if (dateStr) {
        const d = new Date(dateStr);
        if (!isNaN(d.getTime())) start_date = d.toISOString();
      }
      return { raw, name, client_ref: name, start_date, external_ref };
    })
    .filter(p => p.name.length > 0);
}

// One row per DISTINCT category the template body uses (issue #182 — "a
// 25-task template becomes four decisions, not twenty-five"). Board is the
// sole source of pipeline_id/current_stage_id server-side and is required;
// team is optional. Deliberately kept inline in this file rather than
// extracted to components/common — plan §13.11 notes this same "category ->
// board/team" picker will get mounted again from the Work tab (#184), at
// which point it's worth promoting to a shared component. One call site
// today; extracting now would be a speculative abstraction.
function CategoryMappingRow({
  category, value, pipelines, teams, onChange, c,
}: {
  category: string;
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
      <Text className="text-typography-main text-sm font-black">{category || 'Uncategorized'}</Text>
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
          <TouchableOpacity
            onPress={() => { onChange({ ...value, assignee_team_id: null }); setOpenField(null); }}
            className="flex-row items-center px-3 py-2.5 rounded-lg"
          >
            <Text className={`text-xs font-bold ${!value.assignee_team_id ? 'text-brand-primary' : 'text-typography-muted'}`}>No team</Text>
          </TouchableOpacity>
          {teams.map(t => (
            <TouchableOpacity
              key={t.id}
              onPress={() => { onChange({ ...value, assignee_team_id: t.id }); setOpenField(null); }}
              className="flex-row items-center gap-2 px-3 py-2.5 rounded-lg"
            >
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.color ?? c.primary }} />
              <Text className={`text-xs font-bold ${t.id === value.assignee_team_id ? 'text-brand-primary' : 'text-typography-main'}`}>{t.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

export default function BulkCreateProjectsSheet({
  visible, onClose, onCreated,
  initialRows, initialPortfolioName, initialSource, initialIdempotencyKey, initialSourceFile,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated?: (result: { portfolio_id: string; projects_created: number; tasks_created: number }) => void;
  // Spreadsheet intake hand-off (issue #188 / plan §15) — when set, this step
  // opens with the projects array already answered instead of an empty
  // textarea: the human confirms a filled-in form rather than typing it.
  // Nothing here is required — every existing caller (the plain "Bulk
  // Create" button) omits all five and gets the unchanged textarea flow.
  initialRows?: ParsedLine[];
  initialPortfolioName?: string;
  initialSource?: string; // portfolios.source, e.g. "spreadsheet:Company X Q3.xlsx"
  initialIdempotencyKey?: string; // sha256-derived — makes re-dropping the same file a no-op
  // The original file + its content hash, uploaded to FileHub (visibility
  // 'broadcast', a get-or-create folder) AFTER a successful create — evidence
  // trail per plan §15.3, never blocking the data write if it fails.
  initialSourceFile?: { file: File; contentHash: string } | null;
}) {
  const c = useThemeColors();
  const isDesktop = useIsDesktop();
  const todayISO = getQuickActionDate(0);
  const { profile } = useAuth();
  const { startUpload } = useUploadManager();

  const [step, setStep] = useState<'setup' | 'configure'>('setup');

  const [templates, setTemplates] = useState<Template[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [portfolioName, setPortfolioName] = useState('');
  const [text, setText] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [starterPickerVisible, setStarterPickerVisible] = useState(false);

  // Batch configuration (issue #182 / plan §13.10) — the step this whole
  // issue exists to add. Category mapping and the schedule anchor share this
  // one step because rpc_instantiate_template requires both before it will
  // write anything reachable.
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loadingResources, setLoadingResources] = useState(true);
  const [mapping, setMapping] = useState<CategoryMapping>({});
  const [anchorDate, setAnchorDate] = useState<string | null>(null);
  const [anchorDirection, setAnchorDirection] = useState<'start' | 'deadline' | null>(null);
  const [showCalendar, setShowCalendar] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  // Mobile-only drill-in (ux-consistency.md "mobile overflow" tier 2): the
  // category list can be dozens of rows for a big template, so it gets its
  // own full-height page rather than stacking under the schedule/preview in
  // one sheet. Desktop doesn't need this — it gets its own column instead.
  const [mobilePage, setMobilePage] = useState<'schedule' | 'categories'>('schedule');

  useEffect(() => {
    if (!visible) return;
    setError(null);
    setStep('setup');
    setPortfolioName(initialPortfolioName ?? '');
    // Content-hash-derived key (spreadsheet intake) makes re-dropping the
    // same file a no-op at the RPC's existing idempotency check — falls back
    // to a random key for the manual paste-textarea path, unchanged.
    setIdempotencyKey(initialIdempotencyKey ?? randomKey());
    setMapping({});
    setAnchorDate(null);
    setAnchorDirection(null);
    setShowCalendar(false);
    setPreview(null);
    setPreviewError(null);
    setMobilePage('schedule');
    setLoadingTemplates(true);
    supabase
      .from('project_templates')
      .select('id, name, body')
      .order('name', { ascending: true })
      .then(({ data, error: err }) => {
        if (err) setError(err.message);
        else {
          setTemplates((data || []) as Template[]);
          setTemplateId(prev => prev ?? (data && data[0] ? data[0].id : null));
        }
        setLoadingTemplates(false);
      });
  }, [visible]);

  // Boards + teams for the mapping step. Boards are scoped to subject_kind
  // 'task' (default kind, see 20260731_pipeline_subject_kind.sql) — these are
  // the boards generated TASKS land on, mirroring what CreateTaskModal offers,
  // not project-lifecycle pipelines (subject_kind='project', ProjectStagePicker's
  // domain). "Own company only" is enforced by pipelines_select RLS, not a
  // client-side filter — there is no way for this list to contain another
  // company's boards.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoadingResources(true);
    (async () => {
      const [{ data: pipelineRows }, { data: teamRows }] = await Promise.all([
        supabase.from('pipelines').select('id, name').eq('subject_kind', 'task').is('deleted_at', null).order('name'),
        supabase.from('teams').select('id, name, color').is('deleted_at', null).order('name'),
      ]);
      const ids = (pipelineRows || []).map(p => p.id);
      const { data: stageRows } = ids.length
        ? await supabase.from('pipeline_stages').select('pipeline_id').in('pipeline_id', ids)
        : { data: [] as any[] };
      if (cancelled) return;
      const withStages = new Set((stageRows || []).map(s => s.pipeline_id));
      setPipelines((pipelineRows || []).map(p => ({ id: p.id, name: p.name, hasStages: withStages.has(p.id) })));
      setTeams((teamRows || []) as Team[]);
      setLoadingResources(false);
    })();
    return () => { cancelled = true; };
  }, [visible]);

  const selectedTemplate = useMemo(() => templates.find(t => t.id === templateId) || null, [templates, templateId]);
  // Spreadsheet-imported rows (already parsed + client-resolved upstream)
  // pre-fill this step entirely; otherwise fall back to the textarea, unchanged.
  const parsed = useMemo(() => initialRows ?? parseLines(text), [initialRows, text]);
  const taskCountPerProject = selectedTemplate?.body?.length || 0;
  const pastLines = useMemo(() => parsed.filter(p => p.start_date && p.start_date.slice(0, 10) < todayISO), [parsed, todayISO]);

  // The mapping unit is the category, not the task — a 25-task template
  // collapses to however many distinct categories it uses (plan §13.10).
  const categories = useMemo(() => {
    const seen = new Set<string>();
    for (const item of selectedTemplate?.body || []) seen.add((item && item.category) || '');
    return Array.from(seen).sort();
  }, [selectedTemplate]);

  // Seed a mapping entry for every category as templates change; entries for
  // categories no longer present are simply never read (buildCategoryMapping
  // below only iterates the CURRENT `categories`), so switching templates back
  // and forth can't accidentally submit a stale "category the template
  // doesn't use" row — the exact typo-guard RAISE this form must avoid.
  useEffect(() => {
    setMapping(prev => {
      const next: CategoryMapping = {};
      for (const cat of categories) next[cat] = prev[cat] || { pipeline_id: null, assignee_team_id: null };
      return next;
    });
  }, [categories.join('\u0000')]);

  const allCategoriesMapped = categories.length > 0 && categories.every(cat => !!mapping[cat]?.pipeline_id);
  const mappedCount = categories.filter(cat => !!mapping[cat]?.pipeline_id).length;
  const anchorIsPast = !!anchorDate && anchorDate < todayISO;
  const anchorReady = !!anchorDate && !!anchorDirection && !anchorIsPast;

  const canProceedToConfigure = !!templateId && taskCountPerProject > 0 && parsed.length > 0 && pastLines.length === 0;

  function buildProjectsPayload() {
    return parsed.map(p => ({ name: p.name, client_ref: p.client_ref, client_external_ref: p.external_ref, start_date: p.start_date }));
  }
  function buildCategoryMapping() {
    return categories.map(cat => ({
      category: cat,
      pipeline_id: mapping[cat]?.pipeline_id ?? null,
      assignee_team_id: mapping[cat]?.assignee_team_id ?? null,
    }));
  }

  // Live preview — calls the SAME resolver/span math as commit (plan §13.10),
  // so a successful preview is a promise commit will also succeed. That means
  // a preview error IS this form's validation feedback for anything the UI
  // can't cheaply pre-check itself (e.g. a mapped pipeline losing its stages
  // between page load and submit, or a pasted name colliding with an active
  // project — rpc_preview_instantiate_template now checks both duplicate
  // shapes server-side, see 20260801_batch_duplicate_name_check.sql). Debounced
  // with a plain setTimeout — no library needed for one call site.
  useEffect(() => {
    if (step !== 'configure' || !templateId || !allCategoriesMapped || !anchorReady) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    const timer = setTimeout(async () => {
      const { data, error: err } = await supabase.rpc('rpc_preview_instantiate_template', {
        p_template_id: templateId,
        p_portfolio: { target_date: new Date(anchorDate as string).toISOString(), anchor_direction: anchorDirection },
        p_projects: buildProjectsPayload(),
        p_category_mapping: buildCategoryMapping(),
      });
      if (cancelled) return;
      setPreviewLoading(false);
      if (err) { setPreviewError(err.message); setPreview(null); }
      else { setPreview(data as PreviewResult); setPreviewError(null); }
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, templateId, JSON.stringify(mapping), anchorDate, anchorDirection, text]);

  const canCreate = !creating && !previewLoading && !!preview && !previewError;

  // Evidence trail (plan §15.3): get-or-create a FileHub folder for the
  // source file and hand its id to rpc_instantiate_template so it lands on
  // portfolios.standing_folder_id in the SAME transaction as the rest of the
  // batch (20260801_spreadsheet_intake_portfolio_folder.sql). Uses the
  // EXISTING idempotent rpc_filehub_folder_create — no new upload path, no
  // new FileHub visibility value. Never blocks or fails the actual data
  // write: a FileHub problem here degrades to "no source file attached",
  // not "batch creation failed".
  async function getOrCreateStandingFolder(): Promise<string | null> {
    try {
      const { data: rootId, error: rootErr } = await supabase.rpc('rpc_filehub_folder_create', {
        p_name: 'Portfolio Imports',
        p_scope: 'broadcast',
      });
      if (rootErr || !rootId) return null;
      const leafName = (portfolioName.trim() || `${selectedTemplate?.name ?? 'Batch'} batch`).slice(0, 80);
      const { data: leafId, error: leafErr } = await supabase.rpc('rpc_filehub_folder_create', {
        p_name: leafName,
        p_parent_id: rootId,
        p_scope: 'broadcast',
      });
      if (leafErr || !leafId) return null;
      return leafId as string;
    } catch {
      return null;
    }
  }

  const handleCreate = async () => {
    if (!canCreate || !templateId || !anchorDate || !anchorDirection) return;
    setCreating(true);
    setError(null);

    const standingFolderId = initialSourceFile ? await getOrCreateStandingFolder() : null;

    const { data, error: err } = await supabase.rpc('rpc_instantiate_template', {
      p_template_id: templateId,
      p_portfolio: {
        name: portfolioName.trim() || null,
        source: initialSource ?? null,
        manifest: parsed.map(p => ({ name: p.name, instantiated: true })),
        target_date: new Date(anchorDate).toISOString(),
        anchor_direction: anchorDirection,
        standing_folder_id: standingFolderId,
      },
      p_projects: buildProjectsPayload(),
      p_category_mapping: buildCategoryMapping(),
      p_idempotency_key: idempotencyKey,
    });
    setCreating(false);

    if (err) {
      // rpc_instantiate_template runs the identical duplicate-name check
      // preview does (20260801_batch_duplicate_name_check.sql), so this path
      // is now a defence-in-depth backstop (e.g. another project created the
      // colliding name between preview and commit), not the primary way a
      // duplicate is surfaced — the message is still the RPC's named-offender
      // text, never the raw "duplicate key value violates..." constraint
      // error, because that RAISE fires before Postgres ever reaches the
      // unique index.
      setError(err.message);
      return;
    }

    // Upload the source file AFTER the transaction lands, and only for a
    // genuinely new batch — a replayed idempotency key (already_processed)
    // means the file from the original run is already there.
    if (initialSourceFile && standingFolderId && !data?.already_processed && profile?.company_id) {
      startUpload({
        files: [initialSourceFile.file],
        companyId: profile.company_id,
        visibility: 'broadcast',
        folderId: standingFolderId,
        recipientIds: [],
        groupId: null,
        tags: ['portfolio-import'],
        caption: `Source file for "${portfolioName.trim() || selectedTemplate?.name || 'this'}" batch`,
        maxFileSizeBytes: null,
        scopedFolders: [],
        label: 'Portfolio source file',
      });
    }

    onCreated?.(data);
    onClose();
  };

  const openConfigure = () => {
    setMobilePage('schedule');
    setStep('configure');
  };

  // ─── Shared "configure" step content — desktop columns and the mobile
  // "schedule" page render the identical schedule/preview UI; only the
  // wrapping (ScrollView column vs full sheet page) differs. ───────────────
  const scheduleAndPreview = (
    <>
      <View style={{ gap: 8 }}>
        <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest">Schedule</Text>

        {/* Back-scheduling (deadline) listed first — this domain typically
            receives a deadline ("six months to complete them"), not a
            start date (issue #182), so it must not read as the secondary
            option. */}
        <View className="flex-row gap-2">
          <TouchableOpacity
            onPress={() => setAnchorDirection('deadline')}
            className={`flex-1 rounded-xl border px-3 justify-center ${anchorDirection === 'deadline' ? 'bg-brand-primary border-brand-primary' : 'bg-surface-background border-surface-border'}`}
            style={{ minHeight: 44 }}
          >
            <Text className={`text-xs font-black uppercase tracking-wider ${anchorDirection === 'deadline' ? 'text-white' : 'text-typography-main'}`}>Due by</Text>
            <Text className={`text-[10px] mt-0.5 ${anchorDirection === 'deadline' ? 'text-white/80' : 'text-typography-muted'}`}>Tasks land on this date; start is worked backward</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setAnchorDirection('start')}
            className={`flex-1 rounded-xl border px-3 justify-center ${anchorDirection === 'start' ? 'bg-brand-primary border-brand-primary' : 'bg-surface-background border-surface-border'}`}
            style={{ minHeight: 44 }}
          >
            <Text className={`text-xs font-black uppercase tracking-wider ${anchorDirection === 'start' ? 'text-white' : 'text-typography-main'}`}>Starts on</Text>
            <Text className={`text-[10px] mt-0.5 ${anchorDirection === 'start' ? 'text-white/80' : 'text-typography-muted'}`}>Tasks are due on their researched offset from this date</Text>
          </TouchableOpacity>
        </View>

        <View className="flex-row flex-wrap gap-2">
          {[
            { label: 'Today', date: todayISO },
            { label: 'Next Monday', date: nextMondayISO() },
            { label: 'End of Quarter', date: endOfQuarterISO() },
          ].map(preset => (
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
        {showCalendar && (
          <Calendar
            selectedDate={anchorDate}
            onSelect={d => { setAnchorDate(d); setShowCalendar(false); }}
            accentColor={c.primary}
            scale="compact"
          />
        )}
        {anchorIsPast && <Text className="text-state-danger text-xs font-bold">{anchorDate} is in the past — pick a current or future date.</Text>}
      </View>

      {/* Preview — the outcome, not the row count (issue #182). A preview
          error doubles as this form's validation feedback: preview shares
          the exact resolver/span math the commit path uses, including the
          duplicate-name check (20260801_batch_duplicate_name_check.sql). */}
      <View className="bg-surface-background border border-surface-border rounded-2xl p-4 flex-row items-start gap-3">
        <FontAwesome name="magic" size={14} color={previewError ? c.danger : c.primary} style={{ marginTop: 2 }} />
        {previewLoading ? (
          <ActivityIndicator color={c.primary} />
        ) : previewError ? (
          <Text className="text-state-danger text-sm font-bold flex-1">{previewError}</Text>
        ) : preview ? (
          <Text className="text-typography-main text-sm font-bold flex-1">
            {preview.projects} project{preview.projects === 1 ? '' : 's'} · {preview.tasks} task{preview.tasks === 1 ? '' : 's'} · {preview.boards} board{preview.boards === 1 ? '' : 's'} · first task {fmtShort(preview.first_task_date)}, last {fmtShort(preview.last_task_date)}
          </Text>
        ) : (
          <Text className="text-typography-muted text-sm font-bold flex-1">Map every category and set a schedule anchor above to preview the outcome.</Text>
        )}
      </View>

      {error && <Text className="text-state-danger text-xs font-bold">{error}</Text>}
    </>
  );

  const categoryList = (
    loadingResources ? (
      <ActivityIndicator color={c.primary} />
    ) : (
      <View style={{ gap: 8 }}>
        {categories.map(cat => (
          <CategoryMappingRow
            key={cat}
            category={cat}
            value={mapping[cat] || { pipeline_id: null, assignee_team_id: null }}
            pipelines={pipelines}
            teams={teams}
            onChange={next => setMapping(prev => ({ ...prev, [cat]: next }))}
            c={c}
          />
        ))}
      </View>
    )
  );

  const projectsList = (
    <View style={{ gap: 6 }}>
      {pastLines.length > 0 && (
        <Text className="text-state-danger text-xs font-bold">
          Per-line override(s) in the past: {pastLines.map(p => p.name).join(', ')}. Fix on the previous step.
        </Text>
      )}
      {parsed.map((p, i) => {
        const isPast = !!p.start_date && p.start_date.slice(0, 10) < todayISO;
        return (
          <View
            key={`${p.raw}-${i}`}
            className={`bg-surface-background border rounded-xl px-3 py-2 ${isPast ? 'border-state-danger' : 'border-surface-border'}`}
          >
            <Text className="text-typography-main text-xs font-bold" numberOfLines={1}>{p.name}</Text>
            {(p.client_ref !== p.name || p.start_date || p.external_ref) && (
              <Text className={`text-[10px] mt-0.5 ${isPast ? 'text-state-danger' : 'text-typography-muted'}`} numberOfLines={1}>
                {p.client_ref !== p.name ? `${p.client_ref} · ` : ''}
                {p.start_date ? fmtShort(p.start_date) : ''}{p.start_date && p.external_ref ? ' · ' : ''}{p.external_ref || ''}
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );

  if (step === 'configure') {
    // ── Mobile (<768): drill-in, per .agents/rules/ux-consistency.md's
    // "mobile overflow" tiers. Page 1 is the schedule + preview (the form
    // the user is most likely editing) with a summary row that navigates to
    // a dedicated full-height category-mapping page — the list most likely
    // to be "dozens" long. The pasted project list itself isn't re-shown
    // here: it was just typed on the previous step and re-browsing it isn't
    // needed to finish configuring the batch, so skipping it avoids a second
    // long list competing for the same screen.
    if (!isDesktop) {
      return (
        <DraggableSheet
          visible={visible}
          onClose={onClose}
          dimBackdrop
          maxHeight="95%"
          dismissible={!creating}
          scrollable={false}
          containerClassName="rounded-t-[2rem] overflow-hidden"
        >
          <View style={{ flex: 1, minHeight: 0 }}>
            {mobilePage === 'schedule' ? (
              <>
                <View className="flex-row items-center justify-between px-5 pt-3 pb-4">
                  <View className="flex-1 mr-3">
                    <Text className="text-typography-muted text-[9px] font-black uppercase tracking-[0.3em] mb-1">Step 2 of 2</Text>
                    <Text className="text-typography-main text-xl font-black tracking-tight" numberOfLines={1}>Configure Batch</Text>
                  </View>
                  <TouchableOpacity onPress={onClose} disabled={creating} className="w-10 h-10 items-center justify-center rounded-full" style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border }}>
                    <FontAwesome name="times" size={16} color={c.textMain} />
                  </TouchableOpacity>
                </View>

                <ScrollView className="px-5" showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 16, paddingBottom: 20 }}>
                  <Text className="text-typography-muted text-xs">
                    "{selectedTemplate?.name}" · {categories.length} categor{categories.length === 1 ? 'y' : 'ies'} · {parsed.length} project{parsed.length === 1 ? '' : 's'} · {parsed.length * taskCountPerProject} tasks total.
                  </Text>

                  <TouchableOpacity
                    onPress={() => setMobilePage('categories')}
                    className="flex-row items-center justify-between p-4 rounded-2xl"
                    style={{ backgroundColor: c.card, borderWidth: 1, borderColor: mappedCount === categories.length ? c.border : c.danger, minHeight: 44 }}
                  >
                    <View className="flex-1 mr-3">
                      <Text className="text-typography-main font-black text-sm">Map Categories To Boards</Text>
                      <Text className="text-typography-muted text-[10px] font-bold mt-0.5">{mappedCount} of {categories.length} mapped</Text>
                    </View>
                    <FontAwesome name="chevron-right" size={14} color={c.textMuted} />
                  </TouchableOpacity>

                  {scheduleAndPreview}
                </ScrollView>

                <View className="flex-row gap-3 px-5 py-4" style={{ borderTopWidth: 1, borderTopColor: c.border }}>
                  <TouchableOpacity
                    onPress={() => setStep('setup')}
                    disabled={creating}
                    className="flex-1 py-3.5 rounded-2xl items-center"
                    style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border }}
                  >
                    <Text className="font-black uppercase tracking-widest text-xs" style={{ color: c.textMuted }}>Back</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleCreate}
                    disabled={!canCreate}
                    className="flex-[2] py-3.5 rounded-2xl items-center shadow-lg"
                    style={{ backgroundColor: canCreate ? c.primary : c.border }}
                  >
                    <Text className="font-black uppercase tracking-widest text-xs" style={{ color: canCreate ? 'white' : c.textMuted }}>
                      {creating ? 'Creating…' : `Create ${parsed.length} Project${parsed.length === 1 ? '' : 's'}`}
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                <View className="flex-row items-center px-3 pt-3 pb-3" style={{ borderBottomWidth: 1, borderBottomColor: c.border }}>
                  <TouchableOpacity onPress={() => setMobilePage('schedule')} className="w-10 h-10 items-center justify-center rounded-full mr-2" style={{ backgroundColor: c.background }}>
                    <FontAwesome name="chevron-left" size={14} color={c.textMain} />
                  </TouchableOpacity>
                  <View className="flex-1">
                    <Text className="text-typography-muted text-[9px] font-black uppercase tracking-[0.3em] mb-0.5">Configure Batch</Text>
                    <Text className="text-typography-main font-black text-base tracking-tight">Map Categories</Text>
                  </View>
                  <Text className="text-typography-muted text-[10px] font-black mr-1">{mappedCount}/{categories.length}</Text>
                </View>
                <ScrollView className="px-5 pt-4" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
                  {categoryList}
                </ScrollView>
              </>
            )}
          </View>
        </DraggableSheet>
      );
    }

    // ── Desktop (>=768): 3 peer columns, per ux-consistency.md's density
    // rule — projects (what's being created), category mapping (dozens of
    // rows in a large batch), and schedule + preview (the outcome). Each is
    // a plain flex-1 column with its own ScrollView so a long list in one
    // doesn't push the others out of view; maxWidth=1080 sits in the
    // documented 720-1100 info-dense range for 3 genuine peer groups.
    return (
      <Popup
        visible={visible}
        onClose={onClose}
        presentation="centered"
        title="Configure Batch"
        footer="dual-action"
        secondaryAction={{ label: 'Back', onPress: () => setStep('setup') }}
        primaryAction={{
          label: creating ? 'Creating…' : `Create ${parsed.length} Project${parsed.length === 1 ? '' : 's'}`,
          onPress: handleCreate,
          variant: canCreate ? 'default' : 'disabled',
        }}
        dismissible={!creating}
        maxWidth={1080}
        containerStyle={{ height: '86%' }}
      >
        <View style={{ flex: 1, minHeight: 0 }}>
          <View className="px-6 pt-4 pb-3">
            <Text className="text-typography-muted text-xs">
              "{selectedTemplate?.name}" · {categories.length} categor{categories.length === 1 ? 'y' : 'ies'} · {parsed.length * taskCountPerProject} tasks total.
            </Text>
          </View>

          <View className="px-6 pb-5" style={{ flexDirection: 'row', flex: 1, minHeight: 0, gap: 24 }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-2">Projects ({parsed.length})</Text>
              <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
                {projectsList}
              </ScrollView>
            </View>

            <View style={{ flex: 1, minWidth: 0 }}>
              <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-2">Map Each Category To A Board</Text>
              <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
                {categoryList}
              </ScrollView>
            </View>

            <View style={{ flex: 1, minWidth: 0 }}>
              <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 20, paddingBottom: 8 }}>
                {scheduleAndPreview}
              </ScrollView>
            </View>
          </View>
        </View>
      </Popup>
    );
  }

  return (
    <>
    <Popup
      visible={visible}
      onClose={onClose}
      presentation="auto"
      title="Bulk Create Projects"
      footer="single-action"
      primaryAction={{
        label: `Next: Configure Batch`,
        onPress: openConfigure,
        variant: canProceedToConfigure ? 'default' : 'disabled',
      }}
      dismissible={!creating}
      maxWidth={640}
    >
      {/*
        StarterTemplatePickerSheet is rendered as a return-level sibling below
        (not nested here, not via Popup's `overlays` prop) because this Popup
        uses presentation="auto" — on mobile web it resolves to `sheet`, and
        `overlays` is documented as centered-only (ignored in sheet mode), so
        putting it there would silently vanish on mobile. A plain sibling
        Modal-returning component works identically in both presentations.
      */}
      <View className="px-6 py-5" style={{ gap: 16 }}>
        {/* Template picker */}
        <View>
          <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-2">Template</Text>
          {loadingTemplates ? (
            <ActivityIndicator color={c.primary} />
          ) : templates.length === 0 ? (
            <View style={{ gap: 10 }}>
              <Text className="text-typography-muted text-sm">
                No templates yet. Start from a researched starter template below, or open a finished project and use "Save as Template".
              </Text>
              <TouchableOpacity
                onPress={() => setStarterPickerVisible(true)}
                className="self-start px-4 py-2.5 rounded-xl bg-brand-primary flex-row items-center gap-2"
                style={{ minHeight: 44 }}
              >
                <FontAwesome name="magic" size={12} color="white" />
                <Text className="text-white text-xs font-black uppercase tracking-wider">Browse Starter Templates</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View className="flex-row flex-wrap gap-2">
              {templates.map(t => (
                <TouchableOpacity
                  key={t.id}
                  onPress={() => setTemplateId(t.id)}
                  className={`px-4 py-2 rounded-xl border ${templateId === t.id ? 'bg-brand-primary border-brand-primary' : 'bg-surface-background border-surface-border'}`}
                  style={{ minHeight: 44, justifyContent: 'center' }}
                >
                  <Text className={`text-xs font-black uppercase tracking-wider ${templateId === t.id ? 'text-white' : 'text-typography-muted'}`}>
                    {t.name} · {t.body?.length || 0} tasks
                  </Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                onPress={() => setStarterPickerVisible(true)}
                className="px-4 py-2 rounded-xl border border-dashed border-surface-border flex-row items-center gap-1.5"
                style={{ minHeight: 44, justifyContent: 'center' }}
              >
                <FontAwesome name="plus" size={10} color={c.textMuted} />
                <Text className="text-typography-muted text-xs font-black uppercase tracking-wider">Starter</Text>
              </TouchableOpacity>
            </View>
          )}
          {selectedTemplate && taskCountPerProject === 0 && (
            <Text className="text-state-danger text-xs font-bold mt-2">This template has no tasks — pick another.</Text>
          )}
        </View>

        {/* Portfolio name (optional) */}
        <View>
          <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-2">Batch Name (optional)</Text>
          <TextInput
            value={portfolioName}
            onChangeText={setPortfolioName}
            placeholder="e.g. Office X — 2026 Intake"
            placeholderTextColor={c.textDim}
            className="bg-surface-background border border-surface-border rounded-lg px-4 py-3"
            style={{ color: c.textMain }}
          />
        </View>

        {/* Textarea — one project per line. Replaced by a read-only review
            list when rows arrived pre-filled from spreadsheet intake (issue
            #188): those rows were already mapped + client-resolved upstream,
            so re-exposing them as free text would let a stray edit silently
            diverge from what the user already confirmed there. */}
        {initialRows ? (
          <View>
            <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-2">
              Projects — {initialRows.length} imported from {initialSource?.replace(/^spreadsheet:/, '') || 'spreadsheet'}
            </Text>
            <ScrollView
              style={{ maxHeight: 220 }}
              showsVerticalScrollIndicator={false}
              className="bg-surface-background border border-surface-border rounded-lg"
              contentContainerStyle={{ padding: 8, gap: 6 }}
            >
              {parsed.map((p, i) => (
                <View key={`${p.raw}-${i}`} className="px-2 py-1.5 rounded-lg">
                  <Text className="text-typography-main text-xs font-bold" numberOfLines={1}>{p.name}</Text>
                  <Text className="text-typography-muted text-[10px]" numberOfLines={1}>
                    {p.client_ref !== p.name ? `Client: ${p.client_ref} · ` : ''}
                    {p.start_date ? fmtShort(p.start_date) : 'no start date'}{p.external_ref ? ` · ${p.external_ref}` : ''}
                  </Text>
                </View>
              ))}
            </ScrollView>
            {pastLines.length > 0 && (
              <Text className="text-state-danger text-xs font-bold mt-2">
                In the past: {pastLines.map(p => p.name).join(', ')}. Fix the date on the previous step to continue.
              </Text>
            )}
          </View>
        ) : (
          <View>
            <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-2">
              Projects — one per line, optionally "Name, 2026-08-01, ref"
            </Text>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder={'Abdallah Group\nCentro Trading, 2026-08-15, CR-4471\nNorthgate LLC, , NG-002'}
              placeholderTextColor={c.textDim}
              multiline
              numberOfLines={8}
              textAlignVertical="top"
              className="bg-surface-background border border-surface-border rounded-lg px-4 py-3"
              style={{ color: c.textMain, minHeight: 160 }}
            />
            {pastLines.length > 0 && (
              <Text className="text-state-danger text-xs font-bold mt-2">
                Line date in the past: {pastLines.map(p => p.name).join(', ')}. Remove or fix the date to continue.
              </Text>
            )}
          </View>
        )}

        {/* Row count is a real number here (how much you're about to type into
            the next step), not the outcome preview — that lives in step 2
            once boards/dates are known, per issue #182's framing. */}
        {selectedTemplate && (
          <View className="bg-surface-background border border-surface-border rounded-2xl p-4 flex-row items-center gap-3">
            <FontAwesome name="magic" size={14} color={c.primary} />
            <Text className="text-typography-main text-sm font-bold flex-1">
              {parsed.length === 0
                ? 'Paste project names above, then configure boards and a schedule on the next step.'
                : `${parsed.length} project${parsed.length === 1 ? '' : 's'} · ${parsed.length * taskCountPerProject} task${parsed.length * taskCountPerProject === 1 ? '' : 's'} pending board + schedule configuration.`}
            </Text>
          </View>
        )}

        {error && <Text className="text-state-danger text-xs font-bold">{error}</Text>}
      </View>
    </Popup>

    <StarterTemplatePickerSheet
      visible={starterPickerVisible}
      onClose={() => setStarterPickerVisible(false)}
      onCreated={(t) => {
        setTemplates(prev => [...prev, t]);
        setTemplateId(t.id);
      }}
    />
    </>
  );
}
