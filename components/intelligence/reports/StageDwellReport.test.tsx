import React from 'react'
import { Document, renderToBuffer } from '@react-pdf/renderer'
import { describe, expect, it } from 'vitest'
import { StageDwellReportPages } from './StageDwellReport'

describe('StageDwellReport PDF rendering', () => {
  it('renders weighted dwell summaries and stages with no samples', async () => {
    const pdf = await renderToBuffer(React.createElement(Document, null, React.createElement(StageDwellReportPages, {
      jobId: 'weighted-dwell',
      isModule: false,
      data: {
        pipelineName: 'Example pipeline',
        dateStart: '2025-09-01',
        dateEnd: '2025-09-30',
        company: 'Example',
        rows: [
          { stage_name: 'Rare long stage', avg_seconds: 90, median_seconds: 90, p75_seconds: 90, sample_count: 1, reversal_count: 0, is_bottleneck: true },
          { stage_name: 'Common short stage', avg_seconds: 10, median_seconds: 10, p75_seconds: 10, sample_count: 9, reversal_count: 0, is_bottleneck: false },
          { stage_name: 'Unused stage', avg_seconds: 0, median_seconds: 0, p75_seconds: 0, sample_count: 0, reversal_count: 0, is_bottleneck: false },
        ],
      },
    })))

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(pdf.byteLength).toBeGreaterThan(1000)
  })
})
