// Activity timeline for a running work session: the only three things a JS
// client can actually observe about the user — input in our app, no input while
// our app is focused, and our app not being focused at all.
export type ActivityState = 'active' | 'idle' | 'away';
export type ActivityMark = { t: number; state: ActivityState };
export type ActivitySegment = { state: ActivityState; start: number; end: number };

// Display-only cutoff for the strip. The auto-stop policy is a separate,
// far longer threshold (IDLE_TIMEOUT in ./smartTimer) — don't merge them.
export const IDLE_AFTER_MS = 60 * 1000;

/** Marks are transitions; segments are the spans between them, the last one open to `now`. */
export function buildSegments(marks: ActivityMark[], now: number): ActivitySegment[] {
  return marks
    .map((m, i) => ({ state: m.state, start: m.t, end: Math.max(m.t, marks[i + 1]?.t ?? now) }))
    .filter((s) => s.end > s.start);
}

export function totalsOf(segments: ActivitySegment[]): Record<ActivityState, number> {
  const totals: Record<ActivityState, number> = { active: 0, idle: 0, away: 0 };
  for (const s of segments) totals[s.state] += s.end - s.start;
  return totals;
}
