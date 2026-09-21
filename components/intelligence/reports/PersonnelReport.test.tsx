import React from 'react'
import { Document, renderToBuffer } from '@react-pdf/renderer'
import { describe, expect, it } from 'vitest'
import { PersonnelReportPages } from './PersonnelReport'

describe('PersonnelReport PDF rendering', () => {
  it('renders unavailable rates without treating missing values as zero', async () => {
    const pdf = await renderToBuffer(React.createElement(Document, null, React.createElement(PersonnelReportPages, {
      jobId: 'personnel-null-rates',
      isModule: false,
      data: {
        rows: [
          { full_name: 'Observed', weight_points: 10, completed_tasks: 2, failed_tasks: 1, active_hours: 4, on_time_rate: 80, timer_efficiency: 120, points_per_hour: 2.5 },
          { full_name: 'No data', weight_points: 0, completed_tasks: 0, failed_tasks: 0, active_hours: 0, on_time_rate: null, timer_efficiency: null, points_per_hour: 0 },
        ],
        dateStart: '2025-09-01',
        dateEnd: '2025-09-30',
        company: 'Example',
      },
    })))

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(pdf.byteLength).toBeGreaterThan(1000)
  })

  it('renders tied zero-point leaders without requiring a positive maximum', async () => {
    const pdf = await renderToBuffer(React.createElement(Document, null, React.createElement(PersonnelReportPages, {
      jobId: 'personnel-tied-leaders',
      isModule: false,
      data: {
        rows: [
          { full_name: 'Person A', weight_points: 0, completed_tasks: 0, failed_tasks: 0, active_hours: 0, on_time_rate: null, timer_efficiency: null, points_per_hour: 0 },
          { full_name: 'Person B', weight_points: 0, completed_tasks: 0, failed_tasks: 0, active_hours: 0, on_time_rate: null, timer_efficiency: null, points_per_hour: 0 },
        ],
        dateStart: '2025-09-01',
        dateEnd: '2025-09-30',
        company: 'Example',
      },
    })))

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(pdf.byteLength).toBeGreaterThan(1000)
  })
})
