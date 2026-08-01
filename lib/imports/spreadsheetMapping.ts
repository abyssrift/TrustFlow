// Pure parsing/mapping/matching logic for spreadsheet intake (issue #188 /
// plan §15). Deliberately has ZERO imports from lib/supabase or the xlsx
// loader — those pull in react-native transitively, which breaks the plain
// `npx tsx` self-check (see spreadsheetIntake.check.ts). I/O orchestration
// (reading bytes via xlsx, querying `clients`) lives in spreadsheetIntake.ts,
// which imports this file.
//
// HARD CONSTRAINT (plan §15.1): everything here produces data for
// rpc_preview_instantiate_template / rpc_instantiate_template's payload and
// NOTHING ELSE — no table is read or written by this file.

export type SheetCell = string | number | boolean | null | undefined;

export type MappedField = 'name' | 'client_ref' | 'client_external_ref' | 'start_date';

export const MAPPED_FIELD_LABELS: Record<MappedField, string> = {
  name: 'Project Name',
  client_ref: 'Client Name',
  client_external_ref: 'Client Ref / ID',
  start_date: 'Start Date',
};

// field -> source column index (0-based, within the detected header row)
export type ColumnMapping = Partial<Record<MappedField, number>>;
export type ColumnConfidence = Partial<Record<MappedField, number>>; // 0..1 per field

// ponytail: an arbitrary but documented ceiling, not a real streaming parser.
// rpc_instantiate_template does one set-based INSERT ... SELECT per batch —
// fine at hundreds/low-thousands of rows (§13.10 measured 500 tasks in
// 58-94ms) but nothing here has been load-tested past this. Raise it (or
// switch the RPC to chunked calls) if a real file needs more.
export const MAX_INTAKE_ROWS = 5000;

// ─── 1. Find the table ────────────────────────────────────────────────────

export function scoreRow(row: SheetCell[]): number {
  return row.filter(c => c !== null && c !== undefined && String(c).trim() !== '').length;
}

function textishCount(row: SheetCell[]): number {
  return row.filter(c => {
    if (c === null || c === undefined) return false;
    const s = String(c).trim();
    if (!s) return false;
    return Number.isNaN(Number(s));
  }).length;
}

/**
 * Real files have a title row, a merged banner, a logo, blank leading
 * columns, and the header several rows down. Rather than assume A1, score
 * every row in the first `maxScan` rows and pick the best header candidate:
 * a row with several filled, mostly-non-numeric cells, immediately followed
 * by a row that also has real data (so a banner with one cell, or a blank
 * spacer row, never wins). Returns -1 if no candidate is found (empty sheet /
 * no detectable table — caller must raise, never guess row 0).
 */
export function detectHeaderRow(aoa: SheetCell[][], maxScan = 30): number {
  let best = -1;
  let bestScore = 0;
  const scanLimit = Math.min(aoa.length, maxScan);
  for (let r = 0; r < scanLimit; r++) {
    const row = aoa[r] || [];
    const score = scoreRow(row);
    if (score < 2) continue; // banner/logo/blank rows have 0-1 filled cells
    const next = aoa[r + 1] || [];
    if (scoreRow(next) < 2) continue; // no data below it isn't a real header
    if (textishCount(row) < score * 0.5) continue; // a data row full of numbers isn't a header
    if (score > bestScore) { bestScore = score; best = r; }
  }
  return best;
}

// ─── 2. Map the columns ───────────────────────────────────────────────────

type Rule = { field: MappedField; patterns: RegExp[]; weight: number };

