// Honest benchmark for the Phase 9 spreadsheet classifier against the
// multi-industry corpus in ./corpus.ts.
//
//   npx tsx lib/imports/testCorpus/benchmark.ts          # full report
//   npx tsx lib/imports/testCorpus/benchmark.ts --wrong  # only the failures
//
// Every workbook is written to real .xlsx bytes and read back with production's
// own `sheet_to_json` options before a single classifier function is called, so
// what is measured is the pipeline, not a hand-fed array.
//
// This file MEASURES ONLY. It does not import anything that could change the
// classifier's behaviour and it exits 0 regardless of the score — a benchmark
// that fails the build is a benchmark people delete.

import {
  detectHeaderRow,
  profileColumns,
  proposeColumnMapping,
  classifyRowShapes,
  type ColumnPrimitive,
  type ColumnProfile,
  type DateOrder,
  type RowKind,
  type SheetCell,
} from '../spreadsheetMapping';
import { CORPUS, type WorkbookSpec } from './corpus';
import { roundTrip } from './generate';

export type WrongColumn = {
  index: number;
  header: string;
  expected: ColumnPrimitive;
  got: ColumnPrimitive;
  coverage: number;
  note?: string;
};

export type FileResult = {
  id: string;
  industry: string;
  /** the classifier never found a table at all */
  fatal: string | null;
  headerRowExpected: number;
  headerRowGot: number;
  columnsExpected: number;
  columnsGot: number;
  /** columns whose winning primitive is `unknown`, or `empty` where data exists */
  unclassified: string[];
  primitivesOk: number;
  primitivesWrong: WrongColumn[];
  nameExpected: number | null;
  nameGot: number | undefined;
  nameOk: boolean;
  nameDetail: string;
  dateCorrect: string[];
  dateWrong: string[];
  dateAmbiguous: string[];
  dateUnavailable: string[];
  trapsCaught: string[];
  trapsMissed: string[];
  /** columns neither mapped to a field nor offered as a custom field */
  dropped: number;
};

const primitiveOf = (p: ColumnProfile | undefined): ColumnPrimitive => p?.primitive ?? 'unknown';

/** Locate the spec's header row inside the read-back sheet (blank rows above it are gone). */
function expectedHeaderRowAfterRoundTrip(spec: WorkbookSpec, aoa: SheetCell[][]): number {
  const key = (row: SheetCell[]) =>
    row.map(c => String(c ?? '').trim()).filter(Boolean).join('');
  const want = key(spec.aoa[spec.headerRow] ?? []);
  return aoa.findIndex(r => key(r || []) === want);
}

function findRow(aoa: SheetCell[][], from: number, marker: string): number {
  for (let r = from; r < aoa.length; r++) {
    if ((aoa[r] || []).some(c => String(c ?? '').trim() === marker)) return r;
  }
  return -1;
}

