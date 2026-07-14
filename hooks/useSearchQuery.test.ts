// Self-check for parseQuery — run: npx tsx hooks/useSearchQuery.test.ts
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

console.log('useSearchQuery: all assertions passed');
