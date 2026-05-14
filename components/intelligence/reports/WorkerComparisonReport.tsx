import React from 'react'
import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer'
import { C, F, base } from './theme'
import { Cover, Footer, Section, Sub, KpiRow, CompareGrid, Empty, Insight, sf, fmtDate } from './shared'

const s = StyleSheet.create({ page: { ...base.page } })

export interface WorkerComparisonData {
  workers: any[]
  company: string
  dateRange: string
}

export function WorkerComparisonReport({ data, jobId }: { data: WorkerComparisonData; jobId: string }) {
  const [wA, wB] = data.workers || []

  if (!wA || !wB) {
    return (
      <Document>
        <Cover title="Personnel Benchmarking" subtitle="Head-to-head worker performance comparison" company={data.company} dateRange={data.dateRange} />
        <Page size="A4" style={s.page}>
          <Section title="Comparison" />
          <Empty msg="Insufficient data. Ensure both workers have activity in the selected period." />
          <Footer jobId={jobId} />
        </Page>
      </Document>
    )
  }

  const rows = [
    { label: 'Weight Points',    vA: String(wA.weight_points || 0),       vB: String(wB.weight_points || 0),       winA: (wA.weight_points || 0) >= (wB.weight_points || 0) },
    { label: 'Tasks Completed',  vA: String(wA.completed_tasks || 0),     vB: String(wB.completed_tasks || 0),     winA: (wA.completed_tasks || 0) >= (wB.completed_tasks || 0) },
    { label: 'Tasks Failed',     vA: String(wA.failed_tasks || 0),        vB: String(wB.failed_tasks || 0),        winA: (wA.failed_tasks || 0) <= (wB.failed_tasks || 0) },
    { label: 'Active Hours',     vA: `${sf(wA.active_hours, 1)}h`,        vB: `${sf(wB.active_hours, 1)}h`,        winA: (wA.active_hours || 0) >= (wB.active_hours || 0) },
    { label: 'On-Time Rate',     vA: `${sf(wA.on_time_rate, 1)}%`,        vB: `${sf(wB.on_time_rate, 1)}%`,        winA: (wA.on_time_rate || 0) >= (wB.on_time_rate || 0) },
    { label: 'Timer Efficiency', vA: `${sf(wA.timer_efficiency, 1)}%`,    vB: `${sf(wB.timer_efficiency, 1)}%`,    winA: (wA.timer_efficiency || 0) >= (wB.timer_efficiency || 0) },
    { label: 'Points / Hour',    vA: sf(wA.points_per_hour, 2),           vB: sf(wB.points_per_hour, 2),           winA: (wA.points_per_hour || 0) >= (wB.points_per_hour || 0) },
    { label: 'Revisions',        vA: String(wA.revision_count || 0),      vB: String(wB.revision_count || 0),      winA: (wA.revision_count || 0) <= (wB.revision_count || 0) },
    { label: 'Activity Count',   vA: String(wA.activity_count || 0),      vB: String(wB.activity_count || 0),      winA: (wA.activity_count || 0) >= (wB.activity_count || 0) },
  ]

  const winsA = rows.filter(r => r.winA).length
  const winsB = rows.length - winsA
  const winner = winsA > winsB ? wA.full_name : winsB > winsA ? wB.full_name : null

  return (
    <Document>
      <Cover
        title="Personnel Benchmarking"
        subtitle="Head-to-head worker performance comparison"
        company={data.company}
        dateRange={data.dateRange}
      />

      <Page size="A4" style={s.page}>
        <Section title="Head-to-Head Comparison" />
        <KpiRow items={[
          { label: wA.full_name || 'Worker A', value: `${winsA} wins`,  note: 'Categories leading', accent: C.success },
          { label: wB.full_name || 'Worker B', value: `${winsB} wins`,  note: 'Categories leading', accent: C.primary },
          { label: 'Overall Winner',           value: winner || 'TIE',  note: winner ? `${Math.round((Math.max(winsA, winsB) / rows.length) * 100)}% categories` : 'Equal performance', accent: winner ? C.success : C.muted },
        ]} />

        <Sub title="Metric Breakdown" />
        <CompareGrid
          nameA={String(wA.full_name || 'Worker A').substring(0, 18)}
          nameB={String(wB.full_name || 'Worker B').substring(0, 18)}
          rows={rows}
        />

        {winner && (
          <Insight
            text={`${winner} leads in ${Math.max(winsA, winsB)} of ${rows.length} measured categories — a clear performance advantage in this period.`}
            color={C.success}
          />
        )}
        <Footer jobId={jobId} />
      </Page>
    </Document>
  )
}
