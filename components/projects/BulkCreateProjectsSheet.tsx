import Calendar from '@/components/common/Calendar';
import DraggableSheet from '@/components/common/DraggableSheet';
import Popup from '@/components/common/Popup';
import CategoryMappingRow, { type CategoryValue, type Pipeline, type Team } from '@/components/projects/CategoryMappingRow';
import StarterTemplatePickerSheet from '@/components/projects/StarterTemplatePickerSheet';
import { useAuth } from '@/contexts/AuthContext';
import { useUploadManager } from '@/contexts/UploadManagerContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { getQuickActionDate } from '@/lib/calendarPicker';
import { batchOffsetRange, batchSpan, isoDay, sampleProjectSchedule } from '@/lib/imports/importPlan';
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
/**
 * `2026-02-08` -> "Feb 8", in the LOCAL calendar, from the date parts only.
 *
 * `new Date('2026-02-08')` is UTC midnight, and `toLocaleDateString` then
 * renders it in the viewer's timezone — so every date in this list showed a
 * day early anywhere west of Greenwich. Same family as §19.4: a date that is
 * correct all the way through the parser and wrong at the last hop. Splitting
 * the parts and building a local Date removes the timezone from the question
 * entirely. Accepts a full ISO timestamp too (the preview RPC returns
 * timestamptz) — only the calendar day is ever wanted here.
 */
function fmtShort(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return '—';
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

type Template = { id: string; name: string; body: any[] };
// Pipeline / Team / CategoryValue now live with CategoryMappingRow (#198) —
// the picker and the shapes it maps are one thing, and the Assignments tab
// needs both. Re-exported nowhere: import them from the component.
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

// ─── The spine and the blocker list (plan §19.2/§19.3) ──────────────────────
//
// Both live here rather than in components/common because they are this
// journey's furniture, and both are consumed by SpreadsheetImportSheet, which
// already imports this file. One definition, two call sites, no new module.

/**
 * Where am I, and what is left. Import -> Review -> Clients -> Configure is
 * four decisions deep and every screen used to announce itself as "Step N of
 * 2" against a different N — a map that contradicted itself at every stop.
 *
 * Desktop gets the whole path so the remaining steps are visible; below 768 it
 * degrades to the position plus the current label, because five chips at 390px
 * is a wrapped mess that says less than one sentence does.
 */
export function StepSpine({
  steps, current, isDesktop, c,
}: {
  steps: string[];
  /** zero-based */
  current: number;
  isDesktop: boolean;
  c: ReturnType<typeof useThemeColors>;
}) {
  if (!isDesktop) {
    return (
      <View style={{ gap: 6 }}>
        <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.3em]">
          Step {current + 1} of {steps.length} · {steps[current]}
        </Text>
        <View className="flex-row" style={{ gap: 3 }}>
          {steps.map((s, i) => (
            <View key={s} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: i <= current ? c.primary : c.border }} />
          ))}
        </View>
      </View>
    );
  }
  return (
    <View className="flex-row items-center flex-wrap" style={{ gap: 6 }}>
      {steps.map((s, i) => (
        <React.Fragment key={s}>
          {i > 0 && <FontAwesome name="chevron-right" size={11} color={c.textDim} />}
          <View
            className="px-2 py-1 rounded-lg flex-row items-center"
            style={{ gap: 5, backgroundColor: i === current ? `${c.primary}1f` : 'transparent' }}
          >
            <Text
              className="text-[10px] font-black"
              style={{ color: i < current ? c.success : i === current ? c.primary : c.textDim }}
            >
              {i < current ? '✓' : i + 1}
            </Text>
            <Text
              className="text-[11px] font-black uppercase tracking-wider"
              style={{ color: i === current ? c.primary : i < current ? c.textMuted : c.textDim }}
            >
              {s}
            </Text>
          </View>
        </React.Fragment>
      ))}
    </View>
  );
}

/**
 * One reason the primary button is disabled: the field, why, and the control
 * that fixes it.
 *
 * `action` is not decoration — §19.1's rule is that the remedy must be
 * reachable from where the message appears, and on a drill-in layout the
 * control is often on another page. That is what `action` is for: it navigates
 * to it. A blocker whose remedy is already on screen leaves it undefined and
 * says where to look instead.
 */
export type Blocker = { field: string; reason: string; action?: { label: string; onPress: () => void } };

