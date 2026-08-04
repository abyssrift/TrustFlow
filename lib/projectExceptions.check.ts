// Self-check for lib/projectExceptions.ts (Phase 10, #191, plan §16.2).
// Run by `npm run check` (scripts/run-checks.mjs auto-discovers *.check.ts).
//
// What would break without it: the "done" exclusion (a finished project must
// never read as overdue/overrunning) and the confidence gate ('none' must
// never fire an overrun warning) are both one `if` away from silently
// inverting, and both are exactly the kind of thing a demo can look right
// without a real regression check.

import assert from 'node:assert';
import {
  effectiveBlockedReason,
  exceptionUrgencyScore,
  isBlockedException,
  isExceptionProject,
  isOverdueException,
  isProjectDone,
  overrunStatus,
  type ExceptionSourceRow,
} from './projectExceptions';

const DONE = { stage_is_terminal: true, stage_terminal_type: 'success' } as const;
const OPEN_TERMINAL = { stage_is_terminal: true, stage_terminal_type: 'failure' } as const;
const NOT_STAGED = {} as const;

// ── isProjectDone ────────────────────────────────────────────────────────
assert.strictEqual(isProjectDone(DONE), true);
assert.strictEqual(isProjectDone(OPEN_TERMINAL), false, 'a failure-terminal stage is not "done"');
assert.strictEqual(isProjectDone(NOT_STAGED), false);
// completed_at is not part of the type at all — the predicate cannot read it
// even if a caller tried to smuggle it in.
assert.strictEqual(isProjectDone({ ...NOT_STAGED, ...({ completed_at: '2020-01-01' } as any) } as ExceptionSourceRow), false);

// ── blocked: union of the boolean and the flags array ──────────────────────
assert.strictEqual(isBlockedException({ blocked: true }), true);
assert.strictEqual(isBlockedException({ blocked: false, flags: ['blocked'] }), true, 'flags-only block must count');
assert.strictEqual(isBlockedException({ blocked: false, flags: ['at_risk'] }), false);
assert.strictEqual(isBlockedException({}), false);
assert.strictEqual(effectiveBlockedReason({ flag_note: 'waiting on legal', blocked_reason: 'old reason' }), 'waiting on legal', 'flag_note wins when both are set');
assert.strictEqual(effectiveBlockedReason({ flag_note: '  ', blocked_reason: 'client silent' }), 'client silent', 'blank flag_note falls back');
assert.strictEqual(effectiveBlockedReason({}), null);

// ── overdue: respects "done", ignores completed_at ──────────────────────────
assert.strictEqual(isOverdueException({ days_remaining: -3 }), true);
assert.strictEqual(isOverdueException({ days_remaining: 0 }), false);
assert.strictEqual(isOverdueException({ days_remaining: null }), false);
assert.strictEqual(isOverdueException({ days_remaining: -3, ...DONE }), false, 'a finished project is never overdue');
assert.strictEqual(isOverdueException({ days_remaining: -3, ...OPEN_TERMINAL }), true, 'a non-success terminal stage is not "done"');

// ── overrun: the confidence gate is the point of this file ─────────────────
const overrunBase = { due_date: '2026-08-01', projected_end: '2026-08-10' };
assert.strictEqual(overrunStatus({ ...overrunBase, projection_confidence: 'ok' }).fires, true);
assert.strictEqual(overrunStatus({ ...overrunBase, projection_confidence: 'ok' }).uncertain, false);
assert.strictEqual(overrunStatus({ ...overrunBase, projection_confidence: 'low' }).fires, true);
assert.strictEqual(overrunStatus({ ...overrunBase, projection_confidence: 'low' }).uncertain, true, 'low confidence still fires, marked uncertain');
assert.strictEqual(overrunStatus({ ...overrunBase, projection_confidence: 'none' }).fires, false, 'none must never fire — the server refused to forecast');
assert.strictEqual(overrunStatus({ ...overrunBase, projection_confidence: undefined }).fires, false);
assert.strictEqual(overrunStatus({ ...overrunBase, projection_confidence: 'ok', ...DONE }).fires, false, 'a finished project cannot be overrunning');
assert.strictEqual(overrunStatus({ due_date: '2026-08-10', projected_end: '2026-08-01', projection_confidence: 'ok' }).fires, false, 'projected_end before due_date is on track, not overrun');
assert.strictEqual(overrunStatus({ projected_end: '2026-08-10', projection_confidence: 'ok' }).fires, false, 'no due_date means nothing to compare against');

// ── isExceptionProject: any of the three qualifies ──────────────────────────
assert.strictEqual(isExceptionProject({}), false);
assert.strictEqual(isExceptionProject({ blocked: true }), true);
assert.strictEqual(isExceptionProject({ days_remaining: -1 }), true);
assert.strictEqual(isExceptionProject({ ...overrunBase, projection_confidence: 'ok' }), true);
assert.strictEqual(isExceptionProject({ blocked: true, ...DONE }), true, 'blocked overrides "done" — a human explicitly flagged it');
assert.strictEqual(isExceptionProject({ days_remaining: -30, ...DONE }), false, 'done + stale due_date is not an exception');

// ── urgency sort: blocked > overdue > overrun ───────────────────────────────
const blocked: ExceptionSourceRow = { blocked: true };
const overdue: ExceptionSourceRow = { days_remaining: -5 };
const overrunOk: ExceptionSourceRow = { ...overrunBase, projection_confidence: 'ok' };
const overrunLow: ExceptionSourceRow = { ...overrunBase, projection_confidence: 'low' };
assert.ok(exceptionUrgencyScore(blocked) > exceptionUrgencyScore(overdue));
assert.ok(exceptionUrgencyScore(overdue) > exceptionUrgencyScore(overrunOk));
assert.ok(exceptionUrgencyScore(overrunOk) > exceptionUrgencyScore(overrunLow), 'ok-confidence overrun ranks above uncertain overrun');
assert.ok(exceptionUrgencyScore({ days_remaining: -30 }) > exceptionUrgencyScore({ days_remaining: -1 }), 'more overdue ranks higher');

console.log('projectExceptions: all assertions passed (blocked/overdue/overrun predicate + urgency sort)');
