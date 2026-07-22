import { formatStopwatch } from '@/lib/time';
import { useTicker } from './useTicker';

export function useElapsedTime(startedAt: string | null): string {
  const diff = useTicker(startedAt);
  return formatStopwatch(diff);
}
