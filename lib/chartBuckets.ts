// Constant-granularity time-series support for the Intelligence screens (#139).
// Every graph renders a fixed number of buckets decided by screen width — the
// bigger the screen, the finer the grain — regardless of the selected range.

export const MIN_BUCKETS = 6;
export const MAX_BUCKETS = 24;

// ponytail: 110px per bucket is a naive readability heuristic; tune per-chart if a chart ever needs it
export function bucketsForWidth(width: number): number {
  return Math.min(MAX_BUCKETS, Math.max(MIN_BUCKETS, Math.floor(width / 110)));
}

const MS_DAY = 86400000;

function d(iso: string): Date {
  return new Date(iso.length <= 10 ? iso + 'T00:00:00' : iso);
}

const fmtDay = (x: Date) => x.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const fmtMonth = (x: Date) => x.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });

/**
 * Human label for a time bucket [start, end). Spans of ~a day collapse to one
 * date, month-sized spans to "Jul 2026", anything else to "Jul 5 – Jul 11".
 */
export function bucketLabel(startIso: string, endIso: string): string {
  const start = d(startIso);
  const end = d(endIso);
  const spanDays = (end.getTime() - start.getTime()) / MS_DAY;
  const last = new Date(end.getTime() - 1); // end is exclusive
  if (spanDays <= 1.5) return fmtDay(start);
  if (spanDays >= 27 && start.getDate() === 1 && start.getMonth() === last.getMonth() && spanDays <= 32) {
    return fmtMonth(start);
  }
  return `${fmtDay(start)} – ${fmtDay(last)}`;
}
