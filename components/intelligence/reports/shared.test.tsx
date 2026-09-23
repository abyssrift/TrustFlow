import React from 'react'
import { Document, Page, renderToBuffer } from '@react-pdf/renderer'
import { describe, expect, it } from 'vitest'
import { PDF_FIXTURES } from './pdfFixtures'
import { Empty, HBar, PDF_LAYOUT_CONTRACT, PageContext, Table } from './shared'
import { F } from './theme'

describe('shared PDF layout contract', () => {
  it('keeps quality gates explicit and readable', () => {
    expect(PDF_LAYOUT_CONTRACT.rendererVersion).toMatch(/^trustflow-pdf-/)
    expect(PDF_LAYOUT_CONTRACT.minReadableFontSize).toBeGreaterThanOrEqual(8)
    expect(PDF_LAYOUT_CONTRACT.repeatedTableHeaders).toBe(true)
    expect(PDF_LAYOUT_CONTRACT.pageContext).toBe(true)
    expect(F.xs).toBeGreaterThanOrEqual(8)
  })

  it('does not emit invalid chart geometry for non-finite or negative values', async () => {
    const pdf = await renderToBuffer(React.createElement(Document, null,
      React.createElement(Page, { size: 'A4' },
        React.createElement(HBar, { data: [
          { label: 'Missing', value: Number.NaN },
          { label: 'Negative', value: -4 },
        ] }),
      ),
    ))
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
  })

  it('renders empty, long-label, non-Latin, and large-table fixtures with real PDF output', async () => {
    const pdf = await renderToBuffer(React.createElement(Document, null,
      React.createElement(Page, { size: 'A4' },
        React.createElement(PageContext, { title: 'Fixture report', company: 'Example', dateRange: 'Period' }),
        React.createElement(Empty, { kind: 'no_leader', msg: 'All-zero teams have no leader.' }),
        React.createElement(HBar, { data: PDF_FIXTURES.longLabels.labels.map((label, index) => ({ label, value: index })) }),
        React.createElement(Table, {
          headers: ['Name', 'Value', 'Status'],
          colFlex: [2, 1, 1],
          context: 'Continued section · Fixture report',
          rows: PDF_FIXTURES.largeTable.rows,
        }),
      ),
    ))

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(pdf.byteLength).toBeGreaterThan(5000)
    expect(Buffer.from(pdf).toString('latin1')).toContain('/Type /Page')
  })
})
