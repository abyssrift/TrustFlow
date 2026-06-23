import { pick } from '@/lib/taskMobility';

/**
 * Jira CSV/XLSX bridge — translates a Jira issue export into the canonical
 * header shape `parseImportRows` (in taskMobility.ts) already understands,
 * so a Jira export can flow through the exact same import pipeline as a
 * native TrustFlow spreadsheet.
 */

const JIRA_SIGNATURE_HEADERS = ['issue key', 'issue id', 'issue type'];

/** True if the parsed rows look like a Jira issue export (by header signature). */
export function isJiraExport(rawRows: Record<string, any>[]): boolean {
  const first = rawRows[0];
  if (!first) return false;
  const headers = Object.keys(first).map(h => h.toLowerCase());
  return JIRA_SIGNATURE_HEADERS.some(h => headers.includes(h));
}

const JIRA_PRIORITY_MAP: Record<string, string> = {
  highest: 'Urgent',
  high: 'High',
  medium: 'Normal',
  low: 'Low',
  lowest: 'Low',
};

function normalizeJiraPriority(raw: any): string {
  const v = String(raw ?? '').trim().toLowerCase();
  return JIRA_PRIORITY_MAP[v] ?? 'Normal';
}

/**
 * Parse Jira's common CSV export date format, e.g. "21/Jun/24 3:45 PM".
 * Falls back to native Date parsing for ISO-style values some Jira instances export instead.
 */
function parseJiraDate(raw: any): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';

  const m = s.match(/^(\d{1,2})\/([A-Za-z]{3})\/(\d{2,4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (m) {
    const [, dayStr, monStr, yearStr, hourStr, minStr, ampm] = m;
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const month = months.indexOf(monStr.toLowerCase());
    if (month === -1) return '';
    const year = yearStr.length === 2 ? 2000 + Number(yearStr) : Number(yearStr);
    let hour = Number(hourStr);
    if (ampm) {
      const isPm = ampm.toUpperCase() === 'PM';
      if (isPm && hour < 12) hour += 12;
      if (!isPm && hour === 12) hour = 0;
    }
    const d = new Date(year, month, Number(dayStr), hour, Number(minStr));
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    return '';
  }

  const d = new Date(s);
  return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/** Translate one raw Jira row into TrustFlow's canonical import header shape. */
export function mapJiraRow(raw: Record<string, any>): Record<string, string> {
  const projectName = String(pick(raw, 'Project name') ?? pick(raw, 'Project key') ?? '').trim();

  return {
    Title: String(pick(raw, 'Summary') ?? '').trim(),
    Description: String(pick(raw, 'Description') ?? '').trim(),
    Priority: normalizeJiraPriority(pick(raw, 'Priority')),
    Category: String(pick(raw, 'Issue Type') ?? '').trim(),
    Project: projectName,
    'Start Date': parseJiraDate(pick(raw, 'Created')),
    'Due Date': parseJiraDate(pick(raw, 'Due date')),
    Assignees: String(pick(raw, 'Assignee') ?? '').trim(),
  };
}
