import { Document, Page, StyleSheet } from '@react-pdf/renderer'
import React from 'react'
import { CompareGrid, Cover, Empty, Footer, HBar, Insight, KpiRow, Section, SectionDivider, Sub, Table, sf } from './shared'
import { C, base } from './theme'

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
    const winsA  = rows.filter(r => r.winA).length
    const winsB  = rows.length - winsA
    const winner = winsA > winsB ? wA.full_name : winsB > winsA ? wB.full_name : null

    return (
      <>
        {!isModule && <Cover title="People Comparison" subtitle="Head-to-head people performance comparison" company={data.company} dateRange={data.dateRange} />}
        <Page size="A4" style={s.page}>
          {isModule && <SectionDivider title="People Comparison" company={data.company} dateRange={data.dateRange} />}
          <Section title="Head-to-Head Comparison" />
          <KpiRow items={[
            { label: wA.full_name || 'Person A', value: `${winsA} wins`,  note: 'Categories leading', accent: C.success },
            { label: wB.full_name || 'Person B', value: `${winsB} wins`,  note: 'Categories leading', accent: C.primary },
            { label: 'Overall Winner', value: winner || 'TIE', note: winner ? `${Math.round((Math.max(winsA, winsB) / rows.length) * 100)}% categories` : 'Equal performance', accent: winner ? C.success : C.muted },
          ]} />
          <Sub title="Metric Breakdown" />
          <CompareGrid
            nameA={String(wA.full_name || 'Person A').substring(0, 18)}
            nameB={String(wB.full_name || 'Person B').substring(0, 18)}
            rows={rows}
          />
          {winner && (
            <Insight text={`${winner} leads in ${Math.max(winsA, winsB)} of ${rows.length} measured categories.`} color={C.success} />
          )}
          <Footer jobId={jobId} />
        </Page>
      </>
    )
  }

  // ── N-worker table layout ─────────────────────────────────────────────────
  const maxPts  = Math.max(...workers.map(w => w.weight_points || 0), 1)
  const topPerf = workers.reduce((best, w) => (w.weight_points || 0) > (best.weight_points || 0) ? w : best, workers[0])
  const avgOtr  = workers.reduce((s, w) => s + (w.on_time_rate || 0), 0) / workers.length
  const avgEff  = workers.reduce((s, w) => s + (w.timer_efficiency || 0), 0) / workers.length

  return (
    <>
      {!isModule && <Cover title="People Comparison" subtitle={`${workers.length}-person performance comparison`} company={data.company} dateRange={data.dateRange} />}
      <Page size="A4" style={s.page}>
        {isModule && <SectionDivider title="People Comparison" company={data.company} dateRange={data.dateRange} />}
        <Section title="Group Overview" />
        <KpiRow items={[
          { label: 'People Compared',   value: String(workers.length),                                 accent: C.primary },
          { label: 'Top Performer',     value: String(topPerf.full_name || '—').substring(0, 14),      note: `${topPerf.weight_points || 0} pts`, accent: C.success },
          { label: 'Avg On-Time Rate',  value: `${sf(avgOtr, 1)}%`,  accent: avgOtr >= 80 ? C.success : avgOtr >= 60 ? C.warning : C.danger, color: avgOtr >= 80 ? C.success : avgOtr >= 60 ? C.warning : C.danger },
          { label: 'Avg Efficiency',    value: `${sf(avgEff, 1)}%`,  accent: avgEff <= 110 ? C.success : C.warning },
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
              `${sf(w.on_time_rate, 1)}%`,
              `${sf(w.timer_efficiency, 1)}%`,
              sf(w.points_per_hour, 2),
            ],
            colors: [
              (w.weight_points || 0) === maxPts ? C.success : null,
              null, null,
              (w.failed_tasks || 0) > 0 ? C.danger : null,
              null,
              (w.on_time_rate || 0) >= 80 ? C.success : (w.on_time_rate || 0) >= 60 ? C.warning : C.danger,
              (w.timer_efficiency || 0) <= 110 ? C.success : C.warning,
              null,
            ],
          }))}
        />

        <Insight
          text={`${topPerf.full_name || 'Top person'} leads with ${topPerf.weight_points || 0} pts — ${sf(((topPerf.weight_points || 0) / maxPts) * 100, 0)}% of the group maximum.`}
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
