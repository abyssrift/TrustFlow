import { loadXlsx } from '@/components/common/loadXlsx';
import type { SpreadsheetFormat } from '@/lib/taskMobility';

/**
 * Company Data Export — row builders + a multi-sheet workbook writer for the
 * account-level export center (Tasks / Projects / Time Tracking). Tasks reuse
 * `buildExportRows`/`TASK_COLUMNS` from taskMobility.ts; this file only adds
 * the entities that modal didn't already cover.
 */

const fmtDate = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
};

export const PROJECT_COLUMNS = ['Name', 'Description', 'Status', 'Pipeline', 'Created At', 'Expiry Date', 'Featured'] as const;

export type ExportProject = {
  name: string;
  description: string | null;
  status: string | null;
  pipelineName: string | null;
  created_at: string | null;
  expiry_date: string | null;
  is_featured: boolean | null;
};

export function buildProjectExportRows(projects: ExportProject[]): Record<string, string | number>[] {
  return projects.map(p => ({
    Name: p.name ?? '',
    Description: p.description ?? '',
    Status: p.status ?? '',
    Pipeline: p.pipelineName ?? '',
    'Created At': fmtDate(p.created_at),
    'Expiry Date': fmtDate(p.expiry_date),
    Featured: p.is_featured ? 'Yes' : 'No',
  }));
}

export const TIME_TRACKING_COLUMNS = ['Task', 'User', 'Stage', 'Started At', 'Completed At', 'Hours Spent', 'Status', 'Notes'] as const;

export type ExportTimeSession = {
  taskTitle: string | null;
  userEmail: string | null;
  stageName: string | null;
  started_at: string | null;
  completed_at: string | null;
  total_seconds_spent: number | null;
  status: string | null;
  notes: string | null;
};

export function buildTimeTrackingExportRows(sessions: ExportTimeSession[]): Record<string, string | number>[] {
  return sessions.map(s => ({
    Task: s.taskTitle ?? '',
    User: s.userEmail ?? '',
    Stage: s.stageName ?? '',
    'Started At': fmtDate(s.started_at),
    'Completed At': fmtDate(s.completed_at),
    'Hours Spent': s.total_seconds_spent != null ? Math.round((s.total_seconds_spent / 3600) * 100) / 100 : 0,
    Status: s.status ?? '',
    Notes: s.notes ?? '',
  }));
}

export type ExportSheet = {
  name: string;
  rows: Record<string, any>[];
  columns: readonly string[];
};

/** Build a single workbook with one sheet per entity (used by "Export All"). */
export async function sheetsToWorkbookBytes(sheets: ExportSheet[], format: SpreadsheetFormat): Promise<Uint8Array> {
  const XLSX = await loadXlsx();
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const ws = XLSX.utils.json_to_sheet(sheet.rows, { header: [...sheet.columns] });
    XLSX.utils.book_append_sheet(wb, ws, sheet.name);
  }
  const out = XLSX.write(wb, { type: 'array', bookType: format });
  return out instanceof Uint8Array ? out : new Uint8Array(out);
}