/** A disabled primary must always be able to say why (§19.3 #2). */
export function BlockerList({ blockers, c }: { blockers: Blocker[]; c: ReturnType<typeof useThemeColors> }) {
  if (blockers.length === 0) return null;
  return (
    <View className="rounded-2xl p-3" style={{ backgroundColor: `${c.warning}14`, borderWidth: 1, borderColor: c.warning, gap: 6 }}>
      <Text className="text-[11px] font-black uppercase tracking-widest" style={{ color: c.warning }}>
        {blockers.length} thing{blockers.length === 1 ? '' : 's'} still needed
      </Text>
      {blockers.map(b => (
        <View key={b.field} className="flex-row items-start flex-wrap" style={{ gap: 6 }}>
          <Text className="text-typography-main text-[12px]" style={{ flexGrow: 1, flexBasis: 200 }}>
            <Text className="font-black">{b.field}: </Text>{b.reason}
          </Text>
          {b.action && (
            <TouchableOpacity
              onPress={b.action.onPress}
              className="px-3 rounded-lg"
              style={{ minHeight: 36, justifyContent: 'center', backgroundColor: c.background, borderWidth: 1, borderColor: c.primary }}
            >
              <Text className="text-[12px] font-bold" style={{ color: c.primary }}>{b.action.label}</Text>
            </TouchableOpacity>
          )}
        </View>
      ))}
    </View>
  );
}

/** Vocabulary defined where it is used, not in a docs link (§19.3 #3). The
 *  four terms this flow invents — category, board, schedule anchor, batch —
 *  each get one plain sentence next to the control that uses them. */
export function Hint({ children }: { children: React.ReactNode }) {
  return <Text className="text-typography-dim text-[11px] leading-4">{children}</Text>;
}

/**
 * The whole journey, in the order the user walks it, shared by
 * SpreadsheetImportSheet (steps 0-2) and this file (steps 3-4).
 *
 * Before this existed each screen numbered itself independently and the user
 * was told "Step 1 of 2", then "Step 2 of 2", then "Step 2 of 2" again on a
 * different sheet — three screens claiming to be the end of a two-step
 * process. One array, imported by both, cannot drift.
 */
export const IMPORT_JOURNEY_STEPS = ['File', 'Columns', 'Clients', 'Template', 'Schedule'];
/** The standalone paste-a-list path is genuinely two steps; it does not
 *  pretend to be part of the import journey. */
export const BULK_CREATE_STEPS = ['Projects', 'Schedule'];

type PastDatePolicy = 'undecided' | 'keep' | 'clear';

/**
 * Past start dates are a CHOICE, not an error (a2c269f, plan §19.1).
 *
 * Every step that notices past dates renders THIS, so the remedy travels with
 * the message. The original copy — "In the past: <names>. Fix the date on the
 * previous step." on setup, "Per-line override(s) in the past ... Fix on the
 * previous step." on configure — pointed at an editor that does not exist for
 * imported rows, and configure pointed BACKWARDS at a question the user had
 * already answered. §19.1's rule: name the field, the reason and the remedy,
 * and the remedy must be reachable from where the message appears. The toggle
 * below is that remedy, in place, on whichever step you are standing on.
 */
