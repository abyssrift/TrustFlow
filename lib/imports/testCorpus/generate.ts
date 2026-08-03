// Turns the corpus definitions into real .xlsx bytes, and reads them back the
// exact way production does. The workbooks are NOT checked in as binaries —
// corpus.ts is the source of truth and this file is how you get a spreadsheet
// out of it.
//
//   npx tsx lib/imports/testCorpus/generate.ts [outDir]   # default ./corpus-out
//
// Reading back through xlsx (rather than handing the classifier the raw arrays)
// is deliberate: `sheet_to_json`'s options are part of the pipeline's behaviour.
// `blankrows: false` in particular deletes rows before the classifier ever sees
// them, and that only shows up if you go through the file.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import type { SheetCell } from '../spreadsheetMapping';
import { CORPUS, type WorkbookSpec } from './corpus';

export function toXlsxBytes(spec: WorkbookSpec): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(spec.aoa), 'Sheet1');
  return new Uint8Array(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
}

/**
 * The same read `parseSpreadsheetBytes` performs — same options, same order.
 *
 * `blankrows` was `false` here after production had already moved to `true`,
 * which quietly made the benchmark measure a pipeline nobody runs: all the
 * authored blank separator rows were deleted before the classifier saw them, so
 * three row traps read as MISSED that production actually catches. Keep this
 * line identical to spreadsheetIntake.ts or the whole corpus measures fiction.
 */
export function readBackAoa(bytes: Uint8Array): SheetCell[][] {
  const wb = XLSX.read(bytes, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: true }) as SheetCell[][];
}

export const roundTrip = (spec: WorkbookSpec): SheetCell[][] => readBackAoa(toXlsxBytes(spec));

if (process.argv[1]?.replace(/\\/g, '/').endsWith('testCorpus/generate.ts')) {
  const outDir = process.argv[2] ?? 'corpus-out';
  mkdirSync(outDir, { recursive: true });
  for (const spec of CORPUS) {
    const file = join(outDir, `${spec.id}.xlsx`);
    writeFileSync(file, toXlsxBytes(spec));
    console.log(`${file}  (${spec.aoa.length} rows × ${spec.columns.length} cols) — ${spec.industry}`);
  }
  console.log(`\n${CORPUS.length} workbooks written to ${outDir}/`);
}
