import { useState, useEffect, useRef } from 'react';

/**
 * Live elapsed time counter.
 * Given an ISO timestamp (the session start), returns a formatted
 * HH:MM:SS or MM:SS string that updates every second.
 *
 * Returns '00:00' when startedAt is null (no active session).
 */
export function useElapsedTime(startedAt: string | null): string {
  const [elapsed, setElapsed] = useState('00:00');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!startedAt) {
      setElapsed('00:00');
      return;
    }

    const update = () => {
      const diff = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
      const hrs = Math.floor(diff / 3600);
      const mins = Math.floor((diff % 3600) / 60);
      const secs = diff % 60;
      const pad = (n: number) => String(n).padStart(2, '0');
      setElapsed(hrs > 0 ? `${pad(hrs)}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`);
    };

    update();
    intervalRef.current = setInterval(update, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [startedAt]);

  return elapsed;
}
