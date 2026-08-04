// The import PLAN — what the confirmation step shows and what the user edits
// (issue #142 Phase 9, plan §18.3/§18.5). Pure functions only: the same
// zero-`lib/supabase`, zero-xlsx constraint spreadsheetMapping.ts carries, so
// importPlan.check.ts runs under plain `npx tsx`.
//
// The classifier (spreadsheetMapping.ts) answers "what IS this column". This
// answers "what do we DO with it, and what must a human confirm first" —
// deliberately a separate layer, because the answer to the second question
// depends on the company's existing custom fields and the first must not.
//
// §18.2 rule 3, mechanically: `buildColumnDecisions` returns one decision per
// profiled column and every column gets a target. A column the mapping did not
// claim defaults to `custom` (a typed field), never to `ignore` — "nothing is
// discarded" is the default, not something the user has to opt into.

import {
  normalizeMatchKey,
  type ColumnPrimitive,
  type ColumnProfile,
  type MappedField,
  type SheetCell,
} from './spreadsheetMapping';

/** Mirrors project_field_defs.data_type's CHECK constraint exactly. */
export type FieldDataType = 'text' | 'number' | 'date' | 'enum' | 'boolean';

/**
 * Mirrors project_field_defs.format's CHECK constraint exactly. A DISPLAY hint,
 * never a storage type — see the migration and `displayFormatForPrimitive`.
 * Declared here, beside the type it accompanies, and re-exported by
 * hooks/useProjectFields so component code has one import to reach for.
 */
export type FieldFormat = 'plain' | 'year' | 'money' | 'percent';

export const FIELD_TYPE_LABELS: Record<FieldDataType, string> = {
  text: 'Text', number: 'Number', date: 'Date', enum: 'Choice', boolean: 'Yes / No',
};

export type ExistingFieldDef = {
  id: string;
  key: string;
  label: string;
  data_type: FieldDataType;
  enum_options: string[] | null;
  source_column: string | null;
};

export type ColumnTarget =
  /** one of the four concepts rpc_instantiate_template's p_projects actually carries */
  | { kind: 'field'; field: MappedField }
  /** project_field_defs — the §18.3 default for anything the product has no concept for */
  | { kind: 'custom'; key: string; label: string; dataType: FieldDataType; enumOptions: string[] | null; defId: string | null }
  /** the ONLY way data leaves the import, and it takes a deliberate click */
  | { kind: 'ignore' };

export type ColumnDecision = {
  index: number;
  profile: ColumnProfile;
  target: ColumnTarget;
  /** first non-empty cell, verbatim — the user checks the classification against this */
  sample: string;
  /** the winning primitive does not explain every filled cell ("Expected date" at 0.62) */
  partial: boolean;
  /** partial, unknown, an ambiguous date order, or a weak win — render it differently */
  lowConfidence: boolean;
};

// ── types ──────────────────────────────────────────────────────────────────

const BOOLEANISH = new Set(['yes', 'no', 'y', 'n', 'true', 'false', '1', '0']);

/**
 * A content primitive -> the column type we'd create for it. `year` is a number
 * and not a date on purpose: a date column of 2025-01-01 would be a lie about
 * precision the source never had.
 */
export function fieldTypeForPrimitive(p: ColumnPrimitive, enumValues?: { label: string }[]): FieldDataType {
  switch (p) {
    case 'date': return 'date';
    case 'money': case 'year': return 'number';
    case 'enum':
      return enumValues && enumValues.length > 0 && enumValues.length <= 2 &&
        enumValues.every(v => BOOLEANISH.has(normalizeMatchKey(v.label)))
        ? 'boolean'
        : 'enum';
    default: return 'text'; // email, phone, unique_id, freetext, empty, unknown
  }
}

/**
 * The half of the primitive that `fieldTypeForPrimitive` has to throw away.
 *
 * `year` and `money` both become the storage type `number`, and that collapse is
 * correct — both belong in `value_num`. But it is also the whole reason a year
 * rendered as "2,025": once the primitive is gone, the read UI sees a number and
 * groups its thousands, which is right for a fee and wrong for a year. This
 * keeps the distinction as a display hint alongside the storage type instead of
 * re-deriving it from the label later, badly.
 */
export function displayFormatForPrimitive(p: ColumnPrimitive): FieldFormat | null {
  switch (p) {
    case 'year': return 'year';
    case 'money': return 'money';
    default: return null;
  }
}

