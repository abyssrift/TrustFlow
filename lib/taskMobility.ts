import { loadXlsx } from '@/components/common/loadXlsx';
import { supabase } from '@/lib/supabase';

/**
 * Task Data Mobility — shared (platform-agnostic) helpers for exporting tasks
 * to a spreadsheet and parsing a spreadsheet back into importable task drafts.
 *
 * Spreadsheet I/O goes through the existing lazy `loadXlsx` loader so the heavy
 * SheetJS library stays code-split. Byte payloads use Uint8Array as the common
 * currency between web (Blob/anchor) and native (expo-file-system File API).
 */

export type SpreadsheetFormat = 'csv' | 'xlsx';

/** Column headers, in display order. Import matches on these (case-insensitive). */
export const TASK_COLUMNS = [
  'Title',
  'Description',
  'Priority',
  'Category',
  'Weight',
  'Stage',
  'Pipeline',
  'Project',
  'Start Date',
  'Due Date',
  'Estimated Hours',
  'Assignees',
  'Created At',
] as const;

/** Subset of columns an import actually consumes (the rest are export-only context). */
export const IMPORT_FIELDS = [
  'Title',
  'Description',
  'Priority',
  'Category',
  'Weight',
  'Pipeline',
  'Project',
  'Start Date',
  'Due Date',
  'Estimated Hours',
  'Assignees',
] as const;

/** A task enriched with the resolved display names needed for export rows. */
export type ExportTask = {
  title: string;
  description: string | null;
  priority: string | null;
  category: string | null;
  weight: number | null;
  stageName: string | null;
  pipelineName: string | null;
  projectName: string | null;
  start_date: string | null;
  due_date: string | null;
  estimated_hours: number | null;
  assigneeEmails: string[];
  created_at: string | null;
};

const fmtDate = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  // YYYY-MM-DD — unambiguous and re-parseable on import.
  return d.toISOString().slice(0, 10);
};

const titleCase = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s);

export function buildExportRows(tasks: ExportTask[]): Record<string, string | number>[] {
  return tasks.map(t => ({
    Title: t.title ?? '',
    Description: t.description ?? '',
    // DB stores 'medium' for the app's 'normal'; surface 'Normal' for readability.
    Priority: titleCase((t.priority === 'medium' ? 'normal' : t.priority) || 'normal'),
    Category: t.category ?? '',
    Weight: t.weight ?? 0,
    Stage: t.stageName ?? '',
    Pipeline: t.pipelineName ?? '',
    Project: t.projectName ?? '',
    'Start Date': fmtDate(t.start_date),
    'Due Date': fmtDate(t.due_date),
    'Estimated Hours': t.estimated_hours ?? '',
    Assignees: (t.assigneeEmails || []).join('; '),
    'Created At': fmtDate(t.created_at),
  }));
}

/** Fetch every non-deleted task in the caller's company, shaped for export. */
export async function fetchExportTasks(): Promise<ExportTask[]> {
  const [tasksRes, stagesRes, pipesRes, projsRes, usersRes] = await Promise.all([
    supabase
      .from('tasks')
      .select('title, description, priority, category, weight, current_stage_id, pipeline_id, project_id, start_date, due_date, estimated_hours, created_at, assignments:task_assignments(assignee_user_id)')
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),
    supabase.from('stages').select('id, name'),
    supabase.from('pipelines').select('id, name'),
    supabase.from('projects').select('id, name'),
    supabase.from('users').select('id, email').is('deleted_at', null),
  ]);

  if (tasksRes.error) throw tasksRes.error;

  const stageName = new Map((stagesRes.data || []).map((s: any) => [s.id, s.name]));
  const pipeName = new Map((pipesRes.data || []).map((p: any) => [p.id, p.name]));
  const projName = new Map((projsRes.data || []).map((p: any) => [p.id, p.name]));
  const userEmail = new Map((usersRes.data || []).map((u: any) => [u.id, u.email]));

  return (tasksRes.data || []).map((t: any) => ({
    title: t.title,
    description: t.description,
    priority: t.priority,
    category: t.category,
    weight: t.weight,
    stageName: t.current_stage_id ? stageName.get(t.current_stage_id) ?? null : null,
    pipelineName: t.pipeline_id ? pipeName.get(t.pipeline_id) ?? null : null,
    projectName: t.project_id ? projName.get(t.project_id) ?? null : null,
    start_date: t.start_date,
    due_date: t.due_date,
    estimated_hours: t.estimated_hours,
    assigneeEmails: (t.assignments || [])
      .map((a: any) => a.assignee_user_id && userEmail.get(a.assignee_user_id))
      .filter(Boolean),
    created_at: t.created_at,
  }));
}

export async function rowsToBytes(
  rows: Record<string, any>[],
  format: SpreadsheetFormat
): Promise<Uint8Array> {
  const XLSX = await loadXlsx();
  const ws = XLSX.utils.json_to_sheet(rows, { header: [...TASK_COLUMNS] });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Tasks');
  const out = XLSX.write(wb, { type: 'array', bookType: format });
  return out instanceof Uint8Array ? out : new Uint8Array(out);
}

