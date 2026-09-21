import { useCallback, useEffect, useRef, useState } from 'react';

import { supabase } from '@/lib/supabase';

export type CanonicalAnalyticsTarget = {
  id: string;
  stageId: string;
  stageName: string;
  pipelineId: string;
  pipelineName: string;
  type: 'volume' | 'performance';
  storedStatus: string;
  targetQuantity: number | null;
  targetActiveSeconds: number | null;
  targetLifecycleSeconds: number | null;
  deadline: string | null;
  createdAt: string | null;
  completedAt: string | null;
  observedValue: number | null;
  progressUnit: 'tasks' | 'seconds' | null;
};

type CanonicalAnalyticsTargetRow = {
  id: string;
  stage_id: string;
  stage_name: string;
  pipeline_id: string;
  pipeline_name: string;
  target_type: string;
  stored_status: string;
  target_quantity: number | null;
  target_active_seconds: number | null;
  target_lifecycle_seconds: number | null;
  deadline: string | null;
  created_at: string | null;
  completed_at: string | null;
  observed_value: number | null;
  progress_unit: string | null;
};

function mapTarget(row: CanonicalAnalyticsTargetRow): CanonicalAnalyticsTarget | null {
  if (row.target_type !== 'volume' && row.target_type !== 'performance') return null;
  return {
    id: row.id,
    stageId: row.stage_id,
    stageName: row.stage_name,
    pipelineId: row.pipeline_id,
    pipelineName: row.pipeline_name,
    type: row.target_type,
    storedStatus: row.stored_status,
    targetQuantity: row.target_quantity,
    targetActiveSeconds: row.target_active_seconds,
    targetLifecycleSeconds: row.target_lifecycle_seconds,
    deadline: row.deadline,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    // The RPC intentionally returns NULL for performance targets until an
    // observed-value calculation has trustworthy semantics.
    observedValue: row.observed_value,
    progressUnit: row.progress_unit === 'tasks' || row.progress_unit === 'seconds'
      ? row.progress_unit
      : null,
  };
}

export function useCanonicalAnalyticsTargets({ enabled = true }: { enabled?: boolean } = {}) {
  const [targets, setTargets] = useState<CanonicalAnalyticsTarget[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    const currentRequest = ++requestId.current;
    if (!enabled) {
      setTargets([]);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('rpc_get_canonical_analytics_targets');
      if (currentRequest !== requestId.current) return;
      if (rpcError) {
        setTargets([]);
        setError(rpcError.message || 'Unable to load targets.');
      } else {
        setTargets(((data ?? []) as CanonicalAnalyticsTargetRow[])
          .map(mapTarget)
          .filter((target): target is CanonicalAnalyticsTarget => target !== null));
      }
    } catch (e) {
      if (currentRequest !== requestId.current) return;
      setTargets([]);
      setError(e instanceof Error ? e.message : 'Unable to load targets.');
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      requestId.current++;
      setTargets([]);
      setError(null);
      setLoading(false);
      return;
    }
    void refresh();
  }, [enabled, refresh]);

  return { targets, loading, error, refresh };
}
