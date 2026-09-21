import { describe, expect, it } from 'vitest';
import {
  ANALYTICS_METRICS,
  compareAuditMetric,
  formatOverviewMetricValue,
  getOverviewMetricSampleSize,
  getOverviewMetricValue,
  type OrganizationalAudit,
} from './analyticsMetrics';

const audit = (overrides: Partial<OrganizationalAudit> = {}): OrganizationalAudit => ({
  summary: {
    company_name: 'Example',
    report_period: { start: '2026-09-01', end: '2026-09-30' },
    filters_applied: { pipeline: null, team: null, worker: null, priority: null, project: null },
  },
  current: { throughput: 12, sample_size: 8, success_rate: 0.5, avg_lead_time_minutes: null, revision_rate: null },
  comparison: { throughput: 10, success_rate: 0.4, avg_lead_time_minutes: null, revision_rate: null },
  radar_advanced: { flow_ratio: null, first_pass_yield: 0.75, automation_offload_rate: null },
  stage_duration_analysis: null,
  conversion_by_stage: null,
  sla_risks: null,
  worker_engagement: null,
  quality_by_worker: null,
  worker_time_metrics: null,
  cost_metrics: null,
  ...overrides,
});

describe('analytics metric registry contract', () => {
  it('declares exactly the supported overview metrics with self-consistent unique keys', () => {
    const keys = ['throughput', 'efficiency', 'first_pass_yield'];
    expect(Object.keys(ANALYTICS_METRICS).sort()).toEqual(keys.sort());
    expect(Object.values(ANALYTICS_METRICS).map(metric => metric.key).sort()).toEqual(keys.sort());
    expect(new Set(Object.values(ANALYTICS_METRICS).map(metric => metric.key)).size).toBe(keys.length);
  });

  it('declares the contract source and display format for each supported metric', () => {
    expect(ANALYTICS_METRICS.throughput).toMatchObject({ sourceField: 'current.throughput', unit: 'tasks', format: 'integer' });
    expect(ANALYTICS_METRICS.efficiency).toMatchObject({
      sourceField: 'current.success_rate', sampleSizeField: 'current.sample_size', unit: 'percent', format: 'whole-percent',
    });
    expect(ANALYTICS_METRICS.first_pass_yield).toMatchObject({ sourceField: 'radar_advanced.first_pass_yield', unit: 'percent', format: 'whole-percent' });

    for (const metric of Object.values(ANALYTICS_METRICS)) {
      expect(metric.aggregationMeaning.trim().length).toBeGreaterThan(0);
      expect(metric.availabilityRule.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('overview metric values', () => {
  it('preserves measured zero and rejects null or non-finite values', () => {
    expect(getOverviewMetricValue(audit({ current: { ...audit().current, success_rate: 0 } }), 'efficiency')).toBe(0);
    expect(getOverviewMetricValue(audit({ current: { ...audit().current, success_rate: null } }), 'efficiency')).toBeNull();
    expect(getOverviewMetricValue(audit({ current: { ...audit().current, success_rate: Number.NaN } }), 'efficiency')).toBeNull();
    expect(getOverviewMetricValue(audit({ current: { ...audit().current, throughput: Number.POSITIVE_INFINITY } }), 'throughput')).toBeNull();
  });

  it('formats unavailable values, rounded integers, and whole percentages', () => {
    expect(formatOverviewMetricValue('efficiency', null)).toBe('—');
    expect(formatOverviewMetricValue('throughput', 12.6)).toBe(13);
    expect(formatOverviewMetricValue('efficiency', 50.4)).toBe('50%');
    expect(formatOverviewMetricValue('efficiency', 0)).toBe('0%');
  });

  it('reads optional efficiency sample size without converting missing data into zero', () => {
    expect(getOverviewMetricSampleSize(audit(), 'efficiency')).toBe(8);
    expect(getOverviewMetricSampleSize(audit({ current: { ...audit().current, sample_size: undefined } }), 'efficiency')).toBeNull();
    expect(getOverviewMetricSampleSize(audit({ current: { ...audit().current, sample_size: 0 } }), 'efficiency')).toBe(0);
  });
});

describe('organizational audit trend comparison', () => {
  it('keeps undefined metrics and comparisons unavailable', () => {
    expect(compareAuditMetric(null, 5, true)).toEqual({ value: null, delta: null, favorable: null });
    expect(compareAuditMetric(5, null, true)).toEqual({ value: 5, delta: null, favorable: null });
  });

  it('preserves observed zero and compares only observed periods', () => {
    expect(compareAuditMetric(0, 0, true)).toEqual({ value: 0, delta: 0, favorable: true });
    expect(compareAuditMetric(0, 5, false)).toEqual({ value: 0, delta: -5, favorable: true });
  });
});