/**
 * project_field_defs.key is CHECK-constrained to `^[a-z0-9_]{1,64}$`, so an
 * invalid slug is a raw Postgres error at save time rather than a form error.
 * Real headers are hostile to that: "Follow -up Status", "TOTAL A&T 2025",
 * trailing spaces, and columns with no header at all.
 */
export function slugifyFieldKey(header: string, index: number): string {
  const slug = normalizeMatchKey(header)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64)
    .replace(/_+$/, '');
  return slug || `column_${index + 1}`;
}

/** Keys must be unique per company; two headers can slugify to the same thing
 *  ("Status" and "Status "). Suffix rather than reject — the import must not
 *  stall on a duplicate the user did not write. */
export function uniqueKey(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base.slice(0, 60)}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base.slice(0, 58)}_${Date.now() % 100000}`;
}

// ── decisions ──────────────────────────────────────────────────────────────

const firstSample = (aoa: SheetCell[][], headerRowIndex: number, col: number): string => {
  for (let r = headerRowIndex + 1; r < aoa.length; r++) {
    const v = (aoa[r] || [])[col];
    if (v !== null && v !== undefined && String(v).trim() !== '') return String(v).trim();
  }
  return '';
};

/**
 * One decision per profiled column, index-aligned with `profiles`.
 *
 * Defaults, in order of precedence:
 *  1. a column the mapping claimed -> that concept;
 *  2. a column whose header matches an existing field def's `source_column`
 *     -> that def (§18.5 acceptance 6: re-importing the same file needs no
 *     re-mapping, and it reuses the def rather than creating a second one);
 *  3. everything else -> a NEW custom field with the detected type pre-filled.
 *
 * Nothing defaults to `ignore`.
 */
export function buildColumnDecisions(
  profiles: ColumnProfile[],
  mapping: Partial<Record<MappedField, number>>,
  aoa: SheetCell[][],
  headerRowIndex: number,
  existingDefs: ExistingFieldDef[] = [],
): ColumnDecision[] {
  const claimed = new Map<number, MappedField>();
  for (const [field, idx] of Object.entries(mapping) as [MappedField, number | undefined][]) {
    if (idx !== undefined && !claimed.has(idx)) claimed.set(idx, field);
  }
  const bySource = new Map(
    existingDefs.filter(d => d.source_column).map(d => [normalizeMatchKey(d.source_column!), d]),
  );
  const takenKeys = new Set(existingDefs.map(d => d.key));

  return profiles.map(profile => {
    const sample = firstSample(aoa, headerRowIndex, profile.index);
    const partial = profile.filled > 0 && profile.coverage > 0 && profile.coverage < 0.95;
    const lowConfidence =
      profile.primitive === 'unknown' || profile.confidence < 0.6 ||
      profile.dateOrder === 'ambiguous' || partial;

    const field = claimed.get(profile.index);
    if (field) return { index: profile.index, profile, target: { kind: 'field', field }, sample, partial, lowConfidence };

    const existing = bySource.get(normalizeMatchKey(profile.header));
    if (existing) {
      return {
        index: profile.index, profile, sample, partial, lowConfidence,
        target: {
          kind: 'custom', defId: existing.id, key: existing.key, label: existing.label,
          dataType: existing.data_type, enumOptions: existing.enum_options,
        },
      };
    }

    const dataType = fieldTypeForPrimitive(profile.primitive, profile.enumValues);
    const key = uniqueKey(slugifyFieldKey(profile.header, profile.index), takenKeys);
    takenKeys.add(key);
    return {
      index: profile.index, profile, sample, partial, lowConfidence,
      target: {
        kind: 'custom', defId: null, key,
        label: profile.header.trim() || `Column ${profile.index + 1}`,
        dataType,
        enumOptions: dataType === 'enum' ? (profile.enumValues ?? []).map(v => v.label) : null,
      },
    };
  });
}

// ── enum value mapping (§18.3 "fuzzy-match, then require confirmation") ────

export type EnumValueMatch = {
  /** normalizeMatchKey of the source value — case/whitespace variants share one */
  key: string;
  /** the spelling shown to the user (the most frequent one in the file) */
  label: string;
  count: number;
  /** every raw spelling that collapsed into this value. >1 IS the confirmation
   *  §18.5 #5 asks for — "Fadi haddad" merging into "Fadi Haddad" must be seen. */
  spellings: string[];
  /** an existing option this fuzzy-matched, or null = UNMATCHED (needs a decision) */
  matched: string | null;
  /** true when `matched` came from a normalized (not exact) comparison */
  fuzzy: boolean;
};

/**
 * Distinct values of one column, grouped by match key, each carrying every raw
 * spelling that collapsed into it, most frequent first.
 *
 * Deliberately re-read from the AOA rather than taken from
 * `ColumnProfile.enumValues`: the profile keeps only the FIRST-seen spelling,
 * and the whole point of the confirmation is that the user sees the variants
 * being merged. A silent merge is the same class of failure as a silent drop.
 */
export function distinctColumnValues(
  aoa: SheetCell[][],
  headerRowIndex: number,
  col: number,
): { key: string; label: string; count: number; spellings: string[] }[] {
  const groups = new Map<string, { key: string; count: number; spellings: Map<string, number> }>();
  for (let r = headerRowIndex + 1; r < aoa.length; r++) {
    const raw = (aoa[r] || [])[col];
    if (raw === null || raw === undefined) continue;
    const label = String(raw).trim();
    if (!label) continue;
    const key = normalizeMatchKey(label);
    let g = groups.get(key);
    if (!g) { g = { key, count: 0, spellings: new Map() }; groups.set(key, g); }
    g.count++;
    g.spellings.set(label, (g.spellings.get(label) ?? 0) + 1);
  }
  return [...groups.values()]
    .map(g => {
      const spellings = [...g.spellings.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      return { key: g.key, label: spellings[0][0], count: g.count, spellings: spellings.map(s => s[0]) };
    })
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/**
 * Pair each distinct source value with an existing option. Matching is by
 * `normalizeMatchKey` only — case, whitespace and diacritics, nothing cleverer.
 *
 * `matched: null` is the load-bearing output: it means NOTHING in the target
 * catalogue corresponds to this value, and the caller must not create anything
 * for it without an explicit decision. §18.3 rejects auto-creation outright —
 * a typo would become a permanent duplicate, which is #182's 66-unreachable-
 * tasks failure wearing a different hat.
 */
export function matchEnumValues(
  values: { key: string; label: string; count: number; spellings: string[] }[],
  options: string[],
): EnumValueMatch[] {
  const byKey = new Map(options.map(o => [normalizeMatchKey(o), o]));
  return values.map(v => {
    const exact = options.find(o => o === v.label);
    if (exact) return { ...v, matched: exact, fuzzy: false };
    const near = byKey.get(v.key) ?? null;
    return { ...v, matched: near, fuzzy: near !== null };
  });
}

/** The set of columns whose enum values still need a human answer. Drives the
 *  "you cannot continue yet" gate — an unmatched value with no decision must
 *  never fall through to a silent create. */
export function unresolvedEnumValues(
  matches: EnumValueMatch[],
  decisions: ReadonlyMap<string, 'create' | 'skip'>,
): EnumValueMatch[] {
  return matches.filter(m => m.matched === null && !decisions.has(m.key));
}

// ── row shape summary (§18.4) ──────────────────────────────────────────────

export type RowWarnings = {
  continuations: { rowNumber: number; text: string; continuesRowNumber: number }[];
  blankRowNumbers: number[];
  /** the file's own footer arithmetic — see `detectSummaryRows` */
  summaries: { rowNumber: number; text: string }[];
};

// "Total", "TOTAL A&T", "Grand Total", "Sub-total", "Net". Anchored at the
// start so a real client called "Total Solutions W.L.L." is not swallowed by
// it — the word has to OPEN the cell, which is how a spreadsheet footer reads
// and is not how a company name does.
const SUMMARY_LABEL = /^(grand[\s-]*)?(totals?|sums?|sub[\s-]*totals?|net|overall|average|avg)\b/i;

/**
 * Rows that are the spreadsheet's own arithmetic, not data: the `TOTAL` line
 * under the last engagement.
 *
 * Same rule as §18.4's continuation rows, and the same reason: imported, it
 * becomes a project called "Total" with a fee of everything; dropped silently,
 * a user who genuinely has a client called "Total" loses a row and never finds
 * out. So it is surfaced and the human decides — this function detects, it
 * never filters.
 *
 * ponytail: a label match on the name cell only. It does NOT try to verify the
 * arithmetic (that the row's money cells equal the sum of the rows above), and
 * it will miss an unlabelled footer row. Upgrade to a column-sum check if real
 * files turn out to carry unlabelled totals — `detectColumnRelations` already
 * has the summing machinery to borrow.
 */
export function detectSummaryRows(
  aoa: SheetCell[][],
  headerRowIndex: number,
  nameColumn: number | undefined,
): { rowNumber: number; text: string }[] {
  if (nameColumn === undefined) return [];
  const out: { rowNumber: number; text: string }[] = [];
  for (let r = headerRowIndex + 1; r < aoa.length; r++) {
    const text = String((aoa[r] || [])[nameColumn] ?? '').trim();
    if (text && SUMMARY_LABEL.test(text) && looksLikeArithmeticRow(aoa[r] || [], nameColumn)) {
      out.push({ rowNumber: r + 1, text });
    }
  }
  return out;
}

/**
 * The label alone is not enough. `SUMMARY_LABEL` matches on a word boundary, so
 * a real client called "Total Solutions W.L.L." matches it — and that is not a
 * hypothetical, it is in the fixture. Flagging every such row is noise the user
 * has to dismiss on every import, forever.
 *
 * A genuine total row is the sheet's arithmetic: a label, some numbers, and
 * nothing else. A data row that merely STARTS with "Total" still carries the
 * things that make it a record — a contact, an email, a date. So: require the
 * row's non-name cells to be empty or numeric. Two or more populated
 * non-numeric cells means it is data, whatever it is called.
 */
function looksLikeArithmeticRow(row: SheetCell[], nameColumn: number): boolean {
  let nonNumeric = 0;
  for (let c = 0; c < row.length; c++) {
    if (c === nameColumn) continue;
    const cell = String(row[c] ?? '').trim();
    if (!cell) continue;
    // Money/counts, with thousands separators, currency symbols and
    // parenthesised negatives — all still "arithmetic".
    if (/^[({[]?\s*[-+]?[$€£¥]?\s*[\d,. ]+\s*%?\s*[)}\]]?$/.test(cell)) continue;
    nonNumeric++;
    if (nonNumeric >= 2) return false;
  }
  return true;
}

/** Blank and continuation rows, both surfaced. `buildIntakeRows` already drops
 *  blanks and TAGS continuations; what it cannot do is make anyone look at
 *  them, and the caller that ignores `shape` imports a junk project named
 *  "Contracting W.L.L." (§18.4). */
export function summariseRowWarnings(
  shapes: { rowNumber: number; kind: string; text?: string; continuesRowNumber?: number }[],
  summaries: { rowNumber: number; text: string }[] = [],
): RowWarnings {
  return {
    continuations: shapes
      .filter(s => s.kind === 'continuation')
      .map(s => ({ rowNumber: s.rowNumber, text: s.text ?? '', continuesRowNumber: s.continuesRowNumber ?? 0 })),
    blankRowNumbers: shapes.filter(s => s.kind === 'blank').map(s => s.rowNumber),
    summaries,
  };
}

// ── the payload the confirmation step produces ─────────────────────────────

export type CustomFieldPlan = {
  key: string;
  label: string;
  dataType: FieldDataType;
  /** The parser's primitive, kept so a year does not render as "2,025". */
  format: FieldFormat | null;
  enumOptions: string[] | null;
  sourceColumn: string;
  columnIndex: number;
  defId: string | null;
};

/** Every column the user left pointed at a custom field, in source order. */
export function customFieldPlans(decisions: ColumnDecision[]): CustomFieldPlan[] {
  return decisions
    .filter((d): d is ColumnDecision & { target: Extract<ColumnTarget, { kind: 'custom' }> } => d.target.kind === 'custom')
    .map(d => ({
      key: d.target.key,
      label: d.target.label,
      dataType: d.target.dataType,
      // Read off the profile, not the target: the user can retype a column in
      // the mapping step, and a column they moved to Text is no longer a year.
      format: d.target.dataType === 'number' ? displayFormatForPrimitive(d.profile.primitive) : null,
      enumOptions: d.target.dataType === 'enum' ? (d.target.enumOptions ?? []) : null,
      sourceColumn: d.profile.header,
      columnIndex: d.index,
      defId: d.target.defId,
    }));
}

// ── what the batch will actually look like (§19.2 "no preview of the outcome") ─
//
// The Configure step could say "21 projects, 294 tasks" and nothing else, so a
// user had to commit before they could judge whether 294 was right, or what
// "DUE BY" had just done to every date in the file. These four functions
// reproduce the schedule arithmetic rpc_preview_instantiate_template runs
// server-side so ONE project can be shown worked out in full first.
//
// They are a MIRROR of fn_batch_offset_range / fn_resolve_batch_start_date, not
// a second definition of the rule: the caller cross-checks the batch-wide
// min/max these produce against the `first_task_date` / `last_task_date` the
// server returned, and hides the sample entirely if the two disagree. So a
// drift shows up as a missing preview, never as a confident wrong date.

/** `YYYY-MM-DD` from either a date-only string or a full ISO timestamp. */
export function isoDay(value: string): string {
  return value.slice(0, 10);
}

/** Whole-day arithmetic in UTC. Local-time `setDate` shifts across a DST
 *  boundary, which is how an off-by-one lands in exactly one month of the year. */
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${isoDay(day)}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Mirrors `fn_batch_offset_range`: a missing `due_offset_days` is day 0. */
export function batchOffsetRange(body: { due_offset_days?: number | null }[]): { min: number; max: number } {
  if (!body || body.length === 0) return { min: 0, max: 0 };
  const offsets = body.map(t => t?.due_offset_days ?? 0);
  return { min: Math.min(...offsets), max: Math.max(...offsets) };
}

/** Mirrors `fn_resolve_batch_start_date`: a deadline anchor is the day the LAST
 *  task is due, so the project starts `span` days before it. */
export function resolveBatchStartDate(anchorDay: string, direction: 'start' | 'deadline', spanDays: number): string {
  return direction === 'deadline' ? addDays(anchorDay, -spanDays) : isoDay(anchorDay);
}

export type ScheduledTask = { title: string; category: string; offsetDays: number; dueDay: string };

/**
 * One project's tasks with the date each will actually carry.
 *
 * `projectStart` is the row's own start-date override (a spreadsheet column, or
 * the `Name, 2026-08-01` textarea form); null means the row follows the batch
 * anchor. Both go through `resolveBatchStartDate` with the same direction,
 * exactly as the RPC does — a per-row date under "DUE BY" is that ROW's
 * deadline, not its start, and that is the thing nobody could see before.
 */
export function sampleProjectSchedule(
  body: { title?: string; category?: string; due_offset_days?: number | null }[],
  anchorDay: string,
  direction: 'start' | 'deadline',
  projectStart: string | null,
): ScheduledTask[] {
  const { max } = batchOffsetRange(body);
  const start = resolveBatchStartDate(projectStart ?? anchorDay, direction, max);
  return body
    .map((t, i) => {
      const offsetDays = t?.due_offset_days ?? 0;
      return {
        title: t?.title || `Task ${i + 1}`,
        category: t?.category || '',
        offsetDays,
        dueDay: addDays(start, offsetDays),
      };
    })
    .sort((a, b) => a.offsetDays - b.offsetDays);
}

/** The batch-wide first/last task day across every row, the same way the RPC
 *  computes them: MIN(start)+min_offset and MAX(start)+max_offset. This exists
 *  to be compared against the server's answer, not to replace it. */
export function batchSpan(
  body: { due_offset_days?: number | null }[],
  anchorDay: string,
  direction: 'start' | 'deadline',
  projectStarts: (string | null)[],
): { firstDay: string; lastDay: string } | null {
  if (projectStarts.length === 0) return null;
  const { min, max } = batchOffsetRange(body);
  const starts = projectStarts.map(s => resolveBatchStartDate(s ?? anchorDay, direction, max)).sort();
  return { firstDay: addDays(starts[0], min), lastDay: addDays(starts[starts.length - 1], max) };
}

/**
 * The scalar we would store for one (row, custom field). Returns `null` for a
 * blank cell — `rpc_set_project_field_values` treats null as "clear", which is
 * right: a blank spreadsheet cell must not become the string "".
 *
 * Deliberately does NOT parse: the classifier already decided the column's
 * type, and re-deriving it per cell is exactly the per-cell guessing §18.4
 * forbids. The caller passes the column's resolved parser in.
 */
export function cellToFieldValue(
  raw: SheetCell,
  dataType: FieldDataType,
  parseDate: (c: SheetCell) => string | null,
  parseNumber: (c: SheetCell) => number | null,
): string | number | boolean | null {
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  const text = String(raw).trim();
  switch (dataType) {
    case 'number': return parseNumber(raw);
    case 'date': return parseDate(raw);
    case 'boolean': {
      const k = normalizeMatchKey(text);
      if (k === 'yes' || k === 'y' || k === 'true' || k === '1') return true;
      if (k === 'no' || k === 'n' || k === 'false' || k === '0') return false;
      return null;
    }
    default: return text;
  }
}
