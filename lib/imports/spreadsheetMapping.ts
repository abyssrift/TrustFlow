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
//
// PHASE 9 REDESIGN (plan §18): headers are not the signal, content is. The
// header-regex layer below is now a *nomination* layer only — it can raise a
// candidate the cell content already supports, and can never assign a field on
// its own. See §18.1: `/\bname\b/i` matched "Name of focal Point" (a contact
// person) before "Company Name" and named every project after the wrong human.
// Everything in section 0 exists to stop that class of failure.

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

// ─── 1b. Profile the CONTENT (plan §18.1) ─────────────────────────────────
// Industry-neutral primitives. "Audit status" is not a universal concept; "a
// column holding two repeated values" is. Nothing here reads a header.

export type ColumnPrimitive =
  | 'email' | 'phone' | 'date' | 'year' | 'money'
  | 'unique_id' | 'enum' | 'freetext' | 'empty' | 'unknown';

export type PrimitiveCandidate = {
  primitive: ColumnPrimitive;
  /** fraction of NON-EMPTY cells this primitive explains, 0..1 */
  coverage: number;
  /** coverage folded with how trustworthy the primitive is, plus any header nudge */
  confidence: number;
};

export type DateOrder = 'DMY' | 'MDY' | 'ambiguous';

export type ColumnProfile = {
  index: number;
  header: string;
  primitive: ColumnPrimitive;
  /** coverage of the WINNING primitive — "Expected date" is a date column at 0.62, not a boolean */
  coverage: number;
  confidence: number;
  filled: number;
  rows: number;
  fillRate: number;
  /** distinct values by normalizeMatchKey — "Abdallah kamel" and "Abdallah Kamel" count once */
  distinct: number;
  /** majority of filled cells contain a letter (so a numeric id never becomes an entity name) */
  textual: boolean;
  /** every primitive that cleared threshold, best first. The caller sees the runners-up. */
  candidates: PrimitiveCandidate[];
  /** what the HEADER text nominated. Never sufficient on its own — compare with `primitive`. */
  headerHint: ColumnPrimitive | null;
  /** §18.2 rule 2: enums, ambiguous date orders and low confidence are where the product asks */
  needsConfirmation: boolean;
  /** only set when the column actually contains d/m/y-style text dates */
  dateOrder?: DateOrder;
  /** normalized key -> first-seen original spelling. Case/whitespace variants collapse; originals survive. */
  enumValues?: { key: string; label: string; count: number }[];
  /** up to 5 filled cells the winning primitive does NOT explain — the caller shows these, never nulls them silently */
  nonMatchingSamples: string[];
};

const isEmptyCell = (c: SheetCell): boolean =>
  c === null || c === undefined || String(c).trim() === '';

/**
 * Case/whitespace/diacritic-insensitive match key. Used for enum grouping and
 * distinct counts. Deliberately NON-destructive of the caller's string: it
 * returns a key, the original is always kept alongside it (`enumValues.label`).
 * Unlike `normalizeClientName` it does NOT strip business suffixes — collapsing
 * "Bitumen Trading" to "Bitumen" is right for client matching and wrong for
 * telling two enum values apart.
 */
export function normalizeMatchKey(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// ── cell-level detectors ──────────────────────────────────────────────────

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+/gi;
const ANGLE_EMAIL_RE = /([^<>,;]*?)<\s*([^<>\s,;]+@[^<>\s,;]+?)\s*>/g;

/**
 * `Display Name <a@b.com> , Other <c@d.com>` -> two entries, display names kept.
 * Bare addresses and malformed trailing punctuation (`x@y.qa'`) are handled by
 * the same pass. Returns [] for a cell with no address at all.
 */
export function parseEmailCell(cell: SheetCell): { address: string; displayName: string | null }[] {
  const s = String(cell ?? '');
  if (!s.includes('@')) return [];
  const out: { address: string; displayName: string | null }[] = [];
  const push = (address: string, displayName: string | null) => {
    const a = address.toLowerCase();
    if (!out.some(e => e.address === a)) out.push({ address: a, displayName });
  };
  ANGLE_EMAIL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ANGLE_EMAIL_RE.exec(s)) !== null) push(m[2], m[1].trim() || null);
  EMAIL_RE.lastIndex = 0;
  for (const bare of s.match(EMAIL_RE) || []) push(bare, null);
  return out;
}

