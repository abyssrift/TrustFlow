import { useAnalytics } from '@/contexts/AnalyticsContext';
import { useCallback, useEffect, useMemo, useState } from 'react';

// ── Shared model for the dashboard overview graph ──────────────────────────
// All lines are summed across the dashboard's tracked pipelines per period.
// Data comes entirely from existing analytics RPCs (throughput / points /
// hours series). Used by both the web (recharts) and native (svg) charts.

export type OverviewMetricKey = 'throughput' | 'points' | 'hours' | 'success_rate';

export const OVERVIEW_METRICS: {
  key: OverviewMetricKey;
  label: string;
  colorKey: 'success' | 'primary' | 'info' | 'warning';
  axis: 'left' | 'right';
  unit?: string;
}[] = [
  { key: 'throughput',   label: 'Throughput',  colorKey: 'success', axis: 'left' },
  { key: 'points',       label: 'Points',      colorKey: 'primary', axis: 'left' },
  { key: 'hours',        label: 'Hours',       colorKey: 'info',    axis: 'left' },
  { key: 'success_rate', label: 'Success %',   colorKey: 'warning', axis: 'right', unit: '%' },
];

export const DEFAULT_OVERVIEW_METRICS: OverviewMetricKey[] = ['throughput', 'points', 'success_rate'];

export type OverviewPeriod = 'week' | 'month';

export interface OverviewPoint {
  key: string;          // period_start date (YYYY-MM-DD)
  label: string;
  throughput: number;
  points: number;
  hours: number;
  success_rate: number;
}

const N_PERIODS: Record<OverviewPeriod, number> = { week: 8, month: 6 };

export function overviewLabel(dateKey: string, period: OverviewPeriod): string {
  const d = new Date(dateKey + 'T00:00:00');
  if (period === 'month') {
    return d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
  }
  // ISO week number
  const tmp = new Date(d.getTime());
  tmp.setDate(tmp.getDate() + 4 - (tmp.getDay() || 7));
  const yearStart = new Date(tmp.getFullYear(), 0, 1);
  const week = Math.ceil((((tmp.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `W${week}`;
}

interface Bucket {
  key: string;
  succeeded: number;
  failed: number;
  points: number;
  hours: number;
}

export function usePipelineOverviewData(
  pipelineIds: string[],
  period: OverviewPeriod,
  refreshKey: number = 0,
): { data: OverviewPoint[]; loading: boolean; error: string | null } {
  const { getPipelineThroughput, getPipelinePointsSeries, getPipelineHoursSeries } = useAnalytics();
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (pipelineIds.length === 0) {
      setBuckets([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const n = N_PERIODS[period];
    try {
      const map = new Map<string, Bucket>();
      const touch = (key: string): Bucket => {
        let b = map.get(key);
        if (!b) { b = { key, succeeded: 0, failed: 0, points: 0, hours: 0 }; map.set(key, b); }
        return b;
      };

      await Promise.all(pipelineIds.map(async (pid) => {
        const [thr, pts, hrs] = await Promise.all([
          getPipelineThroughput(pid, period, n),
          getPipelinePointsSeries(pid, period, n),
          getPipelineHoursSeries(pid, period, n),
        ]);
        for (const t of thr) {
          const b = touch(String(t.period_start).slice(0, 10));
          b.succeeded += t.tasks_succeeded ?? 0;
          b.failed    += t.tasks_failed ?? 0;
        }
        for (const p of pts) {
          const b = touch(String(p.period_start).slice(0, 10));
          b.points += p.weight_points ?? 0;
        }
        for (const h of hrs) {
          const b = touch(String(h.period_start).slice(0, 10));
          b.hours += h.active_hours ?? 0;
        }
      }));

      setBuckets(Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key)));
    } catch (e: any) {
      console.error('usePipelineOverviewData load failed', e);
      setError(e?.message ?? 'Failed to load overview data.');
      setBuckets([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipelineIds, period, refreshKey]);

  useEffect(() => { load(); }, [load]);

  const data = useMemo<OverviewPoint[]>(() => buckets.map((b) => {
    const denom = b.succeeded + b.failed;
    return {
      key: b.key,
      label: overviewLabel(b.key, period),
      throughput: b.succeeded,
      points: b.points,
      hours: Math.round(b.hours * 10) / 10,
      success_rate: denom > 0 ? Math.round((b.succeeded / denom) * 100) : 0,
    };
  }), [buckets, period]);

  return { data, loading, error };
}