function PastDatesNotice({
  lines, policy, onPolicy, source, c,
}: {
  /** ALWAYS the raw lines, before the policy is applied — see below. */
  lines: ParsedLine[];
  policy: PastDatePolicy;
  onPolicy: (p: PastDatePolicy) => void;
  source: string;
  c: ReturnType<typeof useThemeColors>;
}) {
  // The caller passes the PRE-policy lines on purpose. Passing the post-policy
  // ones (what it did before) meant choosing "Clear them" emptied the list,
  // which unmounted this notice and took the only control that could undo it
  // with it — a one-way trapdoor, the same shape of dead end as the message
  // this component was written to replace.
  if (lines.length === 0) return null;
  const n = lines.length;
  const range = `${fmtShort(lines[0].start_date)}${n > 1 ? ` – ${fmtShort(lines[n - 1].start_date)}` : ''}`;
  return (
    <View className="mt-3 p-3 rounded-xl border" style={{ borderColor: c.warning, backgroundColor: c.warning + '22' }}>
      <Text className="text-typography-main text-[13px] font-black mb-1">
        {policy === 'keep' ? `Keeping ${n} start date${n === 1 ? '' : 's'} from before today`
          : policy === 'clear' ? `Clearing ${n} start date${n === 1 ? '' : 's'} from before today`
          : `${n} project${n === 1 ? ' has a start date' : 's have start dates'} before today`}
      </Text>
      <Text className="text-typography-muted text-[12px] leading-4 mb-2">
        {range} {source}. That is normal when importing an existing portfolio — the rows are marked below.
        Keep them to record work that already happened, or clear them and let this batch&apos;s schedule set the dates instead.
      </Text>
      <View className="flex-row items-center gap-2 flex-wrap">
        {([['keep', 'Keep these dates'], ['clear', 'Clear them']] as const).map(([value, label]) => (
          <TouchableOpacity
            key={value}
            onPress={() => onPolicy(value)}
            className={`px-3 py-2 justify-center rounded-lg border ${policy === value ? 'border-brand-primary bg-brand-primary/10' : 'border-surface-border'}`}
            style={{ minHeight: 44 }}
          >
            <Text className={`text-[12px] font-black uppercase tracking-wider ${policy === value ? 'text-brand-primary' : 'text-typography-muted'}`}>
              {label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

export default function BulkCreateProjectsSheet({
  visible, onClose, onCreated,
  initialRows, initialPortfolioName, initialSource, initialIdempotencyKey, initialSourceFile,
  portfolioId,
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
  // Append this batch's projects to an EXISTING portfolio instead of
  // creating a new one — set when opened from the portfolio-scoped Projects
  // screen. The batch-name field below makes no sense here (the portfolio
  // already has a name), so it's hidden rather than ignored.
  portfolioId?: string;
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
  // Past start dates are normal for a spreadsheet import — you import LAST
  // year's register, so every dated row is behind today. The original rule
  // hard-blocked on any past date and told the user to "fix the date on the
  // previous step", which for imported rows does not exist: there is no
  // per-row date editor upstream, so the import became unreachable with no
  // remedy. Now the user chooses, and the choice is remembered for the batch.
  //   'keep'  — import the historical dates as written (an archive import)
  //   'clear' — drop them; the batch schedule anchor supplies dates instead
  const [pastDatePolicy, setPastDatePolicy] = useState<PastDatePolicy>('undecided');

  const parsedRaw = useMemo(() => initialRows ?? parseLines(text), [initialRows, text]);
  const parsed = useMemo(
    () => (pastDatePolicy === 'clear'
      ? parsedRaw.map(p => (p.start_date && p.start_date.slice(0, 10) < todayISO ? { ...p, start_date: null } : p))
      : parsedRaw),
    [parsedRaw, pastDatePolicy, todayISO],
  );
  const taskCountPerProject = selectedTemplate?.body?.length || 0;
  // PRE-policy: the rows that HAVE a past date in the source, regardless of
  // what the user has since chosen to do with them. The notice needs this or
  // "Clear them" removes its own undo (see PastDatesNotice).
  const pastLinesRaw = useMemo(() => parsedRaw.filter(p => p.start_date && p.start_date.slice(0, 10) < todayISO), [parsedRaw, todayISO]);
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
  const unmappedCategories = useMemo(() => categories.filter(cat => !mapping[cat]?.pipeline_id), [categories, mapping]);
  const anchorIsPast = !!anchorDate && anchorDate < todayISO;
  const anchorReady = !!anchorDate && !!anchorDirection && !anchorIsPast;

  const canProceedToConfigure =
    !!templateId && taskCountPerProject > 0 && parsed.length > 0
    && (pastLinesRaw.length === 0 || pastDatePolicy !== 'undecided');

  // Every reason the primary is disabled, named, with the control that fixes
  // it (§19.1/§19.3 #2). Order matches the order the fields appear on screen.
  const setupBlockers = useMemo<Blocker[]>(() => {
    const out: Blocker[] = [];
    if (!templateId) {
      out.push({ field: 'Template', reason: 'None picked yet — choose one above, or add a starter template.' });
    } else if (taskCountPerProject === 0) {
      out.push({ field: 'Template', reason: `"${selectedTemplate?.name}" has no tasks in it, so there would be nothing to create. Pick another above.` });
    }
    if (parsed.length === 0) {
      out.push({
        field: 'Projects',
        reason: initialRows
          ? 'Every imported row was excluded. Go back and include at least one.'
          : 'The list is empty — type one project name per line above.',
      });
    }
    if (pastLinesRaw.length > 0 && pastDatePolicy === 'undecided') {
      out.push({
        field: 'Start dates',
        reason: `${pastLinesRaw.length} row${pastLinesRaw.length === 1 ? ' starts' : 's start'} before today — choose Keep or Clear above. Either answer continues.`,
      });
    }
    return out;
  }, [templateId, taskCountPerProject, selectedTemplate, parsed.length, initialRows, pastLinesRaw.length, pastDatePolicy]);

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

  const configureBlockers = useMemo<Blocker[]>(() => {
    const out: Blocker[] = [];
    if (unmappedCategories.length > 0) {
      const named = unmappedCategories.slice(0, 3).map(cat => cat || 'Uncategorized').join(', ');
      out.push({
        field: 'Boards',
        reason: `${unmappedCategories.length} of ${categories.length} categor${categories.length === 1 ? 'y' : 'ies'} still need a board — ${named}${unmappedCategories.length > 3 ? `, +${unmappedCategories.length - 3} more` : ''}.`,
        // On the mobile drill-in the pickers are on another page, so the
        // message carries the way to them rather than describing where they are.
        action: !isDesktop && mobilePage !== 'categories'
          ? { label: 'Map them', onPress: () => setMobilePage('categories') }
          : undefined,
      });
    }
    if (!anchorDirection) out.push({ field: 'Schedule', reason: 'Say whether the date below is the deadline (Due by) or the start (Starts on).' });
    if (!anchorDate) out.push({ field: 'Schedule date', reason: 'No date picked yet — use a preset or the calendar below.' });
    else if (anchorIsPast) out.push({ field: 'Schedule date', reason: `${anchorDate} has already passed. The batch anchor has to be today or later — pick another below.` });
    if (previewError) out.push({ field: 'Checked against your workspace', reason: previewError });
    return out;
  }, [unmappedCategories, categories.length, anchorDirection, anchorDate, anchorIsPast, previewError, isDesktop, mobilePage]);

  // ── The outcome, before committing (§19.2 "no preview of the outcome") ─────
  // "294 tasks" is not something a user can judge. One project worked out in
  // full is. Computed by importPlan.ts's mirror of the RPC's own arithmetic,
  // and only shown when its batch-wide span agrees with the span the SERVER
  // just returned — a disagreement hides the sample rather than showing a
  // confident wrong date (which is the §19.4 bug's whole family).
  const sample = useMemo(() => {
    if (!preview || !anchorDate || !anchorDirection || !selectedTemplate?.body?.length || parsed.length === 0) return null;
    const body = selectedTemplate.body as { title?: string; category?: string; due_offset_days?: number | null }[];
    const mine = batchSpan(body, anchorDate, anchorDirection, parsed.map(p => (p.start_date ? isoDay(p.start_date) : null)));
    const serverFirst = preview.first_task_date ? isoDay(preview.first_task_date) : null;
    const serverLast = preview.last_task_date ? isoDay(preview.last_task_date) : null;
    if (!mine || mine.firstDay !== serverFirst || mine.lastDay !== serverLast) return null;
    const first = parsed[0];
    return {
      name: first.name,
      tasks: sampleProjectSchedule(body, anchorDate, anchorDirection, first.start_date ? isoDay(first.start_date) : null),
    };
  }, [preview, anchorDate, anchorDirection, selectedTemplate, parsed]);

  const spanDays = useMemo(() => {
    const r = batchOffsetRange((selectedTemplate?.body ?? []) as { due_offset_days?: number | null }[]);
    return r.max - r.min;
  }, [selectedTemplate]);

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

    // No standing folder when appending to an existing portfolio — the RPC
    // leaves that portfolio's own standing_folder_id untouched on append, so
    // creating one here would just orphan it (nothing would ever point back
    // at it).
    const standingFolderId = initialSourceFile && !portfolioId ? await getOrCreateStandingFolder() : null;

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
      p_existing_portfolio_id: portfolioId ?? null,
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

  // Where the user is in the WHOLE journey, not in this sheet (§19.2 "no map").
  const spineSteps = initialRows ? IMPORT_JOURNEY_STEPS : BULK_CREATE_STEPS;
  const spineIndex = initialRows ? (step === 'setup' ? 3 : 4) : (step === 'setup' ? 0 : 1);
  const spine = <StepSpine steps={spineSteps} current={spineIndex} isDesktop={isDesktop} c={c} />;

  // ─── Shared "configure" step content — desktop columns and the mobile
  // "schedule" page render the identical schedule/preview UI; only the
  // wrapping (ScrollView column vs full sheet page) differs. ───────────────
  const scheduleAndPreview = (
    <>
      <View style={{ gap: 8 }}>
        <Text className="text-typography-label text-[11px] font-black uppercase tracking-widest">Schedule anchor</Text>
        <Hint>
          One date for the whole batch. Every task in every project is counted from it — the template spreads its{' '}
          {taskCountPerProject} task{taskCountPerProject === 1 ? '' : 's'} over {spanDays} day{spanDays === 1 ? '' : 's'}.
          A project that brought its own date from the spreadsheet uses that instead, read the same way.
        </Hint>

        {/* Back-scheduling (deadline) listed first — this domain typically
            receives a deadline ("six months to complete them"), not a
            start date (issue #182), so it must not read as the secondary
            option.

            The sub-copy used to read "Tasks are due on their researched
            offset from this date", which names a concept the user has never
            met and states no consequence. Both options now say what happens
            to the date they are about to pick, in days (§19.2). */}
        <Text className="text-typography-main text-[12px] font-bold">Is that date the deadline, or the start?</Text>
        <View className="flex-row gap-2">
          <TouchableOpacity
            onPress={() => setAnchorDirection('deadline')}
            className={`flex-1 rounded-xl border px-3 py-2 justify-center ${anchorDirection === 'deadline' ? 'bg-brand-primary border-brand-primary' : 'bg-surface-background border-surface-border'}`}
            style={{ minHeight: 44 }}
          >
            <Text className={`text-[13px] font-black uppercase tracking-wider ${anchorDirection === 'deadline' ? 'text-white' : 'text-typography-main'}`}>Due by</Text>
            <Text className={`text-[11px] mt-0.5 ${anchorDirection === 'deadline' ? 'text-white/80' : 'text-typography-muted'}`}>
              The LAST task is due that day. Work starts {spanDays} day{spanDays === 1 ? '' : 's'} earlier.
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setAnchorDirection('start')}
            className={`flex-1 rounded-xl border px-3 py-2 justify-center ${anchorDirection === 'start' ? 'bg-brand-primary border-brand-primary' : 'bg-surface-background border-surface-border'}`}
            style={{ minHeight: 44 }}
          >
            <Text className={`text-[13px] font-black uppercase tracking-wider ${anchorDirection === 'start' ? 'text-white' : 'text-typography-main'}`}>Starts on</Text>
            <Text className={`text-[11px] mt-0.5 ${anchorDirection === 'start' ? 'text-white/80' : 'text-typography-muted'}`}>
              The FIRST task begins that day. The last is due {spanDays} day{spanDays === 1 ? '' : 's'} later.
            </Text>
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
              <Text className={`text-[11px] font-black uppercase tracking-wider ${anchorDate === preset.date ? 'text-white' : 'text-typography-muted'}`}>{preset.label}</Text>
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
        {anchorIsPast && <Text className="text-state-danger text-[13px] font-bold">{anchorDate} is in the past — pick a current or future date.</Text>}
      </View>

      {/* Preview — the outcome, not the row count (issue #182). A preview
          error doubles as this form's validation feedback: preview shares
          the exact resolver/span math the commit path uses, including the
          duplicate-name check (20260801_batch_duplicate_name_check.sql).

          A preview ERROR is now also a blocker (configureBlockers), so it is
          stated once as a reason the button is off rather than twice in two
          idioms — §19.2's complaint about the past-date paragraph. */}
      <View style={{ gap: 8 }}>
        <Text className="text-typography-label text-[11px] font-black uppercase tracking-widest">What you will get</Text>
        <View className="bg-surface-background border border-surface-border rounded-2xl p-4" style={{ gap: 10 }}>
          <View className="flex-row items-start gap-3">
            <FontAwesome name="magic" size={14} color={previewError ? c.danger : c.primary} style={{ marginTop: 2 }} />
            {previewLoading ? (
              <ActivityIndicator color={c.primary} />
            ) : preview && !previewError ? (
              <Text className="text-typography-main text-sm font-bold flex-1">
                {preview.projects} project{preview.projects === 1 ? '' : 's'} · {preview.tasks} task{preview.tasks === 1 ? '' : 's'} · {preview.boards} board{preview.boards === 1 ? '' : 's'}
                {'\n'}
                <Text className="font-normal text-typography-muted">
                  First task {fmtShort(preview.first_task_date)}, last {fmtShort(preview.last_task_date)}.
                </Text>
              </Text>
            ) : (
              <Text className="text-typography-muted text-sm font-bold flex-1">
                Fill in the boards and the schedule and this will show exactly what gets created — before anything is.
              </Text>
            )}
          </View>

          {/* One project worked out in full. 294 is not a number anyone can
              check; "JREIJ: Planning Feb 3 → Filing Mar 9" is. */}
          {sample && (
            <View style={{ gap: 4, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 10 }}>
              <Text className="text-typography-dim text-[11px] font-black uppercase tracking-wider">
                For example, “{sample.name}” gets
              </Text>
              {sample.tasks.slice(0, 6).map((t, i) => (
                <View key={`${t.title}-${i}`} className="flex-row items-center" style={{ gap: 8 }}>
                  <Text className="text-typography-main text-[12px] flex-1" numberOfLines={1}>{t.title}</Text>
                  {!!t.category && <Text className="text-typography-dim text-[11px]" numberOfLines={1}>{t.category}</Text>}
                  <Text className="text-typography-muted text-[12px] font-bold" style={{ width: 62, textAlign: 'right' }}>
                    {fmtShort(t.dueDay)}
                  </Text>
                </View>
              ))}
              {sample.tasks.length > 6 && (
                <Text className="text-typography-dim text-[11px]">
                  +{sample.tasks.length - 6} more, through {fmtShort(sample.tasks[sample.tasks.length - 1].dueDay)}
                </Text>
              )}
            </View>
          )}
        </View>
      </View>

      <BlockerList blockers={configureBlockers} c={c} />

      {error && <Text className="text-state-danger text-[13px] font-bold">{error}</Text>}
    </>
  );

  const categoryList = (
    loadingResources ? (
      <ActivityIndicator color={c.primary} />
    ) : (
      <View style={{ gap: 8 }}>
        {/* §19.3 #3 — "category" and "board" are this flow's words, not the
            user's, and §17 already found that portfolio/project/pipeline/task
            are not distinguishable either. Defined here, next to the control,
            not in a docs link. */}
        <Hint>
          A <Text className="font-black">category</Text> is a label the template puts on its tasks — Fieldwork,
          Review, Filing. A <Text className="font-black">board</Text> is the kanban those tasks appear on once they
          exist. Answer once per category and every project in the batch follows it.
        </Hint>
        {categories.map(cat => (
          <CategoryMappingRow
            key={cat}
            category={cat}
            value={mapping[cat] || { pipeline_id: null, assignee_team_id: null }}
            pipelines={pipelines}
            teams={teams}
            onChange={next => setMapping(prev => ({ ...prev, [cat]: next }))}
          />
        ))}
      </View>
    )
  );

  const projectsList = (
    <View style={{ gap: 6 }}>
      {/* Same notice, same toggle — NOT a pointer back to the previous step.
          By here the user has already answered "keep"; repeating it as red
          text re-opened a settled question and offered no way to change the
          answer without going back. The remedy is the toggle itself. */}
      <PastDatesNotice
        lines={pastLinesRaw} policy={pastDatePolicy} onPolicy={setPastDatePolicy} c={c}
        source={initialRows ? 'from your spreadsheet' : 'in this batch'}
      />
      {parsed.map((p, i) => {
        // §19.2: the past-date rows used to be named in a paragraph above AND
        // outlined in colour below — the same fact twice, in two idioms,
        // neither of which said what would happen. Now the row states its own
        // outcome once, in words: kept as written, or cleared and following
        // the batch anchor. The paragraph above holds the CHOICE, which is
        // batch-wide and genuinely does not belong per-row.
        const rawPast = !!parsedRaw[i]?.start_date && isoDay(parsedRaw[i].start_date as string) < todayISO;
        const cleared = rawPast && !p.start_date;
        return (
          <View
            key={`${p.raw}-${i}`}
            className="bg-surface-background border border-surface-border rounded-xl px-3 py-2"
          >
            <Text className="text-typography-main text-[13px] font-bold" numberOfLines={1}>{p.name}</Text>
            {(p.client_ref !== p.name || p.start_date || p.external_ref || rawPast) && (
              <Text className="text-[11px] mt-0.5 text-typography-muted" numberOfLines={1}>
                {p.client_ref !== p.name ? `${p.client_ref} · ` : ''}
                {p.start_date ? fmtShort(p.start_date) : ''}{p.start_date && p.external_ref ? ' · ' : ''}{p.external_ref || ''}
              </Text>
            )}
            {rawPast && (
              <Text className="text-[11px] mt-0.5 font-bold" style={{ color: cleared ? c.textDim : c.warning }} numberOfLines={1}>
                {cleared
                  ? `${fmtShort(parsedRaw[i].start_date)} cleared — follows the batch anchor`
                  : `Starts ${fmtShort(p.start_date)}, before today — kept as written`}
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
                  <View className="flex-1 mr-3" style={{ gap: 6 }}>
                    {spine}
                    <Text className="text-typography-main text-xl font-black tracking-tight" numberOfLines={1}>Boards &amp; Schedule</Text>
                  </View>
                  <TouchableOpacity onPress={onClose} disabled={creating} className="w-10 h-10 items-center justify-center rounded-full" style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border }}>
                    <FontAwesome name="times" size={16} color={c.textMain} />
                  </TouchableOpacity>
                </View>

                <ScrollView className="px-5" showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 16, paddingBottom: 20 }}>
                  <Text className="text-typography-muted text-[13px]">
                    "{selectedTemplate?.name}" · {categories.length} categor{categories.length === 1 ? 'y' : 'ies'} · {parsed.length} project{parsed.length === 1 ? '' : 's'} · {parsed.length * taskCountPerProject} tasks total.
                  </Text>

                  <TouchableOpacity
                    onPress={() => setMobilePage('categories')}
                    className="flex-row items-center justify-between p-4 rounded-2xl"
                    style={{ backgroundColor: c.card, borderWidth: 1, borderColor: mappedCount === categories.length ? c.border : c.warning, minHeight: 44 }}
                  >
                    <View className="flex-1 mr-3">
                      <Text className="text-typography-main font-black text-sm">Which board does each category go to?</Text>
                      <Text className="text-typography-muted text-[11px] font-bold mt-0.5">
                        {mappedCount} of {categories.length} answered
                        {unmappedCategories.length > 0 ? ` · still need ${unmappedCategories.slice(0, 2).map(cat => cat || 'Uncategorized').join(', ')}${unmappedCategories.length > 2 ? '…' : ''}` : ''}
                      </Text>
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
                    <Text className="font-black uppercase tracking-widest text-[13px]" style={{ color: c.textMuted }}>Back</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleCreate}
                    disabled={!canCreate}
                    className="flex-[2] py-3.5 rounded-2xl items-center shadow-lg"
                    style={{ backgroundColor: canCreate ? c.primary : c.border }}
                  >
                    <Text className="font-black uppercase tracking-widest text-[13px]" style={{ color: canCreate ? 'white' : c.textMuted }}>
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
                    <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.3em] mb-0.5">Boards &amp; Schedule</Text>
                    <Text className="text-typography-main font-black text-base tracking-tight" numberOfLines={1}>Category → Board</Text>
                  </View>
                  <Text className="text-typography-muted text-[11px] font-black mr-1">{mappedCount}/{categories.length}</Text>
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
        maxWidth={1320}
        containerStyle={{ height: '86%' }}
      >
        <View style={{ flex: 1, minHeight: 0 }}>
          <View className="px-6 pt-4 pb-3" style={{ gap: 6 }}>
            {spine}
            <Text className="text-typography-muted text-[13px]">
              "{selectedTemplate?.name}" · {categories.length} categor{categories.length === 1 ? 'y' : 'ies'} · {parsed.length * taskCountPerProject} tasks total.
              Nothing is created until you press Create.
            </Text>
          </View>

          <View className="px-6 pb-5" style={{ flexDirection: 'row', flex: 1, minHeight: 0, gap: 24 }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text className="text-typography-label text-[11px] font-black uppercase tracking-widest mb-2">Projects ({parsed.length})</Text>
              <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
                {projectsList}
              </ScrollView>
            </View>

            <View style={{ flex: 1, minWidth: 0 }}>
              <Text className="text-typography-label text-[11px] font-black uppercase tracking-widest mb-2">
                Which board does each category go to? ({mappedCount}/{categories.length})
              </Text>
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
      title={initialRows ? 'Pick The Template' : 'Bulk Create Projects'}
      footer="single-action"
      primaryAction={{
        label: 'Next: Boards & Schedule',
        onPress: openConfigure,
        variant: canProceedToConfigure ? 'default' : 'disabled',
      }}
      dismissible={!creating}
      maxWidth={860}
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
        {spine}

        {/* Template picker */}
        <View>
          <Text className="text-typography-label text-[11px] font-black uppercase tracking-widest mb-2">Template</Text>
          <View className="mb-2">
            <Hint>
              A <Text className="font-black">template</Text> is the task list every project in this batch gets a copy
              of. Pick it once here; the next step decides which boards those tasks land on and when they are due.
            </Hint>
          </View>
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
                <Text className="text-white text-[13px] font-black uppercase tracking-wider">Browse Starter Templates</Text>
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
                  <Text className={`text-[13px] font-black uppercase tracking-wider ${templateId === t.id ? 'text-white' : 'text-typography-muted'}`}>
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
                <Text className="text-typography-muted text-[13px] font-black uppercase tracking-wider">Starter</Text>
              </TouchableOpacity>
            </View>
          )}
          {selectedTemplate && taskCountPerProject === 0 && (
            <Text className="text-state-danger text-[13px] font-bold mt-2">This template has no tasks — pick another.</Text>
          )}
        </View>

        {/* Portfolio name (optional) — hidden when appending to an existing
            portfolio, since that portfolio already has a name and this
            batch isn't the one that gets to rename it. */}
        {!portfolioId && (
          <View>
            <Text className="text-typography-label text-[11px] font-black uppercase tracking-widest mb-2">Batch Name (optional)</Text>
            <View className="mb-2">
              <Hint>
                The <Text className="font-black">batch</Text> is everything created by this one import, kept together so
                it can be undone in a single click later.
              </Hint>
            </View>
            <TextInput
              value={portfolioName}
              onChangeText={setPortfolioName}
              placeholder="e.g. Office X — 2026 Intake"
              placeholderTextColor={c.textDim}
              className="bg-surface-background border border-surface-border rounded-lg px-4 py-3"
              style={{ color: c.textMain }}
            />
          </View>
        )}

        {/* Textarea — one project per line. Replaced by a read-only review
            list when rows arrived pre-filled from spreadsheet intake (issue
            #188): those rows were already mapped + client-resolved upstream,
            so re-exposing them as free text would let a stray edit silently
            diverge from what the user already confirmed there. */}
        {initialRows ? (
          <View>
            <Text className="text-typography-label text-[11px] font-black uppercase tracking-widest mb-2">
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
                  <Text className="text-typography-main text-[13px] font-bold" numberOfLines={1}>{p.name}</Text>
                  <Text className="text-typography-muted text-[11px]" numberOfLines={1}>
                    {p.client_ref !== p.name ? `Client: ${p.client_ref} · ` : ''}
                    {p.start_date ? fmtShort(p.start_date) : 'no start date'}{p.external_ref ? ` · ${p.external_ref}` : ''}
                  </Text>
                </View>
              ))}
            </ScrollView>
            <PastDatesNotice
              lines={pastLinesRaw} policy={pastDatePolicy} onPolicy={setPastDatePolicy} c={c}
              source="from your spreadsheet"
            />
          </View>
        ) : (
          <View>
            <Text className="text-typography-label text-[11px] font-black uppercase tracking-widest mb-2">
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
            <PastDatesNotice
              lines={pastLinesRaw} policy={pastDatePolicy} onPolicy={setPastDatePolicy} c={c}
              source="in the list above"
            />
          </View>
        )}

        {/* Row count is a real number here (how much you're about to type into
            the next step), not the outcome preview — that lives in step 2
            once boards/dates are known, per issue #182's framing. */}
        {selectedTemplate && parsed.length > 0 && (
          <View className="bg-surface-background border border-surface-border rounded-2xl p-4 flex-row items-center gap-3">
            <FontAwesome name="magic" size={14} color={c.primary} />
            <Text className="text-typography-main text-sm font-bold flex-1">
              {parsed.length} project{parsed.length === 1 ? '' : 's'} · {parsed.length * taskCountPerProject} task{parsed.length * taskCountPerProject === 1 ? '' : 's'}.
              {' '}
              <Text className="font-normal text-typography-muted">
                Next step picks the boards and the dates, and shows you the result before anything is created.
              </Text>
            </Text>
          </View>
        )}

        <BlockerList blockers={setupBlockers} c={c} />

        {error && <Text className="text-state-danger text-[13px] font-bold">{error}</Text>}
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
