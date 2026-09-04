// Self-check for foldRecent — run: npx tsx hooks/useRecentDestinations.check.ts
// No framework (ponytail): plain asserts. Covers dedupe-by-href, the
// frequent-first-then-recent sort, and the cap.
import assert from 'node:assert';
import { foldRecent } from './useRecentDestinations';

const mk = (href: string) =>
  ({ id: href, label: href, href, icon: 'circle-o' as const, kind: 'page' as const });

// 1. First record → count 1, lands at front with the given timestamp.
{
  const r = foldRecent([], mk('/a'), 100);
  assert.equal(r.length, 1);
  assert.equal(r[0].href, '/a');
  assert.equal(r[0].count, 1);
  assert.equal(r[0].lastAt, 100);
}

// 2. Same href again → dedupes: bumps count + lastAt, no duplicate row.
{
  let r = foldRecent([], mk('/a'), 100);
  r = foldRecent(r, mk('/a'), 200);
  assert.equal(r.length, 1);
  assert.equal(r[0].count, 2);
  assert.equal(r[0].lastAt, 200);
}

// 3. Sort is frequent-first, then most-recent for equal counts.
{
  let r: ReturnType<typeof foldRecent> = [];
  r = foldRecent(r, mk('/a'), 1);
  r = foldRecent(r, mk('/b'), 2);
  r = foldRecent(r, mk('/b'), 3); // /b now count 2
  r = foldRecent(r, mk('/c'), 4);
  assert.deepEqual(
    r.map((d) => d.href),
    ['/b', '/c', '/a'],
    'count desc, then lastAt desc'
  );
}

// 4. Caps at 8 — with all counts equal, the newest 8 by lastAt survive.
{
  let r: ReturnType<typeof foldRecent> = [];
  for (let i = 0; i < 12; i++) r = foldRecent(r, mk('/p' + i), i);
  assert.equal(r.length, 8);
  assert.deepEqual(r.map((d) => d.href), ['/p11', '/p10', '/p9', '/p8', '/p7', '/p6', '/p5', '/p4']);
}

// 5. A high-count entry outlives a flood of one-off visits (the whole point of
//    frequency weighting vs. a plain recency list).
{
  let r: ReturnType<typeof foldRecent> = [];
  for (let i = 0; i <= 5; i++) r = foldRecent(r, mk('/fav'), i); // count 6
  for (let i = 0; i < 10; i++) r = foldRecent(r, mk('/n' + i), 100 + i);
  assert.equal(r[0].href, '/fav', 'frequent entry stays pinned to the top');
  assert.equal(r.length, 8);
}

console.log('useRecentDestinations: all checks passed');
