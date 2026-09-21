import { Document, Page, StyleSheet } from '@react-pdf/renderer'
import React from 'react'
import { CompareGrid, Cover, Empty, Footer, HBar, Insight, KpiRow, Section, SectionDivider, Sub, Table, sf } from './shared'
import { C, base } from './theme'
import { compareTeamMetric, computeAverageObservedMetric, findTopTeamPointLeaders, tallyComparisonWins } from '@/lib/reporting/reportCalculations'

const s = StyleSheet.create({ page: { ...base.page } })

export interface WorkerComparisonData {
  workers: any[]
  company: string
  dateRange: string
}

export function WorkerComparisonReportPages({ data, jobId, isModule }: { data: WorkerComparisonData; jobId: string; isModule?: boolean }) {
  const workers = data.workers || []

  if (workers.length === 0) {
    return (
      <>
        {!isModule && <Cover title="People Comparison" subtitle="Head-to-head people performance comparison" company={data.company} dateRange={data.dateRange} />}
        <Page size="A4" style={s.page}>
          {isModule && <SectionDivider title="People Comparison" company={data.company} dateRange={data.dateRange} />}
          <Section title="Comparison" />
          <Empty msg="Insufficient data. Ensure the selected people have activity in the period." />
          <Footer jobId={jobId} />
        </Page>
      </>
    )
  }

  // ── 2-worker head-to-head layout ──────────────────────────────────────────
  if (workers.length === 2) {
    const [wA, wB] = workers
    const metric = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null
    const rows = [
      { label: 'Weight Points',    vA: String(wA.weight_points || 0),       vB: String(wB.weight_points || 0),       winA: compareTeamMetric(metric(wA.weight_points), metric(wB.weight_points)) },
      { label: 'Tasks Completed',  vA: String(wA.completed_tasks || 0),     vB: String(wB.completed_tasks || 0),     winA: compareTeamMetric(metric(wA.completed_tasks), metric(wB.completed_tasks)) },
      { label: 'Tasks Failed',     vA: String(wA.failed_tasks || 0),        vB: String(wB.failed_tasks || 0),        winA: compareTeamMetric(metric(wA.failed_tasks), metric(wB.failed_tasks), 'lower') },
      { label: 'Active Hours',     vA: `${sf(wA.active_hours, 1)}h`,        vB: `${sf(wB.active_hours, 1)}h`,        winA: compareTeamMetric(metric(wA.active_hours), metric(wB.active_hours)) },
      { label: 'On-Time Rate',     vA: `${sf(wA.on_time_rate, 1)}%`,        vB: `${sf(wB.on_time_rate, 1)}%`,        winA: compareTeamMetric(metric(wA.on_time_rate), metric(wB.on_time_rate)) },
      { label: 'Timer Efficiency', vA: `${sf(wA.timer_efficiency, 1)}%`,    vB: `${sf(wB.timer_efficiency, 1)}%`,    winA: compareTeamMetric(metric(wA.timer_efficiency), metric(wB.timer_efficiency)) },
      { label: 'Points / Hour',    vA: sf(wA.points_per_hour, 2),           vB: sf(wB.points_per_hour, 2),           winA: compareTeamMetric(metric(wA.points_per_hour), metric(wB.points_per_hour)) },
      { label: 'Revisions',        vA: String(wA.revision_count || 0),      vB: String(wB.revision_count || 0),      winA: compareTeamMetric(metric(wA.revision_count), metric(wB.revision_count), 'lower') },
      { label: 'Activity Count',   vA: String(wA.activity_count || 0),      vB: String(wB.activity_count || 0),      winA: compareTeamMetric(metric(wA.activity_count), metric(wB.activity_count)) },
    ]
    const tally = tallyComparisonWins(rows.map(row => row.winA))
    const winsA = tally.winsA
    const winsB = tally.winsB
    const decided = tally.decided
    const winner = tally.winner === 'a' ? wA.full_name : tally.winner === 'b' ? wB.full_name : null

    return (
      <>
        {!isModule && <Cover title="People Comparison" subtitle="Head-to-head people performance comparison" company={data.company} dateRange={data.dateRange} />}
        <Page size="A4" style={s.page}>
          {isModule && <SectionDivider title="People Comparison" company={data.company} dateRange={data.dateRange} />}
          <Section title="Head-to-Head Comparison" />
          <KpiRow items={[
            { label: wA.full_name || 'Person A', value: `${winsA} wins`,  note: 'Categories leading', accent: C.success },
            { label: wB.full_name || 'Person B', value: `${winsB} wins`,  note: 'Categories leading', accent: C.primary },
            { label: 'Overall Winner', value: winner || 'TIE', note: winner ? `${Math.round((Math.max(winsA, winsB) / decided) * 100)}% of decided categories` : 'No clear leader', accent: winner ? C.success : C.muted },
          ]} />
          <Sub title="Metric Breakdown" />
          <CompareGrid
            nameA={String(wA.full_name || 'Person A').substring(0, 18)}
            nameB={String(wB.full_name || 'Person B').substring(0, 18)}
            rows={rows}
          />
          {winner && (
            <Insight text={`${winner} leads in ${Math.max(winsA, winsB)} of ${decided} decided categories.`} color={C.success} />
          )}
          <Footer jobId={jobId} />
        </Page>
      </>
    )
  }

  // ── N-worker table layout ─────────────────────────────────────────────────
  const ranking = findTopTeamPointLeaders(workers.map(w => ({ ...w, pts: w.weight_points || 0 })))!
  const maxPts = ranking.maxPoints
  const topPerformers = ranking.leaders
  const topPerf = topPerformers[0]
  const avgOtr = computeAverageObservedMetric(workers.map(w => w.on_time_rate))
  const avgEff = computeAverageObservedMetric(workers.map(w => w.timer_efficiency))
  const formatPercent = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value) ? `${sf(value, 1)}%` : '—'

  return (
    <>
      {!isModule && <Cover title="People Comparison" subtitle={`${workers.length}-person performance comparison`} company={data.company} dateRange={data.dateRange} />}
      <Page size="A4" style={s.page}>
        {isModule && <SectionDivider title="People Comparison" company={data.company} dateRange={data.dateRange} />}
        <Section title="Group Overview" />
        <KpiRow items={[
          { label: 'People Compared',   value: String(workers.length),                                 accent: C.primary },
          { label: topPerformers.length === 1 ? 'Top Performer' : 'Top Performers', value: topPerformers.length === 1 ? String(topPerf.full_name || '—').substring(0, 14) : `${topPerformers.length} tied`, note: `${maxPts} pts${topPerformers.length === 1 ? '' : ' each'}`, accent: C.success },
          { label: 'Avg On-Time Rate',  value: avgOtr === null ? 'N/A' : `${sf(avgOtr, 1)}%`, accent: avgOtr === null ? C.muted : avgOtr >= 80 ? C.success : avgOtr >= 60 ? C.warning : C.danger, color: avgOtr === null ? C.muted : avgOtr >= 80 ? C.success : avgOtr >= 60 ? C.warning : C.danger },
          { label: 'Avg Efficiency',    value: avgEff === null ? 'N/A' : `${sf(avgEff, 1)}%`, accent: avgEff === null ? C.muted : avgEff <= 110 ? C.success : C.warning },
        ]} />

        <Sub title="Points Ranking" />
        <HBar data={workers.map(w => ({
          label: String(w.full_name || '—').substring(0, 22),
          value: w.weight_points || 0,
          color: (w.weight_points || 0) === maxPts ? C.success : C.primary,
        }))} />

        <Sub title="Full Metrics Table" />
        <Table
          headers={['Person', 'Pts', 'Done', 'Failed', 'Hours', 'On-Time%', 'Eff%', 'Pts/Hr']}
          colFlex={[2.5, 1, 1, 1, 1, 1.2, 1.2, 1.2]}
          rows={workers.map(w => ({
            cells: [
              String(w.full_name || '—').substring(0, 20),
              String(w.weight_points || 0),
              String(w.completed_tasks || 0),
              String(w.failed_tasks || 0),
              `${sf(w.active_hours, 1)}h`,
              formatPercent(w.on_time_rate),
              formatPercent(w.timer_efficiency),
              sf(w.points_per_hour, 2),
            ],
            colors: [
              (w.weight_points || 0) === maxPts ? C.success : null,
              null, null,
              (w.failed_tasks || 0) > 0 ? C.danger : null,
              null,
              typeof w.on_time_rate !== 'number' || !Number.isFinite(w.on_time_rate) ? null : w.on_time_rate >= 80 ? C.success : w.on_time_rate >= 60 ? C.warning : C.danger,
              typeof w.timer_efficiency !== 'number' || !Number.isFinite(w.timer_efficiency) ? null : w.timer_efficiency <= 110 ? C.success : C.warning,
              null,
            ],
          }))}
        />

        <Insight
          text={topPerformers.length === 1
            ? `${topPerf.full_name || 'Top person'} leads with ${maxPts} pts.`
            : `${topPerformers.length} people tie for the lead at ${maxPts} pts.`}
          color={C.success}
        />
        <Footer jobId={jobId} />
      </Page>
    </>
  )
}

export function WorkerComparisonReport({ data, jobId }: { data: WorkerComparisonData; jobId: string }) {
  return (
    <Document>
      <WorkerComparisonReportPages data={data} jobId={jobId} />
    </Document>
  )
}
