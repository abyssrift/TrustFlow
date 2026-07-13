// Single source of truth for rendering a duration (in seconds) as compact text,
// e.g. avg/median/p75 stage dwell time. Used on-screen (web + mobile) and in
// exported PDF reports so the same underlying seconds value always reads the same.
export function formatDuration(s: number): string {
  if (!s || s <= 0) return '0m';
  if (s < 60) return `${Math.round(s)}s`;
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}