export async function bytesToRows(bytes: Uint8Array): Promise<Record<string, any>[]> {
  const XLSX = await loadXlsx();
  const wb = XLSX.read(bytes, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const ws = wb.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(ws, { defval: '' }) as Record<string, any>[];
}

/** Map a free-form priority cell to the DB value rpc_create_task expects. */
export function priorityToDb(raw: any): string {
  const v = String(raw ?? '').trim().toLowerCase();
  if (v === 'low') return 'low';
  if (v === 'high') return 'high';
  if (v === 'urgent' || v === 'critical') return 'urgent';
  // 'normal' / 'medium' / blank / anything else
  return 'medium';
}

const parseDateCell = (raw: any): string | null => {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
};

const parseNumberCell = (raw: any): number | null => {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/** Case-insensitive header accessor — tolerates extra/renamed columns. */
export function pick(row: Record<string, any>, header: string): any {
  if (header in row) return row[header];
  const lower = header.toLowerCase();
  const key = Object.keys(row).find(k => k.toLowerCase() === lower);
  return key ? row[key] : undefined;
}

export type ParsedTaskRow = {
  rowNumber: number;
  title: string;
  description: string;
  priorityDb: string;
  category: string | null;
  weight: number;
  startDate: string | null;
  dueDate: string | null;
  estimatedHours: number | null;
  pipelineName: string | null;
  projectName: string | null;
  assigneeEmails: string[];
  // resolution results (filled by caller against company lookups)
  pipelineId: string | null;
  projectId: string | null;
  assigneeUserIds: string[];
  warnings: string[];
};

export type ImportLookups = {
  pipelinesByName: Map<string, string>;   // lowercased name -> id
  projectsByName: Map<string, string>;    // lowercased name -> id
  usersByEmail: Map<string, string>;      // lowercased email -> id
  usersByName: Map<string, string>;       // lowercased full_name/display_name -> id
  defaultPipelineId: string | null;
};

/**
 * Convert raw spreadsheet rows into validated, resolved task drafts.
 * Rows without a Title are dropped. Unknown pipeline/project/assignee values
 * become warnings (the row still imports, just without that link).
 */
export function parseImportRows(
  rawRows: Record<string, any>[],
  lookups: ImportLookups
): { rows: ParsedTaskRow[]; skipped: number } {
  const rows: ParsedTaskRow[] = [];
  let skipped = 0;

  rawRows.forEach((raw, i) => {
    const title = String(pick(raw, 'Title') ?? '').trim();
    if (!title) {
      skipped++;
      return;
    }

    const warnings: string[] = [];

    const pipelineName = String(pick(raw, 'Pipeline') ?? '').trim() || null;
    let pipelineId: string | null = null;
    if (pipelineName) {
      pipelineId = lookups.pipelinesByName.get(pipelineName.toLowerCase()) ?? null;
      if (!pipelineId) warnings.push(`Pipeline "${pipelineName}" not found — using default`);
    }
    if (!pipelineId) pipelineId = lookups.defaultPipelineId;

    const projectName = String(pick(raw, 'Project') ?? '').trim() || null;
    let projectId: string | null = null;
    if (projectName) {
      projectId = lookups.projectsByName.get(projectName.toLowerCase()) ?? null;
      if (!projectId) warnings.push(`Project "${projectName}" not found — left unassigned`);
    }

    const emailsRaw = String(pick(raw, 'Assignees') ?? '').trim();
    const assigneeEmails = emailsRaw
      ? emailsRaw.split(/[;,]/).map(e => e.trim()).filter(Boolean)
      : [];
    const assigneeUserIds: string[] = [];
    for (const token of assigneeEmails) {
      const lower = token.toLowerCase();
      // Most imports give an email; some (e.g. a Jira export's Assignee column) give a
      // display name instead, so fall back to a name lookup when it isn't email-shaped.
      const id = lookups.usersByEmail.get(lower) ?? (!lower.includes('@') ? lookups.usersByName.get(lower) : undefined);
      if (id) assigneeUserIds.push(id);
      else warnings.push(`Assignee "${token}" not found — skipped`);
    }

    const weight = parseNumberCell(pick(raw, 'Weight'));

    rows.push({
      rowNumber: i + 2, // +1 for header row, +1 for 1-based display
      title,
      description: String(pick(raw, 'Description') ?? '').trim(),
      priorityDb: priorityToDb(pick(raw, 'Priority')),
      category: String(pick(raw, 'Category') ?? '').trim() || null,
      weight: weight != null && weight >= 0 ? weight : 0,
      startDate: parseDateCell(pick(raw, 'Start Date')),
      dueDate: parseDateCell(pick(raw, 'Due Date')),
      estimatedHours: parseNumberCell(pick(raw, 'Estimated Hours')),
      pipelineName,
      projectName,
      assigneeEmails,
      pipelineId,
      projectId,
      assigneeUserIds,
      warnings,
    });
  });

  return { rows, skipped };
}

/** Bytes for a downloadable, ready-to-fill import template (headers + one example row). */
export async function buildTemplateBytes(format: SpreadsheetFormat): Promise<Uint8Array> {
  const example: Record<string, string | number> = {
    Title: 'Example task — delete this row',
    Description: 'Optional longer description',
    Priority: 'Normal',
    Category: 'General',
    Weight: 1,
    Stage: '(ignored on import)',
    Pipeline: '',
    Project: '',
    'Start Date': '',
    'Due Date': '2026-12-31',
    'Estimated Hours': 4,
    Assignees: 'teammate@example.com; other@example.com',
    'Created At': '(ignored on import)',
  };
  return rowsToBytes([example], format);
}
