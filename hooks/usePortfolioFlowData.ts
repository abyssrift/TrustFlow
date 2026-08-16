import { isoDay, useGranularity } from '@/components/intelligence/DateRangeFilter';
import {
  PortfolioCapacityRow,
  PortfolioCfdPoint,
  PortfolioThroughputBucket,
  PortfolioWipStage,
  useAnalytics,
} from '@/contexts/AnalyticsContext';
import { supabase } from '@/lib/supabase';
import { useCallback, useEffect, useState } from 'react';

// Data-fetching for Portfolio Flow Analytics (#175) -- shared between
// PortfolioFlowTab.tsx (native + fallback, react-native-svg charts) and
// PortfolioFlowTab.web.tsx (web, recharts charts with hover tooltips) so the
// pipeline/date-range state and the four getPortfolio* calls are not
// duplicated across the two platform variants. Same split the rest of
// components/intelligence/ already uses for chart rendering (recharts is
// web-only and cannot run on native RN).
export function usePortfolioFlowData() {
  const {
    getPortfolioWipByStage,
    getPortfolioCfd,
    getPortfolioThroughput,
    getPortfolioCapacity,
  } = useAnalytics();

  const [pipelines, setPipelines] = useState<{ id: string; name: string }[]>([]);
  const [selectedPipeline, setSelectedPipeline] = useState<string | null>(null);
  const granularity = useGranularity();
  const buckets = granularity.buckets;

  const today = new Date();
  const defaultFrom = new Date(today.getTime() - 56 * 86400000);
  const [from, setFrom] = useState(isoDay(defaultFrom));
  const [to, setTo] = useState(isoDay(today));

  const [wip, setWip] = useState<PortfolioWipStage[]>([]);
  const [cfd, setCfd] = useState<PortfolioCfdPoint[]>([]);
  const [throughput, setThroughput] = useState<PortfolioThroughputBucket[]>([]);
  const [capacity, setCapacity] = useState<PortfolioCapacityRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    supabase
      .from('pipelines')
      .select('id, name')
      .eq('subject_kind', 'project')
      .is('deleted_at', null)
      .order('name')
      .then(({ data }) => {
        if (data?.length) { setPipelines(data); setSelectedPipeline(data[0].id); }
      });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const capacityPromise = getPortfolioCapacity(from, to);
      if (!selectedPipeline) {
        setCapacity(await capacityPromise);
        setWip([]); setCfd([]); setThroughput([]);
        setLoaded(true);
        return;
      }
      const [w, c, t, cap] = await Promise.all([
        getPortfolioWipByStage(selectedPipeline),
        getPortfolioCfd(selectedPipeline, from, to, buckets),
        getPortfolioThroughput(selectedPipeline, from, to, buckets),
        capacityPromise,
      ]);
      setWip(w); setCfd(c); setThroughput(t); setCapacity(cap);
      setLoaded(true);
    } finally { setLoading(false); }
  }, [selectedPipeline, from, to, buckets]);

  useEffect(() => { load(); }, [load]);

  return {
    pipelines, selectedPipeline, setSelectedPipeline,
    granularity, from, to, setFrom, setTo,
    wip, cfd, throughput, capacity,
    loading, loaded,
  };
}
