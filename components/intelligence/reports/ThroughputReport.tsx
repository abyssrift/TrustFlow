import React from 'react'
import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer'
import { computeSuccessRateTrend, sortPeriodsChronologically } from '@/lib/reporting/reportCalculations'
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

  const orderedRows  = sortPeriodsChronologically(rows)
  const totalSuccess = rows.reduce((s, r) => s + (r.tasks_succeeded || 0), 0)
  const totalFailed  = rows.reduce((s, r) => s + (r.tasks_failed || 0), 0)
  const overallSr    = totalSuccess + totalFailed > 0 ? (totalSuccess / (totalSuccess + totalFailed)) * 100 : null
  const trend        = computeSuccessRateTrend(rows)

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
          { label: 'Overall Rate',     value: overallSr != null ? `${sf(overallSr, 1)}%` : '—', accent: overallSr != null ? (overallSr >= 80 ? C.success : overallSr >= 60 ? C.warning : C.danger) : C.muted, color: overallSr != null ? (overallSr >= 80 ? C.success : overallSr >= 60 ? C.warning : C.danger) : C.muted },
          { label: 'Rate change',      value: trend != null ? `${trend > 0 ? '+' : ''}${sf(trend, 1)} pp` : '—', accent: trend != null ? (trend > 0 ? C.success : trend < 0 ? C.danger : C.muted) : C.muted, color: trend != null ? (trend > 0 ? C.success : trend < 0 ? C.danger : C.muted) : C.muted },
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
              data={orderedRows.map(r => ({
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
              rows={orderedRows.map(r => {
                const sr = r.success_rate
                return {
                  cells: [r.period_label || '—', String(r.tasks_succeeded || 0), String(r.tasks_failed || 0), sr == null ? '—' : `${sf(sr, 1)}%`],
                  colors: [null, C.success, C.danger, sr == null ? C.muted : sr >= 80 ? C.success : sr >= 60 ? C.warning : C.danger],
                }
              })}
            />

            {trend != null && (
              <Insight
                text={`Success rate ${trend > 0 ? 'increased' : trend < 0 ? 'decreased' : 'did not change'} by ${sf(Math.abs(trend), 1)} percentage points from the earliest to the most recent ${periodType} in the window.`}
                color={trend > 0 ? C.success : trend < 0 ? C.danger : C.muted}
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
