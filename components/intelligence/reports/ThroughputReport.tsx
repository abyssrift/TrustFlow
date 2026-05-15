import React from 'react'
import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer'
import { C, F, base } from './theme'
import { Cover, Footer, Section, SectionDivider, Sub, KpiRow, Table, StackedVBar, Empty, Insight, sf } from './shared'

const s = StyleSheet.create({
  page: { ...base.page },
  legend: { flexDirection: 'row', gap: 16, marginBottom: 10 },
  dot: { width: 10, height: 10, borderRadius: 2, marginRight: 4 },
  legendRow: { flexDirection: 'row', alignItems: 'center' },
  legendText: { fontSize: F.xs, color: C.muted },
})

export interface ThroughputData {
  rows: any[]
  pipelineName: string
  periodType: string
  nPeriods: number
  company: string
}

export function ThroughputReportPages({ data, jobId, isModule }: { data: ThroughputData; jobId: string; isModule?: boolean }) {
  const { rows, pipelineName, periodType, nPeriods } = data

  const validRows    = rows.filter(r => (r.tasks_succeeded || 0) + (r.tasks_failed || 0) > 0)
  const totalSuccess = rows.reduce((s, r) => s + (r.tasks_succeeded || 0), 0)
  const totalFailed  = rows.reduce((s, r) => s + (r.tasks_failed || 0), 0)
  const overallSr    = totalSuccess + totalFailed > 0 ? Math.round((totalSuccess / (totalSuccess + totalFailed)) * 100) : null

  const trend = validRows.length >= 2
    ? (validRows[validRows.length - 1].success_rate || 0) - (validRows[0].success_rate || 0)
    : null

  return (
    <>
      {!isModule && (
        <Cover
          title="Pipeline Throughput Report"
          subtitle="Period success / failure rates across a pipeline"
          company={pipelineName}
          dateRange={`${nPeriods} ${periodType}(s)`}
        />
      )}

      <Page size="A4" style={s.page}>
        {isModule && <SectionDivider title="Pipeline Throughput" company={pipelineName} dateRange={`${nPeriods} ${periodType}(s)`} />}
        <Section title={`Throughput — ${pipelineName}`} />

        <KpiRow items={[
          { label: 'Total Succeeded',  value: String(totalSuccess),                 accent: C.success },
          { label: 'Total Failed',     value: String(totalFailed),                  accent: C.danger, color: totalFailed > 0 ? C.danger : C.muted },
          { label: 'Overall Rate',     value: overallSr != null ? `${overallSr}%` : '—', accent: overallSr != null ? (overallSr >= 80 ? C.success : overallSr >= 60 ? C.warning : C.danger) : C.muted, color: overallSr != null ? (overallSr >= 80 ? C.success : overallSr >= 60 ? C.warning : C.danger) : C.muted },
          { label: 'Trend',            value: trend != null ? `${trend >= 0 ? '+' : ''}${sf(trend, 1)}%` : '—', accent: trend != null ? (trend >= 0 ? C.success : C.danger) : C.muted, color: trend != null ? (trend >= 0 ? C.success : C.danger) : C.muted },
        ]} />

        {rows.length === 0 ? (
          <Empty msg="No throughput data found for this pipeline." />
        ) : (
          <>
            <Sub title={`${periodType.charAt(0).toUpperCase() + periodType.slice(1)}-over-${periodType} volume`} />
            <View style={s.legend}>
              <View style={s.legendRow}>
                <View style={[s.dot, { backgroundColor: C.success }]} />
                <Text style={s.legendText}>Succeeded</Text>
              </View>
              <View style={s.legendRow}>
                <View style={[s.dot, { backgroundColor: C.danger }]} />
                <Text style={s.legendText}>Failed</Text>
              </View>
            </View>
            <StackedVBar
              data={rows.map(r => ({
                label: r.period_label || '—',
                success: r.tasks_succeeded || 0,
                fail: r.tasks_failed || 0,
              }))}
              height={90}
            />

            <Sub title="Period Detail" />
            <Table
              headers={['Period', 'Succeeded', 'Failed', 'Success Rate']}
              colFlex={[2.5, 1.5, 1.5, 2]}
              rows={rows.map(r => {
                const sr = r.success_rate || 0
                return {
                  cells: [r.period_label || '—', String(r.tasks_succeeded || 0), String(r.tasks_failed || 0), `${sf(sr, 1)}%`],
                  colors: [null, C.success, C.danger, sr >= 80 ? C.success : sr >= 60 ? C.warning : C.danger],
                }
              })}
            />

            {trend != null && (
              <Insight
                text={`Success rate ${trend >= 0 ? 'improved by' : 'declined by'} ${sf(Math.abs(trend), 1)}% comparing the most recent ${periodType} to the earliest in the window.`}
                color={trend >= 0 ? C.success : C.danger}
              />
            )}
          </>
        )}

        <Footer jobId={jobId} />
      </Page>
    </>
  )
}

export function ThroughputReport({ data, jobId }: { data: ThroughputData; jobId: string }) {
  return (
    <Document>
      <ThroughputReportPages data={data} jobId={jobId} />
    </Document>
  )
}
