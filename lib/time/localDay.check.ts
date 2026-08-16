// Self-check for localIsoDay — run: npx tsx lib/time/localDay.check.ts
// No framework (ponytail): plain asserts.
//
// The bug this guards against (#272): d.toISOString().split('T')[0] reads
// the UTC calendar date. For a timezone ahead of UTC, local 00:30 on day D
// is still ~21:30-22:30 UTC on day D-1, so the buggy version silently
// returns "yesterday" for the first ~2-3hrs after local midnight.
import assert from 'node:assert';
import { localIsoDay } from './localDay';

// A Date holding a specific LOCAL wall-clock time must read back that same
// local calendar day, regardless of what UTC date it happens to straddle.
{
  const d = new Date(2026, 6, 15, 10, 30, 0); // 15 Jul 2026, 10:30 local -- safely mid-day, no UTC-boundary ambiguity
  assert.equal(localIsoDay(d), '2026-07-15');
}

// Midnight-local, the exact moment the UTC-based bug fires for any
// eastward timezone: the buggy `toISOString().split('T')[0]` would read
// the PREVIOUS UTC day whenever local time is ahead of UTC.
{
  const d = new Date(2026, 6, 15, 0, 5, 0); // 12:05am local
  assert.equal(localIsoDay(d), '2026-07-15', 'just after local midnight must still be the 15th, not the 14th');
}

// Padding: single-digit month/day must still be zero-padded.
{
  const d = new Date(2026, 0, 5, 12, 0, 0); // 5 Jan 2026
  assert.equal(localIsoDay(d), '2026-01-05');
}

// No-arg call defaults to "now" and produces a well-formed YYYY-MM-DD.
{
  const day = localIsoDay();
  assert.match(day, /^\d{4}-\d{2}-\d{2}$/);
}

console.log('localDay.check.ts OK');
