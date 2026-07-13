import { useTicker } from './useTicker';

/**
 * Live elapsed time counter.
 * Given an ISO timestamp (the session start), returns a formatted
 * HH:MM:SS or MM:SS string that updates every second.
 *
 * Returns '00:00' when startedAt is null (no active session).
 */
export function useElapsedTime(startedAt: string | null): string {
  const diff = useTicker(startedAt);
  const hrs = Math.floor(diff / 3600);
  const mins = Math.floor((diff % 3600) / 60);
  const secs = diff % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hrs > 0 ? `${pad(hrs)}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`;
}
