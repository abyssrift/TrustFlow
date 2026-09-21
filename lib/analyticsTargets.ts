import type { CanonicalAnalyticsTarget } from '@/hooks/useCanonicalAnalyticsTargets';

export type TargetScreenTarget = {
  id: string;
  stage_id: string;
  stage: { name: string; pipeline_id: string };
  pipeline_name: string;
  target_type: 'volume' | 'performance';
  target_quantity: number | null;
  target_active_seconds: number | null;
  target_lifecycle_seconds: number | null;
  target_deadline: string | null;
  status: string;
  completed_at: string | null;
  created_at: string | null;
  current_count: number | null;
};

export function toTargetScreenTarget(target: CanonicalAnalyticsTarget): TargetScreenTarget {
  return {
    id: target.id,
    stage_id: target.stageId,
    stage: { name: target.stageName, pipeline_id: target.pipelineId },
    pipeline_name: target.pipelineName,
    target_type: target.type,
    target_quantity: target.targetQuantity,
    target_active_seconds: target.targetActiveSeconds,
    target_lifecycle_seconds: target.targetLifecycleSeconds,
    target_deadline: target.deadline,
    status: target.storedStatus,
    completed_at: target.completedAt,
    created_at: target.createdAt,
    current_count: target.type === 'volume' ? target.observedValue : null,
  };
}

export function getTargetHistoryDate(target: Pick<TargetScreenTarget, 'completed_at' | 'created_at'>): Date | null {
  const timestamp = target.completed_at ?? target.created_at;
  if (!timestamp) return null;

  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? date : null;
}