export function scoreWorkbook(spec: WorkbookSpec): FileResult {
  const aoa = roundTrip(spec);
  const base: FileResult = {
    id: spec.id,
    industry: spec.industry,
    fatal: null,
    headerRowExpected: expectedHeaderRowAfterRoundTrip(spec, aoa),
    headerRowGot: detectHeaderRow(aoa),
    columnsExpected: spec.columns.length,
    columnsGot: 0,
    unclassified: [],
    primitivesOk: 0,
    primitivesWrong: [],
    nameExpected: spec.nameColumn,
    nameGot: undefined,
    nameOk: false,
    nameDetail: '',
    dateCorrect: [],
    dateWrong: [],
    dateAmbiguous: [],
    dateUnavailable: [],
    trapsCaught: [],
    trapsMissed: [],
    dropped: 0,
  };

  if (base.headerRowGot === -1) {
    return {
      ...base,
      fatal: 'detectHeaderRow returned -1 — the pipeline raises "Could not find a header row" and nothing is imported',
      unclassified: spec.columns.map((c, i) => `col ${i} "${c.header}" -> no table found`),
      primitivesWrong: spec.columns.map((c, i) => ({
        index: i, header: c.header, expected: c.primitive, got: 'unknown' as ColumnPrimitive,
        coverage: 0, note: c.note,
      })),
      nameDetail: 'no table found',
      trapsMissed: (spec.rowTraps ?? []).map(t => `${t.kind} "${t.marker}" (no table found)`),
      dropped: spec.columns.length,
    };
  }

  const headerIdx = base.headerRowGot;
  const profiles = profileColumns(aoa, headerIdx);
  base.columnsGot = profiles.length;

  // ── primitives ────────────────────────────────────────────────────────────
  for (let i = 0; i < spec.columns.length; i++) {
    const truth = spec.columns[i];
    const profile = profiles[i];
    const got = primitiveOf(profile);
    const accepted = [truth.primitive, ...(truth.alsoOk ?? [])];
    if (accepted.includes(got)) base.primitivesOk++;
    else {
      base.primitivesWrong.push({
        index: i, header: truth.header, expected: truth.primitive, got,
        coverage: profile?.coverage ?? 0, note: truth.note,
      });
    }
    const holdsData = truth.primitive !== 'empty';
    if (got === 'unknown' || (got === 'empty' && holdsData)) {
      base.unclassified.push(`col ${i} "${truth.header}" -> ${got}`);
    }
  }

  // ── entity name ───────────────────────────────────────────────────────────
  const headers = aoa[headerIdx] ?? [];
  const proposal = proposeColumnMapping(headers, aoa.slice(headerIdx + 1, headerIdx + 501));
  base.nameGot = proposal.mapping.name;
  base.nameOk = spec.nameColumn === null
    ? proposal.mapping.name === undefined
    : proposal.mapping.name === spec.nameColumn;
  const gotHeader = base.nameGot === undefined ? '(none)' : `col ${base.nameGot} "${profiles[base.nameGot]?.header ?? ''}"`;
  const wantHeader = spec.nameColumn === null
    ? '(none — the sheet has no entity name)'
    : `col ${spec.nameColumn} "${spec.columns[spec.nameColumn].header}"`;
  base.nameDetail = `want ${wantHeader}, got ${gotHeader}${proposal.nameReason ? ` — "${proposal.nameReason}"` : ''}`;

  // ── zero-discard ──────────────────────────────────────────────────────────
  const accountedFor = new Set<number>([...Object.values(proposal.mapping), ...proposal.unmapped]);
  base.dropped = profiles.filter(p => !accountedFor.has(p.index) && (p.header !== '' || p.filled > 0)).length;

  // ── date order ────────────────────────────────────────────────────────────
  for (let i = 0; i < spec.columns.length; i++) {
    const truth = spec.columns[i];
    if (!truth.dateOrder) continue;
    const label = `col ${i} "${truth.header}"`;
    const profile = profiles[i];
    const got: DateOrder | undefined = profile?.dateOrder;
    if (primitiveOf(profile) !== 'date') base.dateUnavailable.push(`${label} — classified ${primitiveOf(profile)}, so no order was resolved`);
    else if (got === undefined) base.dateUnavailable.push(`${label} — date column but no order reported`);
    else if (got === 'ambiguous') base.dateAmbiguous.push(`${label} — flagged ambiguous (true order ${truth.dateOrder})`);
    else if (got === truth.dateOrder) base.dateCorrect.push(`${label} — ${got}`);
    else base.dateWrong.push(`${label} — read ${got}, authored ${truth.dateOrder}`);
  }

  // ── row shapes ────────────────────────────────────────────────────────────
  const shapes = new Map<number, RowKind>(
    classifyRowShapes(aoa, headerIdx, proposal.mapping.name).map(s => [s.rowIndex, s.kind]),
  );
  for (const trap of spec.rowTraps ?? []) {
    const r = findRow(aoa, headerIdx + 1, trap.marker);
    const got: RowKind | 'not found' = r === -1 ? 'not found' : shapes.get(r) ?? 'not found';
    const label = `${trap.kind} "${trap.marker}" -> ${got}`;
    if (trap.kind === 'continuation' && got === 'continuation') base.trapsCaught.push(label);
    else if (trap.kind !== 'continuation' && got !== 'data') base.trapsCaught.push(label);
    else base.trapsMissed.push(`${label}${trap.note ? ` (${trap.note})` : ''}`);
  }
  const blanksAuthored = spec.blankRows ?? 0;
  const blanksSeen = [...shapes.values()].filter(k => k === 'blank').length;
  if (blanksAuthored > 0) {
    const label = `${blanksAuthored} blank separator row(s) authored, ${blanksSeen} reached the classifier`;
    if (blanksSeen === blanksAuthored) base.trapsCaught.push(label);
    else base.trapsMissed.push(`${label} — xlsx \`blankrows: false\` removes them before classification, shifting every later row number`);
  }

  return base;
}

export const scoreCorpus = (): FileResult[] => CORPUS.map(scoreWorkbook);

