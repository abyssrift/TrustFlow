import { useEffect, useState } from 'react';

type TickerOptions = {
  /** End of the interval while not live. Defaults to "now" if omitted. */
  end?: string | null;
  /** Ticks every second while true; otherwise returns a static value with no interval. */
  active?: boolean;
  /** Added to Date.now() while ticking — for correcting against server clock drift. */
  offsetMs?: number;
};

/**
 * Elapsed seconds between `start` and `end` (or "now" while live).
 * Ticks once a second in its own state, isolated from the parent's render —
 * mount this in a small leaf component so the 1s tick doesn't force a
 * re-render of everything around it.
 */
export function useTicker(start: string | null, options: TickerOptions = {}): number {
  const { end = null, active = true, offsetMs = 0 } = options;
  const isLive = active && !!start;

  const compute = () => {
    if (!start) return 0;
    const startMs = new Date(start).getTime();
    const endMs = isLive || !end ? Date.now() + offsetMs : new Date(end).getTime();
    return Math.max(0, Math.floor((endMs - startMs) / 1000));
  };

  const [seconds, setSeconds] = useState(compute);

  useEffect(() => {
    setSeconds(compute());
    if (!isLive) return;
    const id = setInterval(() => setSeconds(compute()), 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, end, isLive, offsetMs]);

  return seconds;
}
