import React from 'react'
import { Document, renderToBuffer } from '@react-pdf/renderer'
import { describe, expect, it } from 'vitest'
import { TargetsReportPages } from './TargetsReport'

describe('TargetsReport PDF rendering', () => {
  it('renders an empty target set with a valid report instead of dividing by zero', async () => {
    const pdf = await renderToBuffer(React.createElement(Document, null, React.createElement(TargetsReportPages, {
      jobId: 'empty-targets',
      isModule: false,
      data: { targets: [], company: 'Example' },
    })))

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(pdf.byteLength).toBeGreaterThan(1000)
  })
})
