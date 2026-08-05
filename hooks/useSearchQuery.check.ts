// Self-check for parseQuery — run: npx tsx hooks/useSearchQuery.check.ts
// No framework (ponytail): plain asserts, fixed "now" so date math is deterministic.
import assert from 'node:assert';
import { parseQuery } from './useSearchQuery';

const NOW = new Date('2026-07-14T12:00:00Z'); // Tue

// plain terms
let p = parseQuery('onboarding checklist', NOW);
assert.equal(p.terms, 'onboarding checklist');
assert.deepEqual(p.types, []);
assert.equal(p.from, null);

// type hint (bare word) stripped from terms
p = parseQuery('onboarding task', NOW);
assert.deepEqual(p.types, ['task']);
assert.equal(p.terms, 'onboarding');

// type: prefix
p = parseQuery('file:logo brand', NOW);
assert.deepEqual(p.types, ['file']);
assert.equal(p.terms, 'logo brand');

// date phrase → range, stripped from terms
p = parseQuery('logo files last week', NOW);
assert.deepEqual(p.types, ['file']);
assert.equal(p.terms, 'logo');
assert.ok(p.from && p.to, 'expected a date range');
assert.equal(p.humanized, 'Files · Last week');

// Ranges are computed in the user's LOCAL timezone (correct: "yesterday" = the
// user's yesterday). Assert range semantics, not UTC string prefixes, so the
// check is timezone-independent.
const H = 3600_000, D = 24 * H;
const span = (q: typeof p) => new Date(q.to!).getTime() - new Date(q.from!).getTime();
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

// yesterday = single day, entirely before now
p = parseQuery('yesterday', NOW);
assert.equal(p.terms, '');
assert.ok(near(span(p), D, 2 * H), 'yesterday spans ~1 day');
assert.ok(new Date(p.to!).getTime() < NOW.getTime(), 'yesterday ends before now');

// month name → whole month (~28-31 days)
p = parseQuery('redesign in June', NOW);
assert.equal(p.terms, 'redesign');
assert.ok(span(p) >= 27 * D && span(p) <= 31 * D, 'June spans a month');

// ISO date → single day near 2026-07-03
p = parseQuery('meeting 2026-07-03', NOW);
assert.equal(p.terms, 'meeting');
assert.ok(near(span(p), D, 2 * H), 'ISO date spans ~1 day');
assert.ok(near(new Date(p.from!).getTime(), Date.UTC(2026, 6, 3), 24 * H), 'ISO date near July 3');

// ── v2: date-field targeting ──────────────────────────────────────────────
// "due" → field=due, and (no explicit type) auto-narrows to tasks
p = parseQuery('logo due tomorrow', NOW);
assert.equal(p.field, 'due');
assert.deepEqual(p.types, ['task']);
assert.equal(p.terms, 'logo');
assert.ok(p.from && p.to, 'tomorrow range set');

// "completed" → field=completed
p = parseQuery('report completed last week', NOW);
assert.equal(p.field, 'completed');
// explicit type 'report' present → not auto-narrowed to task
assert.deepEqual(p.types, ['report']);

// no field word → null (server defaults to created_at)
p = parseQuery('onboarding', NOW);
assert.equal(p.field, null);

// ── v2: operators ─────────────────────────────────────────────────────────
// before July → open-ended upper bound, terms cleaned
p = parseQuery('invoice before july', NOW);
assert.equal(p.terms, 'invoice');
assert.ok(p.to && new Date(p.to!) < NOW, 'before july: to precedes now');

// between june and august → spans ~2-3 months
p = parseQuery('audit between june and august', NOW);
assert.equal(p.terms, 'audit');
assert.ok(span(p) >= 55 * D && span(p) <= 95 * D, 'between june and august spans ~2-3mo');

// ── v2: relative N + anchors ──────────────────────────────────────────────
// "last 3 days" = start-of-day 3 days ago → end of today (≈3–4 calendar days)
p = parseQuery('last 3 days', NOW);
assert.ok(span(p) >= 3 * D && span(p) <= 4.5 * D, 'last 3 days spans 3-4 days');

p = parseQuery('q2', NOW);
assert.ok(span(p) >= 88 * D && span(p) <= 95 * D, 'Q2 spans a quarter');
assert.ok(new Date(p.from!).getUTCMonth() >= 2 && new Date(p.from!).getUTCMonth() <= 3, 'Q2 starts around April');

p = parseQuery('foo 3 days ago', NOW);
assert.equal(p.terms, 'foo');
assert.ok(near(span(p), D, 2 * H), '3 days ago is a single day');

// ── v3: person type ───────────────────────────────────────────────────────
p = parseQuery('people sara', NOW);
assert.deepEqual(p.types, ['person']);
assert.equal(p.terms, 'sara');

p = parseQuery('user:ahmed', NOW);
assert.deepEqual(p.types, ['person']);
assert.equal(p.terms, 'ahmed');

// ── Phase 10 (#191): project / portfolio types ────────────────────────────
p = parseQuery('audit projects', NOW);
assert.deepEqual(p.types, ['project']);
assert.equal(p.terms, 'audit');
assert.equal(p.humanized, 'Projects');

p = parseQuery('project:statutory', NOW);
assert.deepEqual(p.types, ['project']);
assert.equal(p.terms, 'statutory');

p = parseQuery('jba portfolio', NOW);
assert.deepEqual(p.types, ['portfolio']);
assert.equal(p.terms, 'jba');

p = parseQuery('portfolios:excel', NOW);
assert.deepEqual(p.types, ['portfolio']);
assert.equal(p.terms, 'excel');

// projects carry their own due_date server-side, so an explicit type must
// survive the "due/completed => tasks" narrowing.
p = parseQuery('projects due next week', NOW);
assert.equal(p.field, 'due');
assert.deepEqual(p.types, ['project']);
assert.ok(p.from && p.to, 'next week range set');

// "batch" is portfolio vocabulary but must stay a SEARCH TERM — real
// portfolios are literally named "… Audit batch".
p = parseQuery('audit batch', NOW);
assert.deepEqual(p.types, []);
assert.equal(p.terms, 'audit batch');

console.log('useSearchQuery: all assertions passed');