// Checked in this order — external_ref and start_date are the most specific
// (least likely to false-positive), client_ref/name are the catch-alls. One
// column maps to at most one field on the first pattern that matches it.
const RULES: Rule[] = [
  { field: 'client_external_ref', weight: 1, patterns: [
    /\bcr\s*(no|number|#)?\b/i, /commercial\s*reg/i, /registration/i, /\bfile\s*(no|number|#)/i,
    /client\s*(id|code|ref|no|#)/i, /\btax\s*id\b/i, /\blicen[sc]e\b/i, /external\s*ref/i, /\breference\b/i, /\bref\s*(no|#)?\b/i,
  ] },
  { field: 'start_date', weight: 1, patterns: [
    /start\s*date/i, /\bonboard/i, /commence/i, /engagement\s*date/i, /\bdate\b/i,
  ] },
  { field: 'client_ref', weight: 0.9, patterns: [
    /client\s*name/i, /company\s*name/i, /account\s*name/i, /\bclient\b/i, /\bcompany\b/i, /\bcustomer\b/i,
  ] },
  { field: 'name', weight: 0.9, patterns: [
    /project\s*name/i, /entity\s*name/i, /^name$/i, /\bname\b/i,
  ] },
];

function looksLikeDate(v: SheetCell): boolean {
  if (v === null || v === undefined || v === '') return false;
  if (typeof v === 'number') return v > 20000 && v < 80000; // plausible Excel date serial
  const d = new Date(String(v));
  return !Number.isNaN(d.getTime());
}

function looksLikeCode(v: SheetCell): boolean {
  if (v === null || v === undefined) return false;
  const s = String(v).trim();
  if (!s) return false;
  return s.length <= 20 && /^[a-z0-9][a-z0-9\-\/. ]*$/i.test(s) && /\d/.test(s);
}

/**
 * Propose name/client_ref/client_external_ref/start_date from header text
 * (primary signal) and cell shape in the sample rows below the header
 * (secondary signal, nudges confidence). One column per field; if a header
 * hints "name" but no client_ref column exists separately, client_ref
 * mirrors name (a portfolio-of-clients import usually has one name column
 * that IS the client — same convention BulkCreateProjectsSheet's textarea
 * already uses: project name doubles as client name).
 */
export function proposeColumnMapping(
  headers: SheetCell[],
  sampleRows: SheetCell[][],
): { mapping: ColumnMapping; confidence: ColumnConfidence } {
  const mapping: ColumnMapping = {};
  const confidence: ColumnConfidence = {};
  const claimedCols = new Set<number>();

  headers.forEach((h, colIdx) => {
    const text = String(h ?? '').trim();
    if (!text || claimedCols.has(colIdx)) return;
    for (const rule of RULES) {
      if (mapping[rule.field] !== undefined) continue; // field already assigned
      if (rule.patterns.some(p => p.test(text))) {
        let conf = rule.weight;
        // Shape check nudges confidence up/down — doesn't change the assignment.
        const col = sampleRows.map(r => r[colIdx]);
        const filled = col.filter(c => c !== null && c !== undefined && String(c).trim() !== '');
        if (filled.length > 0) {
          if (rule.field === 'start_date') {
            const dateLike = filled.filter(looksLikeDate).length / filled.length;
            conf = conf * (0.5 + 0.5 * dateLike);
          } else if (rule.field === 'client_external_ref') {
            const codeLike = filled.filter(looksLikeCode).length / filled.length;
            conf = conf * (0.5 + 0.5 * codeLike);
          }
        }
        mapping[rule.field] = colIdx;
        confidence[rule.field] = Math.round(conf * 100) / 100;
        claimedCols.add(colIdx);
        break;
      }
    }
  });

  // A row of companies with one name-ish column: mirror it into client_ref
  // too, matching the existing paste-textarea convention (project name
  // doubles as client name) unless a distinct client column was found.
  if (mapping.name !== undefined && mapping.client_ref === undefined) {
    mapping.client_ref = mapping.name;
    confidence.client_ref = confidence.name;
  } else if (mapping.client_ref !== undefined && mapping.name === undefined) {
    mapping.name = mapping.client_ref;
    confidence.name = confidence.client_ref;
  }

  return { mapping, confidence };
}

// ─── 3. Extract typed rows ────────────────────────────────────────────────

export type IntakeRow = {
  rowNumber: number; // 1-based spreadsheet row (for user-facing messages)
  name: string;
  client_ref: string;
  client_external_ref: string | null;
  start_date: string | null; // ISO, or null if blank/unparseable
  start_date_raw: string | null; // original cell text, for showing a parse failure
};

function parseDateCell(raw: SheetCell): { iso: string | null; raw: string | null } {
  if (raw === null || raw === undefined || raw === '') return { iso: null, raw: null };
  const rawStr = String(raw);
  // Excel serial date (sheet_to_json without cellDates leaves numeric dates as
  // a day-count from 1899-12-30).
  if (typeof raw === 'number' && raw > 20000 && raw < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + raw * 86400000);
    return Number.isNaN(d.getTime()) ? { iso: null, raw: rawStr } : { iso: d.toISOString(), raw: rawStr };
  }
  const d = new Date(rawStr);
  return Number.isNaN(d.getTime()) ? { iso: null, raw: rawStr } : { iso: d.toISOString(), raw: rawStr };
}

/** Turn the raw AOA + a confirmed mapping into typed rows. Blank names are
 * KEPT (not silently dropped) with an empty `name` — the caller must surface
 * them as skipped, never drop them invisibly (the exact #182 failure mode). */
export function buildIntakeRows(aoa: SheetCell[][], headerRowIndex: number, mapping: ColumnMapping): IntakeRow[] {
  const rows: IntakeRow[] = [];
  for (let r = headerRowIndex + 1; r < aoa.length; r++) {
    const row = aoa[r] || [];
    if (scoreRow(row) === 0) continue; // fully blank row — not a data row at all
    const cell = (field: MappedField): SheetCell => {
      const idx = mapping[field];
      return idx === undefined ? undefined : row[idx];
    };
    const { iso, raw } = parseDateCell(cell('start_date'));
    rows.push({
      rowNumber: r + 1,
      name: String(cell('name') ?? '').trim(),
      client_ref: String(cell('client_ref') ?? '').trim(),
      client_external_ref: String(cell('client_external_ref') ?? '').trim() || null,
      start_date: iso,
      start_date_raw: raw,
    });
  }
  return rows;
}

// ─── 4. Resolve clients ─────────────────────────────────────────────────────
// §13.3's rule, already load-bearing server-side: match by external_ref
// first, name second. An ambiguous match is a question, never a guess — this
// module only ever proposes; nothing here writes a client.

export type ExistingClient = { id: string; name: string; external_ref: string | null };

export type ClientMatch =
  | { kind: 'ref'; client: ExistingClient }              // matched on external_ref — highest confidence
  | { kind: 'exact_name'; client: ExistingClient }        // exact case-insensitive name match
  | { kind: 'ambiguous'; candidates: ExistingClient[] }   // near-miss name(s) — needs a human answer
  | { kind: 'new' }                                       // no match — rpc_instantiate_template will create it
  | { kind: 'blank' };                                    // no name at all — row is unusable

// ponytail: normalized-token-equality / substring fuzzy match, not real
// edit-distance. Ceiling: "Abdallah Group" vs "Al Abdallah Group" (word
// reordering/insertion beyond a simple substring) won't be flagged. Upgrade
// to a trigram/levenshtein score if false negatives show up in practice.
const SUFFIX_WORDS = /\b(llc|ltd|inc|co|corp|company|group|holding|holdings|trading|est|establishment)\b/g;
export function normalizeClientName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(SUFFIX_WORDS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function matchClientByName(name: string, existing: ExistingClient[]): ClientMatch {
  const trimmed = name.trim();
  if (!trimmed) return { kind: 'blank' };

  const exact = existing.find(c => c.name.trim().toLowerCase() === trimmed.toLowerCase());
  if (exact) return { kind: 'exact_name', client: exact };

  const normTarget = normalizeClientName(trimmed);
  if (!normTarget) return { kind: 'new' };

  const candidates = existing.filter(c => {
    const normC = normalizeClientName(c.name);
    if (!normC) return false;
    if (normC === normTarget) return true;
    const [shorter, longer] = normC.length <= normTarget.length ? [normC, normTarget] : [normTarget, normC];
    return longer.startsWith(shorter) && shorter.length / longer.length > 0.6;
  });

  return candidates.length > 0 ? { kind: 'ambiguous', candidates } : { kind: 'new' };
}

export function resolveClientMatch(row: IntakeRow, existing: ExistingClient[]): ClientMatch {
  if (row.client_external_ref) {
    const byRef = existing.find(c => c.external_ref === row.client_external_ref);
    if (byRef) return { kind: 'ref', client: byRef };
    // A ref that doesn't match anything is still a "new" client (the RPC
    // creates it with that ref) — not ambiguous, and not a name-based guess.
    return { kind: 'new' };
  }
  return matchClientByName(row.client_ref, existing);
}

export function resolveAllClients(rows: IntakeRow[], existing: ExistingClient[]): Map<number, ClientMatch> {
  const out = new Map<number, ClientMatch>();
  rows.forEach((row, i) => out.set(i, resolveClientMatch(row, existing)));
  return out;
}