const CCY = 'qar|usd|aed|sar|eur|gbp|kwd|omr|bhd';
const MONEY_RE = new RegExp(
  `^(?:${CCY})?\\s*[+-]?[$€£¥]?\\s*\\(?\\s*[+-]?[\\d,]*\\d(?:\\.\\d+)?\\s*\\)?\\s*(?:${CCY})?$`,
  'i',
);

/** "8,000" -> 8000. Returns the number that IS there; never reconciles it with
 * anything else (plan §18.4 / §13.9 — a silently "corrected" total is worse
 * than a wrong one, because it looks chosen). */
export function parseMoneyCell(cell: SheetCell): number | null {
  if (isEmptyCell(cell)) return null;
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : null;
  if (typeof cell === 'boolean') return null;
  const s = String(cell).trim();
  if (!MONEY_RE.test(s)) return null;
  const negative = /^\(.*\)$/.test(s) || s.startsWith('-');
  const n = Number(s.replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

const ISO_DATE_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/;
const SLASH_DATE_RE = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/;
const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const TEXT_DATE_RE = new RegExp(`^(\\d{1,2})[\\s.\\-]+(${MONTH_NAMES.join('|')})[a-z]*[\\s.,\\-]+(\\d{2,4})$`, 'i');

// ponytail: an Excel serial is just a number, so a money column whose values
// all land in 20 000–80 000 reads as dates. Ceiling accepted because the real
// fix belongs one layer up: spreadsheetIntake.ts can pass `cellDates: true` to
// sheet_to_json and hand us real Date-typed cells, at which point this range
// guess is dead code. Raise it there, not here.
const SERIAL_MIN = 20000;
const SERIAL_MAX = 80000;

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) =>
  m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(m)}-${pad(d)}` : null;

/**
 * Strict date parse -> `YYYY-MM-DD`, or null. Handles ISO, Excel serials,
 * `d/m/y` (order supplied PER COLUMN by `resolveDateOrder`, never guessed per
 * cell) and `5 Jan 2026`. Deliberately does NOT fall through to `new Date(s)`:
 * V8 reads "8/2/26" as August 2nd in the local timezone, which is exactly the
 * per-cell guess §18.4 forbids.
 */
export function parseDateValue(cell: SheetCell, order: DateOrder = 'DMY'): string | null {
  if (isEmptyCell(cell)) return null;
  if (typeof cell === 'number') {
    if (cell < SERIAL_MIN || cell > SERIAL_MAX) return null;
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(cell) * 86400000);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const s = String(cell).trim();
  const iso = ISO_DATE_RE.exec(s);
  if (iso) return ymd(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const slash = SLASH_DATE_RE.exec(s);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    // 'ambiguous' still has to produce something for a preview; DMY is the
    // majority convention outside the US AND is what the caller is being asked
    // to confirm. The profile flags the column so the question gets asked once.
    const [day, month] = order === 'MDY' ? [b, a] : [a, b];
    let year = Number(slash[3]);
    if (year < 100) year += year < 70 ? 2000 : 1900;
    return ymd(year, month, day);
  }
  const text = TEXT_DATE_RE.exec(s);
  if (text) {
    let year = Number(text[3]);
    if (year < 100) year += year < 70 ? 2000 : 1900;
    return ymd(year, MONTH_NAMES.indexOf(text[2].toLowerCase()) + 1, Number(text[1]));
  }
  return null;
}

export function looksLikeDateCell(cell: SheetCell): boolean {
  return parseDateValue(cell) !== null;
}

/**
 * DD/MM vs MM/DD, decided ONCE for the whole column by looking for a value > 12
 * in the first position (plan §18.4). Returns 'ambiguous' when no cell is
 * decisive or when cells contradict each other — the caller asks about the
 * column, not about 400 individual cells. Returns undefined when the column has
 * no slash-style dates at all, so the question is never asked pointlessly.
 */
export function resolveDateOrder(cells: SheetCell[]): DateOrder | undefined {
  let slashes = 0;
  let firstOver12 = 0;
  let secondOver12 = 0;
  for (const c of cells) {
    const m = SLASH_DATE_RE.exec(String(c ?? '').trim());
    if (!m) continue;
    slashes++;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 12 && b <= 12) firstOver12++;
    if (b > 12 && a <= 12) secondOver12++;
  }
  if (slashes === 0) return undefined;
  if (firstOver12 > 0 && secondOver12 === 0) return 'DMY';
  if (secondOver12 > 0 && firstOver12 === 0) return 'MDY';
  return 'ambiguous';
}

function segmentIsPhone(seg: string): boolean {
  const s = seg.trim();
  if (!s) return false;
  const digits = s.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 20) return false;
  // A bare integer is only a phone at phone-ish length; anything with phone
  // punctuation (+, (), -, spaces) is one at any length in range.
  return /^\d+$/.test(s) ? digits.length <= 12 : /[+()\-\s]/.test(s);
}

/** `4340117 / +974 7743 3004 (shafeeq)` -> two numbers. Same multi-value shape
 * as the Emails column; splitting first is what keeps a two-number cell from
 * failing a single-number length check. */
export function parsePhoneCell(cell: SheetCell): string[] {
  if (isEmptyCell(cell)) return [];
  const s = String(cell).trim();
  if (s.includes('@')) return [];
  if (looksLikeDateCell(cell)) return []; // "25/1/2026" has 7 digits too
  return s.split(/[/,;]|\bor\b/i).filter(segmentIsPhone).map(seg => seg.trim());
}

export function looksLikePhoneCell(cell: SheetCell): boolean {
  return parsePhoneCell(cell).length > 0;
}

// ── column-level profile ──────────────────────────────────────────────────

// Selection is by this order among primitives that CLEAR the coverage
// threshold — not by confidence, so the outcome is predictable and explainable
// ("date beat money because both explain the cells and dates rank higher").
const PRIMITIVE_PRIORITY: ColumnPrimitive[] = [
  'email', 'phone', 'date', 'year', 'unique_id', 'money', 'enum', 'freetext',
];

// How much a primitive is worth when it fully covers a column. enum is capped
// low on purpose — §18.2 rule 2, an enum is always a question.
const PRIMITIVE_WEIGHT: Record<ColumnPrimitive, number> = {
  email: 0.95, phone: 0.9, date: 0.9, year: 0.9, money: 0.9,
  unique_id: 0.85, enum: 0.7, freetext: 0.5, empty: 1, unknown: 0.2,
};

const COVERAGE_THRESHOLD = 0.5; // a primitive must explain a MAJORITY of filled cells
const MAX_ENUM_VALUES = 12;
const HEADER_BOOST = 0.1;

// The header's ONLY job: nominate. A hint that the content does not already
// support is recorded on the profile and otherwise ignored — "Proposed fee"
// hints money and profiles as `empty`, which is the whole point.
const HEADER_HINTS: { primitive: ColumnPrimitive; pattern: RegExp }[] = [
  { primitive: 'email', pattern: /e-?mail/i },
  { primitive: 'phone', pattern: /\b(phone|mobile|tel|cell|whatsapp)\b|contact\s*(no|number)/i },
  { primitive: 'year', pattern: /\byear\b|\bfy\b/i },
  { primitive: 'date', pattern: /\bdate\b|deadline|\bdue\b|expected|start|schedul|deliver/i },
  { primitive: 'money', pattern: /\bfee\b|amount|price|cost|total|budget|revenue|invoice|salary|charge|\bvalue\b/i },
  { primitive: 'unique_id', pattern: /\b(id|no|num|number|code|ref|reference|sl|serial)\b/i },
];

export function headerHintFor(header: string): ColumnPrimitive | null {
  const t = header.trim();
  if (!t) return null;
  return HEADER_HINTS.find(h => h.pattern.test(t))?.primitive ?? null;
}

/**
 * Profile EVERY column of the table below `headerRowIndex` — including the
 * entirely-empty ones. The returned array is dense and indexed by column, so
 * "zero columns silently discarded" (plan §18.5 #1) is structural rather than a
 * promise: a caller that iterates the result cannot miss one.
 */
export function profileColumns(aoa: SheetCell[][], headerRowIndex: number): ColumnProfile[] {
  const headers = aoa[headerRowIndex] || [];
  const body = aoa.slice(headerRowIndex + 1);
  // reduce, not Math.max(...spread) — a 5 000-row sheet would blow the arg limit
  const width = body.reduce((w, r) => Math.max(w, (r || []).length), headers.length);
  const out: ColumnProfile[] = [];
  for (let col = 0; col < width; col++) {
    out.push(profileColumn(String(headers[col] ?? '').trim(), body.map(r => (r || [])[col]), col));
  }
  return out;
}

export function profileColumn(header: string, cells: SheetCell[], index = 0): ColumnProfile {
  const rows = cells.length;
  const filledCells = cells.filter(c => !isEmptyCell(c));
  const filled = filledCells.length;
  const headerHint = headerHintFor(header);

  const counts = new Map<string, { key: string; label: string; count: number }>();
  for (const c of filledCells) {
    const label = String(c).trim();
    const key = normalizeMatchKey(label);
    const hit = counts.get(key);
    if (hit) hit.count++;
    else counts.set(key, { key, label, count: 1 });
  }
  const distinct = counts.size;
  const letters = filledCells.filter(c => /[a-z]/i.test(String(c))).length;
  const textual = filled > 0 && letters / filled >= 0.5;

  const base: ColumnProfile = {
    index, header, primitive: 'empty', coverage: 0, confidence: 1,
    filled, rows, fillRate: rows > 0 ? filled / rows : 0,
    distinct, textual, candidates: [], headerHint,
    needsConfirmation: false, nonMatchingSamples: [],
  };
  if (filled === 0) return base;

  const frac = (pred: (c: SheetCell) => boolean) => filledCells.filter(pred).length / filled;

  const emailCov = frac(c => parseEmailCell(c).length > 0);
  const phoneCov = frac(looksLikePhoneCell);
  const dateCov = frac(looksLikeDateCell);
  const moneyCov = frac(c => parseMoneyCell(c) !== null);
  const yearCov = frac(c => {
    const n = parseMoneyCell(c);
    return n !== null && Number.isInteger(n) && n >= 1900 && n <= 2100 && !String(c).includes('.');
  });
  // Structural, not per-cell: a column of perfectly unique, mostly-populated,
  // non-zero values is an identifier (a company name, a CR number, an SL no).
  // A repeated value can never be one — which is precisely why "Name of focal
  // Point" (Mohammed Ayyash x10) cannot become the entity name.
  const alnum = filledCells.filter(c => /[a-z0-9]/i.test(String(c))).length;
  const uniqueCov =
    // ponytail: 3 is the smallest sample where "no value repeats" says anything
    // at all. Below that every column is trivially unique and the caller is
    // confirming a coin flip — which is what the confirmation step is for.
    distinct === filled && filled >= 3 && base.fillRate >= 0.5 &&
    alnum / filled >= 0.5 && // a column of "###"/"%%" is not an identifier
    !filledCells.some(c => parseMoneyCell(c) === 0) ? 1 : 0;
  // A small vocabulary that actually repeats. `distinct * 2 <= filled` keeps a
  // sparse column of one-off strings (3 job titles in 3 rows) out of it.
  const enumCov =
    distinct <= MAX_ENUM_VALUES && distinct * 2 <= filled &&
    [...counts.values()].every(v => v.label.length <= 60) ? 1 : 0;
  const freetextCov = letters / filled;

  const raw: Record<string, number> = {
    email: emailCov, phone: phoneCov, date: dateCov, year: yearCov,
    money: moneyCov, unique_id: uniqueCov, enum: enumCov, freetext: freetextCov,
  };

  const candidates: PrimitiveCandidate[] = PRIMITIVE_PRIORITY
    .filter(p => raw[p] >= COVERAGE_THRESHOLD)
    .map(p => ({
      primitive: p,
      coverage: Math.round(raw[p] * 100) / 100,
      confidence: Math.round(
        Math.min(1, raw[p] * PRIMITIVE_WEIGHT[p] + (headerHint === p ? HEADER_BOOST : 0)) * 100,
      ) / 100,
    }));

  // freetext is a FALLBACK, never a competitor — it "covers" any column with
  // letters in it, so letting it race would beat every real signal.
  const ranked = candidates.filter(c => c.primitive !== 'freetext');
  const winner =
    ranked[0] ??
    candidates.find(c => c.primitive === 'freetext') ??
    { primitive: 'unknown' as ColumnPrimitive, coverage: 0, confidence: PRIMITIVE_WEIGHT.unknown };

  const explains = (c: SheetCell): boolean => {
    switch (winner.primitive) {
      case 'email': return parseEmailCell(c).length > 0;
      case 'phone': return looksLikePhoneCell(c);
      case 'date': return looksLikeDateCell(c);
      case 'year': case 'money': return parseMoneyCell(c) !== null;
      default: return true;
    }
  };

  const profile: ColumnProfile = {
    ...base,
    primitive: winner.primitive,
    coverage: winner.coverage,
    confidence: winner.confidence,
    candidates,
    nonMatchingSamples: filledCells.filter(c => !explains(c)).slice(0, 5).map(c => String(c).trim()),
  };
  if (winner.primitive === 'enum') {
    profile.enumValues = [...counts.values()].sort((a, b) => b.count - a.count);
  }
  if (winner.primitive === 'date') {
    const order = resolveDateOrder(filledCells);
    if (order) profile.dateOrder = order;
  }
  profile.needsConfirmation =
    profile.primitive === 'enum' ||
    profile.primitive === 'unknown' ||
    profile.dateOrder === 'ambiguous' ||
    profile.confidence < 0.6;
  return profile;
}

/**
 * The entity name — the regression that motivated the whole redesign (§18.5 #2).
 * Content decides: a name column is TEXTUAL, mostly populated, and its values do
 * not repeat. The header may only re-rank columns that already qualify, so
 * "Name of focal Point" is structurally excluded (10 rows say "Mohammed
 * Ayyash") no matter how name-ish its header reads.
 */
export function rankEntityNameColumns(
  profiles: ColumnProfile[],
  headerBoost: (header: string) => number = () => 0,
  exclude: ReadonlySet<number> = new Set(),
): { index: number; score: number; confidence: number; reason: string }[] {
  return profiles
    .filter(p =>
      !exclude.has(p.index) &&
      p.textual &&
      p.filled > 0 &&
      (p.primitive === 'unique_id' || p.primitive === 'freetext' || p.primitive === 'enum'),
    )
    .map(p => {
      const uniqueBonus = p.primitive === 'unique_id' ? 0.5 : 0;
      const enumPenalty = p.primitive === 'enum' ? -0.5 : 0;
      const hb = headerBoost(p.header);
      return {
        index: p.index,
        score: uniqueBonus + enumPenalty + p.fillRate + hb,
        confidence: Math.round(Math.min(1, 0.4 + uniqueBonus + hb * 0.5) * 100) / 100,
        reason: [
          p.primitive === 'unique_id' ? 'values are unique' : `values repeat (${p.distinct} distinct of ${p.filled})`,
          `${Math.round(p.fillRate * 100)}% populated`,
          hb > 0 ? 'header agrees' : 'header neutral',
        ].join(', '),
      };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index);
}

// ─── 1b-ii. Column CONTEXT (a second pass over the sequence) ───────────────
// Prior art: Sherlock classifies each column in isolation and is weak on the
// less common types; its successor Sato adds table-level and neighbouring-column
// context and lands ~0.925 F1. We are not doing ML — no corpus, no inference
// infra, and the confirmation step covers what a model would buy us — but the
// finding transfers for free: `AUDIT 2025 | ARABIC3 2025 | TAX | TOTAL A&T 2025`
// are four identical MONEY columns one at a time, and a fee breakdown plus its
// total as a neighbourhood.
//
// Deliberately a SEPARATE pass consuming finished profiles: single-column
// classification stays testable on its own, and a relationship can never
// quietly change a column's primitive.

export type ColumnRelation =
  /** adjacent columns of the same primitive — a fee breakdown, a date pair */
  | { kind: 'sibling_group'; primitive: ColumnPrimitive; columns: number[] }
  /** one sibling's header says TOTAL: it is a sum OF the others, not a fifth service */
  | { kind: 'total_of'; total: number; components: number[]; reconciles: boolean; mismatchRowNumbers: number[] }
  /** a person column followed by their phone/email — one contact, not three fields */
  | { kind: 'contact_block'; columns: number[]; anchor: number | null }
  /** table-level: one dominant year, echoed in sibling headers — a single-period register */
  | { kind: 'single_period'; year: string; columns: number[] };

// Only money and date runs are worth grouping. Adjacent enums ("Audit status",
// "Service", "Planned auditor") are unrelated categories that happen to sit
// next to each other; grouping those would be noise the user has to dismiss.
const GROUPABLE: ColumnPrimitive[] = ['money', 'date'];
const TOTAL_HEADER = /\btotals?\b|\bsum\b|\bgrand\b|\bnet\b|\boverall\b/i;

/**
 * @param aoa           the full sheet, so a stated total can be COMPARED with
 *                      its components — and only compared. Nothing here rewrites
 *                      a number: §18.4 is explicit that when row 3's 4,000 + 0 +
 *                      1,000 disagrees with its stated TOTAL of 3,000 we import
 *                      what is there and say so. `reconciles: false` is the
 *                      whole output, and it is a finding, not a fix.
 */
export function detectColumnRelations(
  profiles: ColumnProfile[],
  aoa: SheetCell[][],
  headerRowIndex: number,
): ColumnRelation[] {
  const out: ColumnRelation[] = [];
  const prim = (i: number) => profiles[i]?.primitive;

  // 1. runs of >= 2 adjacent same-primitive columns
  const groups: { primitive: ColumnPrimitive; columns: number[] }[] = [];
  for (let i = 0; i < profiles.length; i++) {
    const p = prim(i);
    if (!GROUPABLE.includes(p)) continue;
    let j = i;
    while (j + 1 < profiles.length && prim(j + 1) === p) j++;
    if (j > i) groups.push({ primitive: p, columns: Array.from({ length: j - i + 1 }, (_, k) => i + k) });
    i = j;
  }
  for (const g of groups) out.push({ kind: 'sibling_group', primitive: g.primitive, columns: g.columns });

  // 2. a TOTAL inside a money sibling group is a sum OF the rest
  for (const g of groups) {
    if (g.primitive !== 'money') continue;
    const total = g.columns.find(c => TOTAL_HEADER.test(profiles[c].header));
    if (total === undefined) continue;
    const components = g.columns.filter(c => c !== total);
    if (components.length === 0) continue;
    const mismatchRowNumbers: number[] = [];
    for (let r = headerRowIndex + 1; r < aoa.length; r++) {
      const row = aoa[r] || [];
      const stated = parseMoneyCell(row[total]);
      if (stated === null) continue;
      const parts = components.map(c => parseMoneyCell(row[c])).filter((n): n is number => n !== null);
      if (parts.length === 0) continue;
      if (Math.abs(parts.reduce((a, b) => a + b, 0) - stated) > 0.005) mismatchRowNumbers.push(r + 1);
    }
    out.push({
      kind: 'total_of', total, components,
      reconciles: mismatchRowNumbers.length === 0,
      mismatchRowNumbers,
    });
  }

  // 3. contact block: a phone and an email within 3 columns of each other,
  //    extended left over free-text columns to reach the person they belong to.
  const emails = profiles.filter(p => p.primitive === 'email').map(p => p.index);
  const phones = profiles.filter(p => p.primitive === 'phone').map(p => p.index);
  const seen = new Set<number>();
  for (const e of emails) {
    const p = phones.find(x => Math.abs(x - e) <= 3);
    if (p === undefined || seen.has(e)) continue;
    seen.add(e);
    let lo = Math.min(e, p);
    const hi = Math.max(e, p);
    while (lo - 1 >= 0 && prim(lo - 1) === 'freetext') lo--;
    const columns = Array.from({ length: hi - lo + 1 }, (_, k) => lo + k);
    out.push({
      kind: 'contact_block', columns,
      anchor: columns.find(c => prim(c) === 'freetext') ?? null,
    });
  }

  // 4. table-level: one dominant year, echoed in other column headers
  for (const p of profiles) {
    if (p.primitive !== 'year') continue;
    const cells = aoa.slice(headerRowIndex + 1).map(r => (r || [])[p.index]).filter(c => !isEmptyCell(c));
    const counts = new Map<string, number>();
    for (const c of cells) counts.set(String(c).trim(), (counts.get(String(c).trim()) ?? 0) + 1);
    const [year, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
    if (!year || n / cells.length < 0.8) continue;
    const echoes = profiles.filter(q => q.index !== p.index && q.header.includes(year)).map(q => q.index);
    if (echoes.length > 0) out.push({ kind: 'single_period', year, columns: [p.index, ...echoes] });
  }
  return out;
}

// ─── 1c. Row shape (plan §18.4) ───────────────────────────────────────────

export type RowKind = 'data' | 'blank' | 'continuation';

export type RowShape = {
  rowIndex: number;  // 0-based index into the AOA
  rowNumber: number; // 1-based spreadsheet row, for user-facing messages
  kind: RowKind;
  filled: number;
  /** for a continuation: the 1-based row it appears to continue */
  continuesRowNumber?: number;
  /** for a continuation: the stray text, so the UI can offer "append to previous" */
  text?: string;
};

/**
 * A row whose ONLY populated cell sits in the name column, directly after a
 * populated row, is source-file line wrap — `["", "Contracting W.L.L.", ""...]`
 * is the tail of the previous company, not a company. It is surfaced as its own
 * kind and NEVER merged or imported automatically: both of those are silent
 * data changes, and §13.9 already settled that a silent default is worse than a
 * question.
 */
export function classifyRowShapes(
  aoa: SheetCell[][],
  headerRowIndex: number,
  nameColumn: number | undefined,
): RowShape[] {
  const out: RowShape[] = [];
  let lastDataRowNumber: number | null = null;
  for (let r = headerRowIndex + 1; r < aoa.length; r++) {
    const row = aoa[r] || [];
    const filled = scoreRow(row);
    const rowNumber = r + 1;
    if (filled === 0) {
      out.push({ rowIndex: r, rowNumber, kind: 'blank', filled: 0 });
      continue;
    }
    const onlyCol = filled === 1 ? row.findIndex(c => !isEmptyCell(c)) : -1;
    if (onlyCol !== -1 && onlyCol === nameColumn && lastDataRowNumber !== null) {
      out.push({
        rowIndex: r, rowNumber, kind: 'continuation', filled,
        continuesRowNumber: lastDataRowNumber,
        text: String(row[onlyCol]).trim(),
      });
      continue;
    }
    out.push({ rowIndex: r, rowNumber, kind: 'data', filled });
    lastDataRowNumber = rowNumber;
  }
  return out;
}

// ─── 2. Map the columns ───────────────────────────────────────────────────

type Rule = { field: MappedField; patterns: RegExp[]; weight: number };

// NOMINATION ONLY (plan §18.2 rule 1). These patterns can no longer assign a
// field by themselves — `proposeColumnMapping` requires a matching content
// primitive first. Kept as the vocabulary that says WHICH of several equally
// content-valid columns the user means (a file may hold three date columns and
// only the header distinguishes "Expected date" from "Follow -up Status").
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

const ruleFor = (field: MappedField) => RULES.find(r => r.field === field)!;
const headerNominates = (field: MappedField, header: string) =>
  header.trim() !== '' && ruleFor(field).patterns.some(p => p.test(header));

/** Content primitives that can plausibly BE the given field. A header pointing
 * at a column whose content contradicts it is ignored — the whole §18.2 rule 1. */
const FIELD_CONTENT: Record<MappedField, (p: ColumnProfile) => boolean> = {
  name: p => p.textual && (p.primitive === 'unique_id' || p.primitive === 'freetext' || p.primitive === 'enum'),
  client_ref: p => p.textual && (p.primitive === 'unique_id' || p.primitive === 'freetext' || p.primitive === 'enum'),
  client_external_ref: p => p.primitive === 'unique_id',
  start_date: p => p.primitive === 'date',
};

export type MappingProposal = {
  mapping: ColumnMapping;
  confidence: ColumnConfidence;
  /** every column, dense and index-aligned — plan §18.5 #1's "zero discarded", structurally */
  profiles: ColumnProfile[];
  /** column indexes carrying real data that no MappedField claimed. NOT junk —
   * these are §18.3's custom-field candidates, and the caller must offer them. */
  unmapped: number[];
  /** why `name` landed where it did, so the UI can show it instead of a bare guess */
  nameReason: string | null;
};

/**
 * Content-first field proposal (plan §18.2 rule 1). Order of operations:
 *
 * 1. profile every column from the cells — no header is read;
 * 2. `client_external_ref` and `start_date` need BOTH a content primitive that
 *    supports them AND a header nomination, because a file can hold several
 *    unique-id or date columns and only the header says which one is meant;
 * 3. `name` is decided by content ranking (unique, populated, textual) with the
 *    header as a tie-break only — this is what stops `/\bname\b/i` handing every
 *    project the focal point's name (§18.1);
 * 4. `client_ref` mirrors `name` unless a separately-nominated client column
 *    exists, preserving the paste-textarea convention BulkCreateProjectsSheet
 *    already relies on.
 *
 * Confidence is per field and always reflects the CONTENT coverage, so a
 * half-prose "Expected date" arrives at ~0.5, not as a silent success.
 */
export function proposeColumnMapping(
  headers: SheetCell[],
  sampleRows: SheetCell[][],
): MappingProposal {
  const profiles = profileColumns([headers, ...sampleRows], 0);
  const mapping: ColumnMapping = {};
  const confidence: ColumnConfidence = {};
  const claimed = new Set<number>();

  // (2) most specific fields first, each needing content support + a nomination.
  for (const field of ['client_external_ref', 'start_date'] as const) {
    const hit = profiles
      .filter(p => !claimed.has(p.index) && FIELD_CONTENT[field](p) && headerNominates(field, p.header))
      .sort((a, b) => b.coverage - a.coverage || a.index - b.index)[0];
    if (!hit) continue;
    mapping[field] = hit.index;
    confidence[field] = Math.round(ruleFor(field).weight * hit.coverage * 100) / 100;
    claimed.add(hit.index);
  }

  // (3) the entity name — content ranks, header only re-ranks.
  const nameBoost = (h: string) => (headerNominates('name', h) ? 0.3 : 0);
  const ranked = rankEntityNameColumns(profiles, nameBoost, claimed);
  const nameHit = ranked[0];
  if (nameHit) {
    mapping.name = nameHit.index;
    confidence.name = nameHit.confidence;
  }

  // (4) client column: a distinctly-nominated one wins, else mirror the name.
  const clientHit = profiles
    .filter(p => p.index !== mapping.name && !claimed.has(p.index) &&
      FIELD_CONTENT.client_ref(p) && headerNominates('client_ref', p.header))
    .sort((a, b) => b.fillRate - a.fillRate || a.index - b.index)[0];
  if (clientHit) {
    mapping.client_ref = clientHit.index;
    confidence.client_ref = Math.round(ruleFor('client_ref').weight * clientHit.fillRate * 100) / 100;
    claimed.add(clientHit.index);
  } else if (mapping.name !== undefined) {
    mapping.client_ref = mapping.name;
    confidence.client_ref = confidence.name;
  }
  if (mapping.name !== undefined) claimed.add(mapping.name);

  // An unclaimed column with a header or any data is a §18.3 custom-field
  // candidate, INCLUDING an all-empty one the firm clearly meant to have
  // ("Proposed fee"). Only unheaded padding columns drop out.
  const unmapped = profiles
    .filter(p => !claimed.has(p.index) && (p.header !== '' || p.filled > 0))
    .map(p => p.index);

  return { mapping, confidence, profiles, unmapped, nameReason: nameHit?.reason ?? null };
}

// ─── 3. Extract typed rows ────────────────────────────────────────────────

export type IntakeRow = {
  rowNumber: number; // 1-based spreadsheet row (for user-facing messages)
  name: string;
  client_ref: string;
  client_external_ref: string | null;
  start_date: string | null; // ISO, or null if blank/unparseable
  start_date_raw: string | null; // original cell text, for showing a parse failure
  /** 'data' or 'continuation' (plan §18.4). A continuation row is RETURNED, not
   * dropped and not merged — the caller must show it and let a human decide. */
  shape: RowKind;
  /** for a continuation: the 1-based row whose name this text appears to continue */
  continuesRowNumber?: number;
};

function parseDateCell(raw: SheetCell, order: DateOrder): { iso: string | null; raw: string | null } {
  if (isEmptyCell(raw)) return { iso: null, raw: null };
  const ymdStr = parseDateValue(raw, order);
  return { iso: ymdStr ? `${ymdStr}T00:00:00.000Z` : null, raw: String(raw) };
}

/**
 * Turn the raw AOA + a confirmed mapping into typed rows.
 *
 * Two things are deliberately NOT silent here:
 * - Blank names are KEPT with an empty `name` (the #182 failure mode).
 * - Continuation rows are KEPT and tagged `shape: 'continuation'`, so a caller
 *   that ignores `shape` creates a junk project and a caller that reads it can
 *   ask. Dropping them here would look identical to a clean import (§13.9).
 *
 * `dateOrder` comes from the column profile (`resolveDateOrder`) and is applied
 * to the whole column — never re-guessed per cell.
 */
export function buildIntakeRows(
  aoa: SheetCell[][],
  headerRowIndex: number,
  mapping: ColumnMapping,
  dateOrder: DateOrder = 'DMY',
): IntakeRow[] {
  const shapes = new Map(
    classifyRowShapes(aoa, headerRowIndex, mapping.name).map(s => [s.rowIndex, s]),
  );
  const rows: IntakeRow[] = [];
  for (let r = headerRowIndex + 1; r < aoa.length; r++) {
    const row = aoa[r] || [];
    const shape = shapes.get(r);
    if (!shape || shape.kind === 'blank') continue; // fully blank row — not a data row at all
    const cell = (field: MappedField): SheetCell => {
      const idx = mapping[field];
      return idx === undefined ? undefined : row[idx];
    };
    const { iso, raw } = parseDateCell(cell('start_date'), dateOrder);
    rows.push({
      rowNumber: r + 1,
      name: String(cell('name') ?? '').trim(),
      client_ref: String(cell('client_ref') ?? '').trim(),
      client_external_ref: String(cell('client_external_ref') ?? '').trim() || null,
      start_date: iso,
      start_date_raw: raw,
      shape: shape.kind,
      ...(shape.continuesRowNumber !== undefined ? { continuesRowNumber: shape.continuesRowNumber } : {}),
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
  return normalizeMatchKey(s)
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
