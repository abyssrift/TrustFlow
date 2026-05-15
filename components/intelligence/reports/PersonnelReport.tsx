import { Document, Page, StyleSheet } from '@react-pdf/renderer'
import React from 'react'
import { Cover, Empty, Footer, HBar, Insight, KpiRow, Section, SectionDivider, Sub, Table, fmtDate, sf } from './shared'
import { C, base } from './theme'

const s = StyleSheet.create({ page: { ...base.page } })

export interface PersonnelData {
  rows: any[]
  dateStart: string
  dateEnd: string
  company: string
  hasSalaries: boolean
}

export function PersonnelReportPages({ data, jobId, isModule }: { data: PersonnelData; jobId: string; isModule?: boolean }) {
  const { rows, dateStart, dateEnd, hasSalaries } = data
  const dr = `${fmtDate(dateStart)} — ${fmtDate(dateEnd)}`

  if (rows.length === 0) {
    return (
      <>
        {!isModule && <Cover title="People Cost Comparison" subtitle="Cost analysis, points/hour & efficiency across people" company={data.company} dateRange={dr} />}
        <Page size="A4" style={s.page}>
          {isModule && <SectionDivider title="People Cost Comparison" company={data.company} dateRange={dr} />}
          <Section title="Personnel Metrics" />
          <Empty msg="No data for the selected people in this period." />
          <Footer jobId={jobId} />
        </Page>
      </>
    )
  }

  const maxPts  = Math.max(...rows.map(r => r.weight_points || 0), 1)
  const topPerf = rows.reduce((best, r) => (r.weight_points || 0) > (best.weight_points || 0) ? r : best, rows[0])
  const avgOtr  = rows.reduce((s, r) => s + (r.on_time_rate || 0), 0) / rows.length
  const avgEff  = rows.reduce((s, r) => s + (r.timer_efficiency || 0), 0) / rows.length

  const costRows = hasSalaries ? rows.filter(r => r.total_cost_usd != null) : []

  return (
    <>
      {!isModule && <Cover title="People Cost Comparison" subtitle="Cost analysis, points/hour & efficiency across people" company={data.company} dateRange={dr} />}

      <Page size="A4" style={s.page}>
        {isModule && <SectionDivider title="People Cost Comparison" company={data.company} dateRange={dr} />}
        <Section title="Personnel Overview" />

        <KpiRow items={[
          { label: 'People Compared', value: String(rows.length),          accent: C.primary },
          { label: 'Top Performer',    value: String(topPerf.full_name || '—').substring(0, 14), note: `${topPerf.weight_points || 0} pts`, accent: C.success },
          { label: 'Avg On-Time Rate', value: `${sf(avgOtr, 1)}%`,         accent: avgOtr >= 80 ? C.success : avgOtr >= 60 ? C.warning : C.danger, color: avgOtr >= 80 ? C.success : avgOtr >= 60 ? C.warning : C.danger },
          { label: 'Avg Efficiency',   value: `${sf(avgEff, 1)}%`,         accent: avgEff <= 110 ? C.success : C.warning },
        ]} />

        <Sub title="Points Ranking" />
        <HBar data={rows.map(r => ({
          label: String(r.full_name || '—').substring(0, 22),
          value: r.weight_points || 0,
          color: (r.weight_points || 0) === maxPts ? C.success : C.primary,
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
              `${sf(r.on_time_rate, 1)}%`,
              `${sf(r.timer_efficiency, 1)}%`,
              sf(r.points_per_hour, 2),
            ],
            colors: [
              (r.weight_points || 0) === maxPts ? C.success : null,
              null, null, (r.failed_tasks || 0) > 0 ? C.danger : null, null,
              (r.on_time_rate || 0) >= 80 ? C.success : (r.on_time_rate || 0) >= 60 ? C.warning : C.danger,
              (r.timer_efficiency || 0) <= 110 ? C.success : C.warning,
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

        <Insight
          text={`${topPerf.full_name || 'Top person'} leads the group with ${topPerf.weight_points || 0} points — ${sf(((topPerf.weight_points || 0) / maxPts) * 100, 0)}% of the team maximum.`}
          color={C.success}
        />

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
