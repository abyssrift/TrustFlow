import { describe, expect, it } from 'vitest'
import { buildGeneralKpis, buildRadarKpis, computeGeneralInsights, generalReportDelta, rankWorkersByTasksPerHour, withTasksPerHour } from './GeneralReport'

describe('General Report nullable organizational KPIs', () => {
  it('renders unavailable current metrics as N/A with neutral styling and no comparison note', () => {
    const kpis = buildGeneralKpis({
      throughput: null,
      avg_lead_time_minutes: null,
      success_rate: null,
      revision_rate: null,
    }, {
      throughput: 5,
      avg_lead_time_minutes: 10,
      success_rate: 90,
    })

    expect(kpis.map(({ value }) => value)).toEqual(['N/A', 'N/A', 'N/A', 'N/A'])
    expect(kpis.slice(1).every(kpi => kpi.accent === kpi.neutralColor && kpi.color === kpi.neutralColor)).toBe(true)
    expect(kpis[0].note).toBeUndefined()
    expect(kpis.slice(1).map(kpi => kpi.note)).toEqual([undefined, undefined, 'Rework ratio'])
  })

  it('suppresses comparison percentages when either period is undefined', () => {
    const currentEmpty = buildGeneralKpis({ success_rate: 45 }, { success_rate: null })
    const priorEmpty = buildGeneralKpis({ success_rate: null }, { success_rate: 45 })
    const bothEmpty = buildGeneralKpis({ success_rate: null }, { success_rate: undefined })

    expect([currentEmpty[2].note, priorEmpty[2].note, bothEmpty[2].note]).toEqual([undefined, undefined, undefined])
  })

  it('preserves measured zero values, including zero in both periods', () => {
    const [throughput, leadTime, success, revision] = buildGeneralKpis({
      throughput: 0,
      avg_lead_time_minutes: 0,
      success_rate: 0,
      revision_rate: 0,
    }, {
      throughput: 0,
      avg_lead_time_minutes: 0,
      success_rate: 0,
    })

    expect(throughput.value).toBe('0')
    expect(throughput.note).toBe('0 in both periods')
    expect(leadTime.value).toBe('0.0m')
    expect(leadTime.note).toBe('0 in both periods')
    expect(success.value).toBe('0.0%')
    expect(success.note).toBe('0 in both periods')
    expect(revision.value).toBe('0.0%')
    expect(revision.note).toBe('Rework ratio')
  })

  it('shows undefined radar metrics as neutral N/A and preserves observed radar zeros', () => {
    const [missingFlow, missingYield] = buildRadarKpis({ flow_ratio: null, first_pass_yield: undefined })
    const [zeroFlow, zeroYield] = buildRadarKpis({ flow_ratio: 0, first_pass_yield: 0 })

    expect([missingFlow.value, missingYield.value]).toEqual(['N/A', 'N/A'])
    expect(missingFlow.accent).toBe(missingFlow.neutralColor)
    expect(missingYield.accent).toBe(missingYield.neutralColor)
    expect([zeroFlow.value, zeroYield.value]).toEqual(['0.0%', '0.0%'])
  })

  it('does not evaluate threshold insights for undefined current metrics', () => {
    const insights = computeGeneralInsights({
      audit: {
        current: { success_rate: null, revision_rate: undefined },
        radar_advanced: { first_pass_yield: null },
      },
      company: 'Example',
      dateRange: 'Period',
    })

    expect(insights.map(insight => insight.text)).toEqual([
      'Insufficient data for automated insights. Expand the date range for more meaningful analysis.',
    ])
  })
})

describe('General Report comparison notes', () => {
  it('describes zero in both periods neutrally', () => {
    const note = generalReportDelta(0, 0)

    expect(note).toBe('0 in both periods')
    expect(note).not.toContain('NEW')
    expect(note).not.toContain('%')
  })

  it('preserves unchanged, increasing, and decreasing notes for nonzero prior values', () => {
    expect(generalReportDelta(5, 5)).toBe('0% vs prior')
    expect(generalReportDelta(6, 4)).toBe('+50% vs prior')
    expect(generalReportDelta(2, 4)).toBe('-50% vs prior')
  })

  it('preserves NEW for zero-to-positive comparisons', () => {
    expect(generalReportDelta(1, 0)).toBe('NEW')
  })
})

describe('General Report worker productivity', () => {
  it('ranks by tasks per hour when total-hours order disagrees', () => {
    const ranked = rankWorkersByTasksPerHour([
      { full_name: 'A', task_count: 20, total_hours: 40 },
      { full_name: 'B', task_count: 10, total_hours: 5 },
    ])

    expect(ranked.map(worker => worker.full_name)).toEqual(['B', 'A'])
    expect(ranked.map(worker => worker.tasks_per_hour)).toEqual([2, 0.5])
  })

  it('includes fast workers beyond the original first eight chart rows', () => {
    const workers = Array.from({ length: 9 }, (_, index) => ({
      full_name: `Worker ${index + 1}`,
      task_count: index === 8 ? 100 : 1,
      total_hours: index === 8 ? 1 : 10 - index,
    }))

    expect(rankWorkersByTasksPerHour(workers).slice(0, 8).map(worker => worker.full_name))
      .toContain('Worker 9')
  })

  it('keeps tied maximum observations adjacent and identifiable', () => {
    const ranked = rankWorkersByTasksPerHour([
      { full_name: 'A', task_count: 20, total_hours: 10 },
      { full_name: 'B', task_count: 6, total_hours: 3 },
      { full_name: 'C', task_count: 2, total_hours: 2 },
    ])

    expect(ranked.filter(worker => worker.tasks_per_hour === ranked[0].tasks_per_hour).map(worker => worker.full_name))
      .toEqual(['A', 'B'])

    const insights = computeGeneralInsights({
      audit: {
        worker_time_metrics: [
          { full_name: 'A', task_count: 20, total_hours: 10 },
          { full_name: 'B', task_count: 6, total_hours: 3 },
          { full_name: 'C', task_count: 2, total_hours: 2 },
        ],
      },
      company: 'Example',
      dateRange: 'Period',
    })
    expect(insights.map(insight => insight.text)).toContain('Top performers (tied): A, B at 2.0 tasks/hour.')
  })

  it('excludes missing, zero, negative, and non-finite hour observations from rankings', () => {
    const ranked = rankWorkersByTasksPerHour([
      { full_name: 'Missing', task_count: 10 },
      { full_name: 'Zero', task_count: 10, total_hours: 0 },
      { full_name: 'Negative', task_count: 10, total_hours: -1 },
      { full_name: 'Infinite', task_count: 10, total_hours: Infinity },
      { full_name: 'NaN', task_count: 10, total_hours: NaN },
      { full_name: 'Overflow rate', task_count: Number.MAX_VALUE, total_hours: Number.MIN_VALUE },
      { full_name: 'Valid', task_count: 1, total_hours: 1 },
    ])

    expect(ranked.map(worker => worker.full_name)).toEqual(['Valid'])
  })

  it('preserves upstream order for the People Detail rows', () => {
    const source = [
      { full_name: 'Slow', task_count: 1, total_hours: 10 },
      { full_name: 'Fast', task_count: 10, total_hours: 1 },
    ]

    expect(withTasksPerHour(source).map(worker => worker.full_name)).toEqual(['Slow', 'Fast'])
    expect(source.map(worker => worker.full_name)).toEqual(['Slow', 'Fast'])
  })
})
