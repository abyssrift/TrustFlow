// Self-check for the orphan-sweep selection logic — run:
//   npx tsx supabase/functions/filehub-orphan-sweep/logic.check.ts
// No framework (matches lib/filehubFolderTree.check.ts): plain asserts.
//
// The #1 invariant under test: a path that is referenced by ANY filehub_files
// row (live or in the Bin) or ANY filehub_file_versions row must never be
// selected for deletion — and neither must a path we cannot age-verify.
import assert from 'node:assert';
import { ageCandidates, selectOrphans, type StorageObj } from './logic.ts';

const NOW = Date.parse('2026-07-17T12:00:00Z');
const CUTOFF = NOW - 24 * 60 * 60 * 1000; // 24h floor
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const HOUR = 60 * 60 * 1000;

// ── ageCandidates: the 24h floor ────────────────────────────────────────────

// Old enough -> candidate.
{
  const objs: StorageObj[] = [{ path: 'c/f/old.png', created_at: iso(25 * HOUR) }];
  const { candidates, tooRecent } = ageCandidates(objs, CUTOFF);
  assert.deepEqual(candidates, ['c/f/old.png']);
  assert.equal(tooRecent, 0);
}

// In-flight upload (1h old) -> never a candidate.
{
  const objs: StorageObj[] = [{ path: 'c/f/fresh.png', created_at: iso(1 * HOUR) }];
  const { candidates, tooRecent } = ageCandidates(objs, CUTOFF);
  assert.deepEqual(candidates, [], 'a fresh object must never be swept');
  assert.equal(tooRecent, 1);
}

// Exactly at the cutoff is old enough; one ms newer is not.
{
  const objs: StorageObj[] = [
    { path: 'c/f/at.png', created_at: new Date(CUTOFF).toISOString() },
    { path: 'c/f/just-under.png', created_at: new Date(CUTOFF + 1000).toISOString() },
  ];
  const { candidates } = ageCandidates(objs, CUTOFF);
  assert.deepEqual(candidates, ['c/f/at.png']);
}

// FAIL-SAFE: null / empty / garbage created_at must be skipped, not deleted.
{
  const objs: StorageObj[] = [
    { path: 'c/f/null.png', created_at: null },
    { path: 'c/f/empty.png', created_at: '' },
    { path: 'c/f/garbage.png', created_at: 'not-a-date' },
  ];
  const { candidates, tooRecent } = ageCandidates(objs, CUTOFF);
  assert.deepEqual(candidates, [], 'unverifiable age must never be swept');
  assert.equal(tooRecent, 3);
}

// ── selectOrphans: referenced-set subtraction ───────────────────────────────

// The core scenario: live file, binned file, historical version all survive;
// only the truly unreferenced object is swept.
{
  const candidates = [
    'co/live/a.png',    // referenced by a live filehub_files row
    'co/binned/b.png',  // filehub_files row with deleted_at set (restorable)
    'co/vers/v1.png',   // superseded filehub_file_versions row
    'co/orph/x.png',    // referenced by nothing
  ];
  const referenced = new Set(['co/live/a.png', 'co/binned/b.png', 'co/vers/v1.png']);
  assert.deepEqual(selectOrphans(candidates, referenced), ['co/orph/x.png']);
}

// Empty referenced set -> every aged candidate is an orphan.
{
  assert.deepEqual(selectOrphans(['a', 'b'], new Set()), ['a', 'b']);
}

// Everything referenced -> nothing swept.
{
  assert.deepEqual(selectOrphans(['a', 'b'], new Set(['a', 'b'])), []);
}

// Exact-match only: a path that is a prefix/suffix of a referenced path is NOT
// itself protected, and vice versa (guards against sloppy substring matching).
{
  const referenced = new Set(['co/f/report.pdf']);
  assert.deepEqual(selectOrphans(['co/f/report.pdf.bak'], referenced), ['co/f/report.pdf.bak']);
  assert.deepEqual(selectOrphans(['co/f/report.pdf'], referenced), []);
}

// ── end-to-end: age floor + subtraction composed ────────────────────────────
// Mirrors index.ts: ageCandidates -> (reference lookup) -> selectOrphans.
{
  const objects: StorageObj[] = [
    { path: 'co/live/a.png', created_at: iso(48 * HOUR) },   // old but referenced
    { path: 'co/orph/x.png', created_at: iso(48 * HOUR) },   // old + unreferenced -> SWEEP
    { path: 'co/orph/new.png', created_at: iso(2 * HOUR) },  // unreferenced but fresh
    { path: 'co/orph/unk.png', created_at: null },           // unreferenced but unverifiable
  ];
  const referenced = new Set(['co/live/a.png']);

  const { candidates, tooRecent } = ageCandidates(objects, CUTOFF);
  const orphans = selectOrphans(candidates, referenced);

  assert.equal(tooRecent, 2);
  assert.deepEqual(orphans, ['co/orph/x.png'], 'only the aged, unreferenced object is swept');
}

// ── fail-closed contract check ──────────────────────────────────────────────
// index.ts marks an ENTIRE batch as referenced when a lookup errors. Simulate
// that: the resulting set must protect every path in the batch.
{
  const candidates = ['co/a/1.png', 'co/b/2.png'];
  const referencedAfterLookupFailure = new Set(candidates); // what index.ts does on error
  assert.deepEqual(
    selectOrphans(candidates, referencedAfterLookupFailure),
    [],
    'a reference-lookup failure must delete nothing',
  );
}

console.log('filehub-orphan-sweep logic.check.ts: all assertions passed');
