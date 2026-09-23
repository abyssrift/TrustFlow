import { describe, expect, it } from 'vitest';
import { displayReportValue, getReportReaderModel } from './ReportReaderModel';

describe('report reader presentation', () => {
  it('keeps observed zero distinct from unavailable values', () => {
    expect(displayReportValue(0)).toBe('0');
    expect(displayReportValue(null)).toBe('N/A');
    expect(displayReportValue(undefined)).toBe('N/A');
  });

  it('exposes scope, period, freshness, methodology, findings and actions', () => {
    const model = getReportReaderModel({
      id: 'report-1',
      report_type: 'team_comparison',
      status: 'completed',
      completed_at: '2026-09-23T10:00:00.000Z',
      parameters: { date_start: '2026-09-01', date_end: '2026-09-23', scope: 'Team Alpha' },
      manifest: { methodology: 'Completed tasks / eligible tasks', freshness: '2026-09-23T10:00:00.000Z' },
      snapshot: {
        findings: ['Cycle time improved'],
        actions: [{ title: 'Review stalled work' }],
        metrics: [{ label: 'Completed', value: 0 }],
      },
    });

    expect(model.scope).toBe('Team Alpha');
    expect(model.period).toContain('2026-09-01');
    expect(model.methodology).toBe('Completed tasks / eligible tasks');
    expect(model.findings).toEqual(['Cycle time improved']);
    expect(model.actions).toEqual(['Review stalled work']);
    expect(model.noLeader).toBe(true);
  });

  it('surfaces required-source errors and does not invent a leader', () => {
    const model = getReportReaderModel({
      id: 'report-2',
      status: 'failed',
      manifest: { required_source_error: 'Pipeline source unavailable' },
      snapshot: { metrics: [{ label: 'Rate', value: null }] },
    });

    expect(model.requiredSourceError).toBe('Pipeline source unavailable');
    expect(model.noLeader).toBe(true);
    expect(model.leaders).toEqual([]);
  });
});
