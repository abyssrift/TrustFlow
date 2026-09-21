/** Exact response shape of rpc_get_organizational_audit's JSON payload. */
export interface OrganizationalAudit {
  summary: {
    company_name: string | null;
    report_period: { start: string; end: string };
    filters_applied: {
      pipeline: string | null;
      team: string | null;
      worker: string | null;
      priority: string | null;
      project: string | null;
    };
  };
  current: {
    throughput: number;
    sample_size?: number;
    success_rate: number | null;
    avg_lead_time_minutes: number | null;
    revision_rate: number | null;
  };
  comparison: {
    throughput: number;
    success_rate: number | null;
    avg_lead_time_minutes: number | null;
    revision_rate: number | null;
  };
  radar_advanced: {
    flow_ratio: number | null;
    first_pass_yield: number | null;
    automation_offload_rate: number | null;
  };
  stage_duration_analysis: Array<{
    stage_name: string;
    pipeline_name: string;
    avg_duration_days: number;
  }> | null;
  conversion_by_stage: Array<{
    stage_name: string;
    pipeline_name: string;
    task_count: number;
    completion_rate: number;
  }> | null;
  sla_risks: Array<{
    id: string;
    task_number: string;
    stage_name: string;
    risk_percent: number;
    reason: string;
    due_date: string | null;
    avg_seconds: number | null;
  }> | null;
  worker_engagement: Array<{
    full_name: string;
    avatar_url: string | null;
    action_count: number;
  }> | null;
  quality_by_worker: Array<{
    full_name: string;
    avatar_url: string | null;
    revision_rate: number;
    total_tasks: number;
  }> | null;
  worker_time_metrics: Array<{
    user_id: string;
    full_name: string;
    avatar_url: string | null;
    task_count: number;
    total_hours: number;
    avg_hours_per_task: number;
    revision_rate: number;
  }> | null;
  cost_metrics: {
    total_hours: number;
    avg_cost_per_task: number;
    task_count: number;
  } | null;
}

export type OverviewMetricKey = 'throughput' | 'efficiency' | 'first_pass_yield';
export type OverviewMetricValue = number | null;

export function compareAuditMetric(
  current: number | null | undefined,
  prior: number | null | undefined,
  higherIsBetter: boolean,
): { value: number | null; delta: number | null; favorable: boolean | null } {
  const value = typeof current === 'number' && Number.isFinite(current) ? current : null;
  if (value === null) return { value: null, delta: null, favorable: null };
  if (typeof prior !== 'number' || !Number.isFinite(prior)) {
    return { value, delta: null, favorable: null };
  }
  const delta = value - prior;
  return { value, delta, favorable: higherIsBetter ? delta >= 0 : delta <= 0 };
}

export interface AnalyticsMetricDefinition {
  key: OverviewMetricKey;
  label: string;
  unit: 'tasks' | 'percent';
  format: 'integer' | 'whole-percent';
  sourceField: 'current.throughput' | 'current.success_rate' | 'radar_advanced.first_pass_yield';
  sampleSizeField?: 'current.sample_size';
  aggregationMeaning: string;
  availabilityRule: string;
  planFeature?: 'throughput';
}

export const ANALYTICS_METRICS: Record<OverviewMetricKey, AnalyticsMetricDefinition> = {
  throughput: {
    key: 'throughput',
    label: 'Throughput',
    unit: 'tasks',
    format: 'integer',
    sourceField: 'current.throughput',
    aggregationMeaning: 'Count of tasks in successful terminal stages during the selected period.',
    availabilityRule: 'Available when the audit response includes current.throughput.',
    planFeature: 'throughput',
  },
  efficiency: {
    key: 'efficiency',
    label: 'Success Rate',
    unit: 'percent',
    format: 'whole-percent',
    sourceField: 'current.success_rate',
    sampleSizeField: 'current.sample_size',
    aggregationMeaning: 'Successful terminal tasks divided by selected-period tasks, as a percentage.',
    availabilityRule: 'Available when current.sample_size is positive and current.success_rate is not null.',
  },
  first_pass_yield: {
    key: 'first_pass_yield',
    label: 'First-Pass Integrity',
    unit: 'percent',
    format: 'whole-percent',
    sourceField: 'radar_advanced.first_pass_yield',
    aggregationMeaning: 'Selected-period tasks with no rejected or revision submission divided by selected-period tasks, as a percentage.',
    availabilityRule: 'Available when radar_advanced.first_pass_yield is not null.',
  },
};

function readAuditField(audit: OrganizationalAudit, field: string): unknown {
  return field.split('.').reduce<unknown>((current, segment) => {
    if (typeof current !== 'object' || current === null) return undefined;
    return (current as Record<string, unknown>)[segment];
  }, audit);
}

export function getOverviewMetricValue(
  audit: OrganizationalAudit,
  key: OverviewMetricKey,
): OverviewMetricValue {
  const value = readAuditField(audit, ANALYTICS_METRICS[key].sourceField);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function getOverviewMetricSampleSize(
  audit: OrganizationalAudit,
  key: OverviewMetricKey,
): number | null {
  const { sampleSizeField } = ANALYTICS_METRICS[key];
  if (!sampleSizeField) return null;
  const value = readAuditField(audit, sampleSizeField);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function formatOverviewMetricValue(key: OverviewMetricKey, value: OverviewMetricValue): string | number {
  if (value == null) return '—';
  return ANALYTICS_METRICS[key].format === 'whole-percent' ? `${Math.round(value)}%` : Math.round(value);
}

export function getOverviewMetricLabel(key: OverviewMetricKey): string {
  return ANALYTICS_METRICS[key].label;
}
