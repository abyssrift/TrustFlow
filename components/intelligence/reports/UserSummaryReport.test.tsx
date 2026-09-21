import React from 'react'
import { Document, renderToBuffer } from '@react-pdf/renderer'
import { describe, expect, it } from 'vitest'
import { UserSummaryReportPages } from './UserSummaryReport'

describe('UserSummaryReport PDF rendering', () => {
  it('renders unavailable efficiency and on-time values neutrally', async () => {
    const pdf = await renderToBuffer(React.createElement(Document, null, React.createElement(UserSummaryReportPages, {
      jobId: 'summary-missing-rates',
      isModule: false,
      data: {
        summary: {
          active_seconds: 0,
          estimated_seconds: 0,
          timer_efficiency: null,
          on_time_rate: null,
          completed_tasks: 0,
          failed_tasks: 0,
          weight_points: 0,
          on_time_tasks: 0,
          revision_count: 0,
        },
        workerName: 'Example Person',
        dateStart: '2025-09-01',
        dateEnd: '2025-09-30',
        company: 'Example',
      },
    })))

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(pdf.byteLength).toBeGreaterThan(1000)
  })
})
