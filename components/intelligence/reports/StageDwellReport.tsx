import React from 'react'
import { Document, Page, StyleSheet } from '@react-pdf/renderer'
import { C, base } from './theme'
import { Cover, Footer, Section, Sub, KpiRow, Table, HBar, Empty, Insight, sf, fmtDate, fmtSec } from './shared'

const s = StyleSheet.create({ page: { ...base.page } })

export interface StageDwellData {
  rows: any[]
  pipelineName: string
  dateStart: string
  dateEnd: string
  company: string
}

export function StageDwellReportPages({ data, jobId }: { data: StageDwellData; jobId: string }) {
  const { rows, pipelineName, dateStart, dateEnd } = data

  const bottlenecks   = rows.filter(r => r.is_bottleneck)
  const highReversals = rows.filter(r => (r.reversal_count || 0) > 3)
  const totalSamples  = rows.reduce((s, r) => s + (r.sample_count || 0), 0)
  const avgDwell      = rows.length > 0 ? rows.reduce((s, r) => s + (r.avg_seconds || 0), 0) / rows.length : 0

  return (
    <>
      <Cover
        title="Stage Dwell Analysis"
        subtitle="Avg / median / P75 dwell, bottleneck flags, reversal counts"
        company={pipelineName}
        dateRange={`${fmtDate(dateStart)} — ${fmtDate(dateEnd)}`}
      />

      <Page size="A4" style={s.page}>
        <Section title={`Dwell Times — ${pipelineName}`} />

        <KpiRow items={[
          { label: 'Stages Analyzed',    value: String(rows.length),            accent: C.primary },
          { label: 'Total Transitions',  value: String(totalSamples),           accent: C.primary },
          { label: 'Bottleneck Stages',  value: String(bottlenecks.length),     accent: bottlenecks.length > 0 ? C.danger : C.success, color: bottlenecks.length > 0 ? C.danger : C.success },
          { label: 'Avg Dwell (All)',    value: fmtSec(avgDwell),               accent: C.warning },
        ]} />

        {rows.length === 0 ? (
          <Empty msg="No transition data found for this pipeline in the selected period." />
        ) : (
          <>
            <Sub title="Dwell Time by Stage (Average)" />
            <HBar data={rows.map(r => ({
              label: String(r.stage_name || '—').substring(0, 22),
              value: r.avg_seconds || 0,
              display: fmtSec(r.avg_seconds || 0),
              color: r.is_bottleneck ? C.danger : C.primary,
            }))} />

            <Sub title="Detailed Stage Metrics" />
            <Table
              headers={['Stage', 'Avg', 'Median', 'P75', 'Samples', 'Reversals', 'Status']}
              colFlex={[2.5, 1, 1, 1, 1, 1, 1.2]}
              rows={rows.map(r => ({
                cells: [
                  String(r.stage_name || '—').substring(0, 24),
                  fmtSec(r.avg_seconds || 0),
                  fmtSec(r.median_seconds || 0),
                  fmtSec(r.p75_seconds || 0),
                  String(r.sample_count || 0),
                  String(r.reversal_count || 0),
                  r.is_bottleneck ? 'BOTTLENECK' : 'Normal',
                ],
                colors: [
                  null, null, null, null, null,
                  (r.reversal_count || 0) > 3 ? C.warning : null,
                  r.is_bottleneck ? C.danger : C.success,
                ],
              }))}
            />

            {bottlenecks.length > 0 && (
              <Insight
                text={`${bottlenecks.length} bottleneck stage${bottlenecks.length > 1 ? 's' : ''} detected: ${bottlenecks.map(b => b.stage_name).join(', ')}. These stages are significantly above the pipeline average dwell time.`}
                color={C.danger}
              />
            )}
            {highReversals.length > 0 && (
              <Insight
                text={`High reversal activity in ${highReversals.length} stage${highReversals.length > 1 ? 's' : ''}: ${highReversals.map(r => r.stage_name).join(', ')}. Review approval criteria and stage transition rules.`}
                color={C.warning}
              />
            )}
            {bottlenecks.length === 0 && highReversals.length === 0 && (
              <Insight
                text={`No bottlenecks or high-reversal stages detected. Pipeline flow is healthy across all ${rows.length} stages.`}
                color={C.success}
              />
            )}
          </>
        )}

        <Footer jobId={jobId} />
      </Page>
    </>
  )
}

export function StageDwellReport({ data, jobId }: { data: StageDwellData; jobId: string }) {
  return (
    <Document>
      <StageDwellReportPages data={data} jobId={jobId} />
    </Document>
  )
}
