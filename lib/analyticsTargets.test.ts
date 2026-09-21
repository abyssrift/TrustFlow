import { describe, expect, it } from 'vitest';
import { getTargetHistoryDate, toTargetScreenTarget, type TargetScreenTarget } from './analyticsTargets';
import type { CanonicalAnalyticsTarget } from '@/hooks/useCanonicalAnalyticsTargets';

const volumeTarget = (overrides: Partial<CanonicalAnalyticsTarget> = {}): CanonicalAnalyticsTarget => ({
  id: 'target-1',
  stageId: 'stage-1',
  stageName: 'Review',
  pipelineId: 'pipeline-1',
  pipelineName: 'Client work',
  type: 'volume',
  storedStatus: 'completed',
  targetQuantity: 20,
  targetActiveSeconds: null,
  targetLifecycleSeconds: null,
  deadline: '2026-10-01T00:00:00Z',
  createdAt: '2026-09-01T00:00:00Z',
  completedAt: '2026-09-15T00:00:00Z',
  observedValue: 0,
  progressUnit: 'tasks',
  ...overrides,
});

describe('canonical target screen adapter', () => {
  it('preserves a measured volume zero and maps stored lifecycle fields', () => {
    const result: TargetScreenTarget = toTargetScreenTarget(volumeTarget());

    expect(result).toEqual({
      id: 'target-1',
      stage_id: 'stage-1',
      stage: { name: 'Review', pipeline_id: 'pipeline-1' },
      pipeline_name: 'Client work',
      target_type: 'volume',
      target_quantity: 20,
      target_active_seconds: null,
      target_lifecycle_seconds: null,
      target_deadline: '2026-10-01T00:00:00Z',
      status: 'completed',
      completed_at: '2026-09-15T00:00:00Z',
      created_at: '2026-09-01T00:00:00Z',
      current_count: 0,
    });
  });

  it('maps nonzero volume observations to current_count', () => {
    expect(toTargetScreenTarget(volumeTarget({ observedValue: 7 })).current_count).toBe(7);
  });

  it('preserves performance budgets without inventing observed progress', () => {
    const result = toTargetScreenTarget(volumeTarget({
      type: 'performance',
      targetQuantity: null,
      targetActiveSeconds: 3600,
      targetLifecycleSeconds: 7200,
      observedValue: null,
      progressUnit: null,
    }));

    expect(result).toMatchObject({
      target_type: 'performance',
      target_quantity: null,
      target_active_seconds: 3600,
      target_lifecycle_seconds: 7200,
      current_count: null,
    });
  });

  it('uses completion time before creation time for history dates', () => {
    expect(getTargetHistoryDate(toTargetScreenTarget(volumeTarget()))).toEqual(new Date('2026-09-15T00:00:00Z'));
  });

  it('falls back to creation time when completion time is missing', () => {
    expect(getTargetHistoryDate(toTargetScreenTarget(volumeTarget({ completedAt: null })))).toEqual(new Date('2026-09-01T00:00:00Z'));
  });

  it('returns null when both history timestamps are missing or invalid', () => {
    expect(getTargetHistoryDate(toTargetScreenTarget(volumeTarget({ completedAt: null, createdAt: null })))).toBeNull();
    expect(getTargetHistoryDate(toTargetScreenTarget(volumeTarget({ completedAt: 'not-a-date', createdAt: null })))).toBeNull();
  });
});
