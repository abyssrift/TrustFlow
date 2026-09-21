import React from 'react'
import { Document, renderToBuffer } from '@react-pdf/renderer'
import { describe, expect, it } from 'vitest'
import { TeamComparisonReportPages } from './TeamComparisonReport'

const team = (id: string, pts: number) => ({
  id,
  name: `Team ${id.toUpperCase()}`,
  count: 3,
  completed: 4,
  failed: 1,
  pts,
  hours: 8,
})

describe('TeamComparisonReport PDF rendering', () => {
  it('renders a tied N-team points maximum to a non-empty PDF', async () => {
    const pdf = await renderToBuffer(React.createElement(Document, null, React.createElement(TeamComparisonReportPages, {
      jobId: 'tie-test',
      isModule: false,
      data: {
        teams: [team('a', 18), team('b', 25), team('c', 25)],
        company: 'Example',
        dateRange: 'Sep 1 - Sep 30',
        overlappingMemberCount: 0,
      },
    })))

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(pdf.byteLength).toBeGreaterThan(1000)
  })

  it('renders all-zero N-team points without a false ranking maximum', async () => {
    const pdf = await renderToBuffer(React.createElement(Document, null, React.createElement(TeamComparisonReportPages, {
      jobId: 'zero-test',
      isModule: false,
      data: {
        teams: [team('a', 0), team('b', 0), team('c', 0)],
        company: 'Example',
        dateRange: 'Sep 1 - Sep 30',
        overlappingMemberCount: 0,
      },
    })))

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(pdf.byteLength).toBeGreaterThan(1000)
  })

  it('renders a report when a team has no task outcomes', async () => {
    const pdf = await renderToBuffer(React.createElement(Document, null, React.createElement(TeamComparisonReportPages, {
      jobId: 'no-outcomes-test',
      isModule: false,
      data: {
        teams: [team('a', 10), { ...team('b', 0), completed: 0, failed: 0 }, team('c', 5)],
        company: 'Example',
        dateRange: 'Sep 1 - Sep 30',
        overlappingMemberCount: 0,
      },
    })))

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(pdf.byteLength).toBeGreaterThan(1000)
  })
})
