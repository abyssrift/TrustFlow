// Spreadsheet intake — issue #188 / plan §15 ("Smartness": drop a spreadsheet,
// get a configured portfolio).
//
// HARD CONSTRAINT (plan §15.1): this produces a `projects` array + resolved
// client identities for rpc_preview_instantiate_template /
// rpc_instantiate_template's payload and NOTHING ELSE — it never inserts a
// client, project, or task itself. The only writer is rpc_instantiate_template
// (called from BulkCreateProjectsSheet, extended to accept these pre-filled
// rows).
//
// I/O orchestration only — the actual parsing/mapping/matching algorithms
// live in ./spreadsheetMapping (kept import-free of lib/supabase and the xlsx
// loader so its self-check can run under plain `npx tsx`).
//
// "Learning is scoped to mapping, not writes" (§15.2) — per-source mapping
// memory (remembering a company's confirmed mapping for the next file from
// the same office) is DEFERRED, not built. Every file gets fresh header
// detection + a proposed mapping, which the user confirms every time. Noted
// in docs/PROJECT_HIERARCHY_PLAN.md §15 and the shipping report.
//
// Template suggestion (§15.2 item 4, "pick a template") is also out of scope
// for this pass (lowest-confidence inference per the issue) — the user still
// picks a template by hand in BulkCreateProjectsSheet's setup step.

import { loadXlsx } from '@/components/common/loadXlsx';
import { supabase } from '@/lib/supabase';
import {
  detectHeaderRow,
  proposeColumnMapping,
  buildIntakeRows,
  detectColumnRelations,
  resolveAllClients,
  MAX_INTAKE_ROWS,
  type SheetCell,
  type ColumnMapping,
  type ColumnConfidence,
  type ColumnProfile,
  type ColumnRelation,
  type DateOrder,
  type IntakeRow,
  type ExistingClient,
} from './spreadsheetMapping';

export * from './spreadsheetMapping';

export type ParsedSpreadsheet = {
  headerRowIndex: number;
  headers: SheetCell[];
  mapping: ColumnMapping;
  confidence: ColumnConfidence;
  rows: IntakeRow[];
  totalDataRows: number;
  // Plan §18: the content profile for EVERY column (dense, index-aligned) plus
  // the sequence-level relationships. The UI renders these — a column the
  // mapping did not claim is a custom-field candidate, not a discarded column.
  profiles: ColumnProfile[];
  relations: ColumnRelation[];
  /** columns carrying data that no MappedField claimed (§18.3 custom fields) */
  unmapped: number[];
  /** how the start_date column's d/m/y cells were read. 'ambiguous' = ask once. */
  dateOrder: DateOrder;
  // Full sheet as an array-of-arrays. Kept so the caller can re-run
  // buildIntakeRows live when the user edits the proposed mapping (§15.2 #2:
  // "let the user correct the proposal") — without this, an edited mapping
  // would have no way to re-derive rows short of re-reading the file.
  aoa: SheetCell[][];
};

export class SpreadsheetIntakeError extends Error {}

export async function parseSpreadsheetBytes(bytes: Uint8Array): Promise<ParsedSpreadsheet> {
  const XLSX = await loadXlsx();
  let wb: ReturnType<typeof XLSX.read>;
  try {
    wb = XLSX.read(bytes, { type: 'array' });
  } catch {
    throw new SpreadsheetIntakeError('This file could not be read as a spreadsheet (.xlsx/.xls/.csv).');
  }
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new SpreadsheetIntakeError('This spreadsheet has no sheets.');
  const ws = wb.Sheets[sheetName];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false }) as SheetCell[][];

  if (aoa.length === 0) throw new SpreadsheetIntakeError('This sheet is empty.');

  const headerRowIndex = detectHeaderRow(aoa);
  if (headerRowIndex === -1) {
    throw new SpreadsheetIntakeError(
      'Could not find a header row — no row in the first 30 has enough filled columns followed by data. Check the file has a real table, not just a title/banner.',
    );
  }

  const headers = aoa[headerRowIndex];
  // 500, not 20: classification is now content-driven (plan §18), and 20 rows
  // is not enough to tell a repeated vocabulary from a unique one — a value
  // that first repeats at row 50 would make the column look like an identifier.
  // ponytail: 500 caps the cost on a 5 000-row file and is far past the point
  // where a non-enum column has already exceeded the 12-value enum ceiling.
  const sampleRows = aoa.slice(headerRowIndex + 1, headerRowIndex + 501);
  const { mapping, confidence, profiles, unmapped } = proposeColumnMapping(headers, sampleRows);
  const relations = detectColumnRelations(profiles, aoa, headerRowIndex);

  // DD/MM vs MM/DD is decided ONCE, for the whole start_date column, from that
  // column's own cells (§18.4) — never re-guessed per row. 'ambiguous' is
  // surfaced so the UI can ask about the column instead of guessing 400 times.
  const dateOrder: DateOrder =
    (mapping.start_date !== undefined ? profiles[mapping.start_date]?.dateOrder : undefined) ?? 'ambiguous';
  const rows = buildIntakeRows(aoa, headerRowIndex, mapping, dateOrder);
  if (rows.length === 0) throw new SpreadsheetIntakeError('No data rows found below the detected header.');
  if (rows.length > MAX_INTAKE_ROWS) {
    throw new SpreadsheetIntakeError(
      `This file has ${rows.length} rows; the maximum supported in one import is ${MAX_INTAKE_ROWS}. Split it into smaller batches.`,
    );
  }

  return {
    headerRowIndex, headers, mapping, confidence, rows, totalDataRows: rows.length, aoa,
    profiles, relations, unmapped, dateOrder,
  };
}

export async function fetchExistingClients(): Promise<ExistingClient[]> {
  // RLS (clients_select) already scopes this to the caller's company.
  const { data, error } = await supabase.from('clients').select('id, name, external_ref');
  if (error) throw error;
  return (data || []) as ExistingClient[];
}

export { resolveAllClients };
