// Self-check for session presence — run: npx tsx lib/sessionPresence.check.ts
// No framework (ponytail): plain asserts, fixed "now" so heartbeat math is deterministic.
import assert from 'node:assert';
import { IDLE_MS, idleLabel, idleMsOf, isIdle } from './sessionPresence';

const NOW = new Date('2026-07-16T12:00:00Z').getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();

// Unknown heartbeat reads as active, never idle — an absent field must not
// paint a working teammate amber.
assert.equal(idleMsOf(null, NOW), 0);
assert.equal(idleMsOf(undefined, NOW), 0);
assert.equal(isIdle(null, NOW), false);

// A fresh heartbeat (one 30s pulse ago) is active.
assert.equal(isIdle(ago(30_000), NOW), false);

// Threshold is exclusive: exactly 3 missed pulses is still active, past it is idle.
assert.equal(isIdle(ago(IDLE_MS), NOW), false);
assert.equal(isIdle(ago(IDLE_MS + 1), NOW), true);

// Clock skew (heartbeat stamped in the future) must clamp to 0, not go negative
// and read as idle.
assert.equal(idleMsOf(ago(-60_000), NOW), 0);
assert.equal(isIdle(ago(-60_000), NOW), false);

// The instant we call someone idle, the label must not read "Idle 0m".
assert.equal(idleLabel(IDLE_MS + 1), 'Idle 1m');

// Minutes below an hour, h+m at and above it.
assert.equal(idleLabel(59 * 60_000), 'Idle 59m');
assert.equal(idleLabel(60 * 60_000), 'Idle 1h 0m');
assert.equal(idleLabel(95 * 60_000), 'Idle 1h 35m');

console.log('sessionPresence: all checks passed');