export type Totals = {
  files: number;
  columns: number;
  primitivesOk: number;
  unclassified: number;
  dropped: number;
  namesOk: number;
  dateCorrect: number;
  dateWrong: number;
  dateAmbiguous: number;
  dateUnavailable: number;
  trapsCaught: number;
  trapsMissed: number;
};

export function totalsOf(results: FileResult[]): Totals {
  const sum = (f: (r: FileResult) => number) => results.reduce((a, r) => a + f(r), 0);
  return {
    files: results.length,
    columns: sum(r => r.columnsExpected),
    primitivesOk: sum(r => r.primitivesOk),
    unclassified: sum(r => r.unclassified.length),
    dropped: sum(r => r.dropped),
    namesOk: results.filter(r => r.nameOk).length,
    dateCorrect: sum(r => r.dateCorrect.length),
    dateWrong: sum(r => r.dateWrong.length),
    dateAmbiguous: sum(r => r.dateAmbiguous.length),
    dateUnavailable: sum(r => r.dateUnavailable.length),
    trapsCaught: sum(r => r.trapsCaught.length),
    trapsMissed: sum(r => r.trapsMissed.length),
  };
}

function report(onlyWrong: boolean): void {
  const results = scoreCorpus();
  const t = totalsOf(results);
  const pct = (n: number, d: number) => (d === 0 ? '—' : `${Math.round((n / d) * 100)}%`);

  for (const r of results) {
    if (onlyWrong && r.primitivesWrong.length === 0 && r.nameOk && r.trapsMissed.length === 0) continue;
    console.log(`\n━━ ${r.id} — ${r.industry}`);
    if (r.fatal) console.log(`   FATAL: ${r.fatal}`);
    if (r.headerRowGot !== r.headerRowExpected) {
      console.log(`   header row: expected ${r.headerRowExpected}, detected ${r.headerRowGot}`);
    }
    if (r.columnsGot !== r.columnsExpected && !r.fatal) {
      console.log(`   column count: authored ${r.columnsExpected}, profiled ${r.columnsGot}`);
    }
    console.log(`   primitives: ${r.primitivesOk}/${r.columnsExpected} correct (${pct(r.primitivesOk, r.columnsExpected)})`);
    for (const w of r.primitivesWrong) {
      console.log(`     WRONG col ${w.index} "${w.header}": expected ${w.expected}, got ${w.got}` +
        (w.coverage ? ` @ coverage ${w.coverage}` : '') + (w.note ? ` — ${w.note}` : ''));
    }
    if (r.unclassified.length > 0) console.log(`   unclassified: ${r.unclassified.join('; ')}`);
    console.log(`   entity name: ${r.nameOk ? 'OK' : 'WRONG'} — ${r.nameDetail}`);
    if (r.dropped > 0) console.log(`   DROPPED (neither mapped nor offered): ${r.dropped}`);
    for (const d of r.dateCorrect) console.log(`   date order OK: ${d}`);
    for (const d of r.dateAmbiguous) console.log(`   date order ambiguous (asks): ${d}`);
    for (const d of r.dateWrong) console.log(`   date order WRONG: ${d}`);
    for (const d of r.dateUnavailable) console.log(`   date order unavailable: ${d}`);
    for (const x of r.trapsCaught) console.log(`   trap caught: ${x}`);
    for (const x of r.trapsMissed) console.log(`   trap MISSED: ${x}`);
  }

  console.log(`\n━━━━━━━━━━ TOTALS over ${t.files} workbooks ━━━━━━━━━━`);
  console.log(`columns authored          ${t.columns}`);
  console.log(`primitives correct        ${t.primitivesOk}/${t.columns}  (${pct(t.primitivesOk, t.columns)})`);
  console.log(`columns unclassified      ${t.unclassified}  (unknown, or empty where data exists)`);
  console.log(`columns silently dropped  ${t.dropped}`);
  console.log(`entity name correct       ${t.namesOk}/${t.files}  (${pct(t.namesOk, t.files)})`);
  console.log(`date order correct        ${t.dateCorrect}`);
  console.log(`date order wrong          ${t.dateWrong}`);
  console.log(`date order ambiguous      ${t.dateAmbiguous}  (flagged for the user — the designed escape)`);
  console.log(`date order unavailable    ${t.dateUnavailable}  (column not classified as a date at all)`);
  console.log(`row-shape traps caught    ${t.trapsCaught}`);
  console.log(`row-shape traps missed    ${t.trapsMissed}`);
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('testCorpus/benchmark.ts')) {
  report(process.argv.includes('--wrong'));
}
