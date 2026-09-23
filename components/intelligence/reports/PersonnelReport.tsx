import { Document, Page, StyleSheet } from '@react-pdf/renderer'
import React from 'react'
import { Cover, Empty, Footer, HBar, Insight, KpiRow, Section, SectionDivider, Sub, Table, fmtDate, sf } from './shared'
import { C, base } from './theme'
import { computeAverageObservedMetric, findTopTeamPointLeaders } from '@/lib/reporting/reportCalculations'

const s = StyleSheet.create({ page: { ...base.page } })

export interface PersonnelData {
  rows: any[]
  dateStart: string
  dateEnd: string
  company: string
}

export function PersonnelReportPages({ data, jobId, isModule }: { data: PersonnelData; jobId: string; isModule?: boolean }) {
  const { rows, dateStart, dateEnd } = data
  const dr = `${fmtDate(dateStart)} — ${fmtDate(dateEnd)}`

  if (rows.length === 0) {
    return (
      <>
        {!isModule && <Cover title="People Performance Comparison" subtitle="Workload, on-time completion & efficiency across people" company={data.company} dateRange={dr} />}
        <Page size="A4" style={s.page}>
          {isModule && <SectionDivider title="People Performance Comparison" company={data.company} dateRange={dr} />}
          <Section title="Personnel Metrics" />
          <Empty msg="No data for the selected people in this period." />
          <Footer jobId={jobId} />
        </Page>
      </>
    )
  }

  const ranking = findTopTeamPointLeaders(rows.map(r => ({ ...r, pts: r.weight_points || 0 })))!
  const maxPts = ranking.maxPoints
  const topPerformers = ranking.leaders
  const topPerf = topPerformers[0]
  const hasObservedPoints = maxPts > 0
  const avgOtr  = computeAverageObservedMetric(rows.map(r => r.on_time_rate))
  const avgEff  = computeAverageObservedMetric(rows.map(r => r.timer_efficiency))
  const formatPercent = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value) ? `${sf(value, 1)}%` : '—'
  // Cost output stays disabled until a trusted rate source and retention policy exist.
  const costRows: any[] = []

  return (
    <>
      {!isModule && <Cover title="People Performance Comparison" subtitle="Workload, on-time completion & efficiency across people" company={data.company} dateRange={dr} />}

      <Page size="A4" style={s.page}>
        {isModule && <SectionDivider title="People Performance Comparison" company={data.company} dateRange={dr} />}
        <Section title="Personnel Overview" />

        <KpiRow items={[
          { label: 'People Compared', value: String(rows.length),          accent: C.primary },
          { label: hasObservedPoints ? (topPerformers.length === 1 ? 'Top Performer' : 'Top Performers') : 'Top Performer', value: hasObservedPoints ? (topPerformers.length === 1 ? String(topPerf.full_name || '—').substring(0, 14) : `${topPerformers.length} tied`) : 'N/A', note: hasObservedPoints ? `${maxPts} pts${topPerformers.length === 1 ? '' : ' each'}` : 'No observed output', accent: hasObservedPoints ? C.success : C.muted },
          { label: 'Avg On-Time Rate', value: avgOtr === null ? 'N/A' : `${sf(avgOtr, 1)}%`, accent: avgOtr === null ? C.muted : avgOtr >= 80 ? C.success : avgOtr >= 60 ? C.warning : C.danger, color: avgOtr === null ? C.muted : avgOtr >= 80 ? C.success : avgOtr >= 60 ? C.warning : C.danger },
          { label: 'Avg Efficiency',   value: avgEff === null ? 'N/A' : `${sf(avgEff, 1)}%`, accent: avgEff === null ? C.muted : avgEff <= 110 ? C.success : C.warning },
        ]} />

        <Sub title="Points Ranking" />
        <HBar data={rows.map(r => ({
          label: String(r.full_name || '—').substring(0, 22),
          value: r.weight_points || 0,
          color: hasObservedPoints && (r.weight_points || 0) === maxPts ? C.success : C.primary,
        }))} />

        <Sub title="Full Metrics Table" />
        <Table
          headers={['Person', 'Pts', 'Done', 'Failed', 'Hours', 'On-Time%', 'Eff%', 'Pts/Hr']}
          colFlex={[2.5, 1, 1, 1, 1, 1.2, 1.2, 1.2]}
          rows={rows.map(r => ({
            cells: [
              String(r.full_name || '—').substring(0, 20),
              String(r.weight_points || 0),
              String(r.completed_tasks || 0),
              String(r.failed_tasks || 0),
              `${sf(r.active_hours, 1)}h`,
              formatPercent(r.on_time_rate),
              formatPercent(r.timer_efficiency),
              sf(r.points_per_hour, 2),
            ],
            colors: [
              hasObservedPoints && (r.weight_points || 0) === maxPts ? C.success : null,
              null, null, (r.failed_tasks || 0) > 0 ? C.danger : null, null,
              typeof r.on_time_rate !== 'number' || !Number.isFinite(r.on_time_rate) ? null : r.on_time_rate >= 80 ? C.success : r.on_time_rate >= 60 ? C.warning : C.danger,
              typeof r.timer_efficiency !== 'number' || !Number.isFinite(r.timer_efficiency) ? null : r.timer_efficiency <= 110 ? C.success : C.warning,
              null,
            ],
          }))}
        />

        {costRows.length > 0 && (
          <>
            <Sub title="Cost Analysis" />
            <Table
              headers={['Person', 'Daily Rate (USD)', 'Total Cost (USD)', 'Cost / Point']}
              colFlex={[2.5, 2, 2, 2]}
              rows={costRows.map(r => ({
                cells: [
                  String(r.full_name || '—').substring(0, 22),
                  `$${sf(r.daily_rate_usd, 2)}`,
                  `$${sf(r.total_cost_usd, 2)}`,
                  `$${sf(r.cost_per_point, 2)}`,
                ],
              }))}
            />
          </>
        )}

        {hasObservedPoints
          ? <Insight
              text={topPerformers.length === 1
                ? `${topPerf.full_name || 'Top person'} leads the group with ${maxPts} points.`
                : `${topPerformers.length} people tie for the lead at ${maxPts} points.`}
              color={C.success}
            />
          : <Empty kind="no_leader" msg="All selected people have zero observed points in this period." />}

        <Footer jobId={jobId} />
      </Page>
    </>
  )
}

export function PersonnelReport({ data, jobId }: { data: PersonnelData; jobId: string }) {
  return (
    <Document>
      <PersonnelReportPages data={data} jobId={jobId} />
    </Document>
  )
}
