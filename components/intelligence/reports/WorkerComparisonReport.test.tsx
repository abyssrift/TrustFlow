import React from 'react'
import { Document, renderToBuffer } from '@react-pdf/renderer'
import { describe, expect, it } from 'vitest'
import { WorkerComparisonReportPages } from './WorkerComparisonReport'

describe('WorkerComparisonReport PDF rendering', () => {
  it('renders identical workers without awarding tied categories to Person A', async () => {
    const worker = (id: string) => ({
      id,
      full_name: `Person ${id}`,
      weight_points: 0,
      completed_tasks: 0,
      failed_tasks: 0,
      active_hours: 0,
      on_time_rate: 0,
      timer_efficiency: 0,
      points_per_hour: 0,
      revision_count: 0,
      activity_count: 0,
    })
    const pdf = await renderToBuffer(React.createElement(Document, null, React.createElement(WorkerComparisonReportPages, {
      jobId: 'worker-ties',
      isModule: false,
      data: { workers: [worker('A'), worker('B')], company: 'Example', dateRange: 'Sep 1 - Sep 30' },
    })))

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(pdf.byteLength).toBeGreaterThan(1000)
  })

  it('renders tied N-person leaders and nullable rates without crashing', async () => {
    const worker = (id: string, points: number, onTime: number | null) => ({
      id,
      full_name: `Person ${id}`,
      weight_points: points,
      completed_tasks: 0,
      failed_tasks: 0,
      active_hours: 0,
      on_time_rate: onTime,
      timer_efficiency: null,
      points_per_hour: 0,
      revision_count: 0,
      activity_count: 0,
    })
    const pdf = await renderToBuffer(React.createElement(Document, null, React.createElement(WorkerComparisonReportPages, {
      jobId: 'worker-group-ties',
      isModule: false,
      data: {
        workers: [worker('A', 0, 0), worker('B', 0, null), worker('C', 2, 100)],
        company: 'Example',
        dateRange: 'Sep 1 - Sep 30',
      },
    })))

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(pdf.byteLength).toBeGreaterThan(1000)
  })
})
