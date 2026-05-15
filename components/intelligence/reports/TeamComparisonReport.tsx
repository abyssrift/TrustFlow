import { Document, Page, StyleSheet } from '@react-pdf/renderer'
import React from 'react'
import { CompareGrid, Cover, Empty, Footer, HBar, Insight, KpiRow, Section, Sub, Table, sf } from './shared'
import { C, base } from './theme'

const s = StyleSheet.create({ page: { ...base.page } })

export interface TeamStats {
  id: string
  name: string
  count: number
  completed: number
  failed: number
  pts: number
  hours: number
}

export interface TeamComparisonData {
  teams: TeamStats[]
  company: string
  dateRange: string
}

export function TeamComparisonReportPages({ data, jobId }: { data: TeamComparisonData; jobId: string }) {
  const teams = data.teams || []

  if (teams.length === 0) {
    return (
      <>
        <Cover title="Team Comparison" subtitle="Efficiency metrics across teams" company={data.company} dateRange={data.dateRange} />
        <Page size="A4" style={s.page}>
          <Section title="Comparison" />
          <Empty msg="No team data found for the selected period." />
          <Footer jobId={jobId} />
        </Page>
      </>
    )
  }

  const ar  = (t: TeamStats) => t.completed + t.failed > 0 ? Math.round((t.completed / (t.completed + t.failed)) * 100) : 0
  const pph = (t: TeamStats) => t.hours > 0 ? t.pts / t.hours : 0

  // ── 2-team head-to-head layout ────────────────────────────────────────────
  if (teams.length === 2) {
    const [tA, tB] = teams
    const arA = ar(tA), arB = ar(tB)
    const pphA = pph(tA), pphB = pph(tB)

    const rows = [
      { label: 'Members',         vA: String(tA.count),       vB: String(tB.count),       winA: null as boolean | null },
      { label: 'Tasks Completed', vA: String(tA.completed),   vB: String(tB.completed),   winA: tA.completed >= tB.completed },
      { label: 'Tasks Failed',    vA: String(tA.failed),      vB: String(tB.failed),      winA: tA.failed <= tB.failed },
      { label: 'Weight Points',   vA: String(tA.pts),         vB: String(tB.pts),         winA: tA.pts >= tB.pts },
      { label: 'Active Hours',    vA: `${sf(tA.hours, 1)}h`,  vB: `${sf(tB.hours, 1)}h`,  winA: tA.hours >= tB.hours },
      { label: 'Success Rate',    vA: `${arA}%`,              vB: `${arB}%`,              winA: arA >= arB },
      { label: 'Points / Hour',   vA: sf(pphA, 2),            vB: sf(pphB, 2),            winA: pphA >= pphB },
    ]
    const winsA  = rows.filter(r => r.winA === true).length
    const winsB  = rows.filter(r => r.winA === false).length
    const winner = winsA > winsB ? tA.name : winsB > winsA ? tB.name : null
    const decided = rows.filter(r => r.winA !== null).length

    return (
      <>
        <Cover title="Team Comparison" subtitle="Efficiency metrics across teams" company={data.company} dateRange={data.dateRange} />
        <Page size="A4" style={s.page}>
          <Section title="Team Overview" />
          <KpiRow items={[
            { label: tA.name, value: `${arA}%`, note: `${tA.completed} tasks done · ${tA.count} members`, accent: C.primary },
            { label: tB.name, value: `${arB}%`, note: `${tB.completed} tasks done · ${tB.count} members`, accent: C.warning },
            { label: 'Winner', value: winner || 'TIE', note: winner ? `${Math.max(winsA, winsB)} of ${decided} categories` : 'Balanced performance', accent: winner ? C.success : C.muted },
          ]} />
          <Sub title="Head-to-Head Breakdown" />
          <CompareGrid nameA={tA.name.substring(0, 18)} nameB={tB.name.substring(0, 18)} rows={rows} />
          <Sub title="Output Comparison" />
          <HBar data={[
            { label: `${tA.name.substring(0, 16)} — Points`, value: tA.pts,       color: C.primary },
            { label: `${tB.name.substring(0, 16)} — Points`, value: tB.pts,       color: C.warning },
            { label: `${tA.name.substring(0, 16)} — Tasks`,  value: tA.completed, color: C.success },
            { label: `${tB.name.substring(0, 16)} — Tasks`,  value: tB.completed, color: C.danger  },
          ]} />
          {winner && (
            <Insight text={`${winner} outperforms in ${Math.max(winsA, winsB)} of ${decided} measured areas.`} color={C.success} />
          )}
          <Footer jobId={jobId} />
        </Page>
      </>
    )
  }

  // ── N-team group table layout ─────────────────────────────────────────────
  const maxPts  = Math.max(...teams.map(t => t.pts), 1)
  const topTeam = teams.reduce((best, t) => t.pts > best.pts ? t : best, teams[0])
  const avgAr   = teams.reduce((s, t) => s + ar(t), 0) / teams.length

  return (
    <>
      <Cover title="Team Comparison" subtitle={`${teams.length}-team group comparison`} company={data.company} dateRange={data.dateRange} />
      <Page size="A4" style={s.page}>
        <Section title="Group Overview" />
        <KpiRow items={[
          { label: 'Teams Compared',    value: String(teams.length),                             accent: C.primary },
          { label: 'Top Team',          value: topTeam.name.substring(0, 14),                   note: `${topTeam.pts} pts`, accent: C.success },
          { label: 'Avg Success Rate',  value: `${sf(avgAr, 1)}%`, accent: avgAr >= 80 ? C.success : avgAr >= 60 ? C.warning : C.danger, color: avgAr >= 80 ? C.success : avgAr >= 60 ? C.warning : C.danger },
        ]} />

        <Sub title="Points Ranking" />
        <HBar data={teams.map(t => ({
          label: t.name.substring(0, 22),
          value: t.pts,
          color: t.pts === maxPts ? C.success : C.primary,
        }))} />

        <Sub title="Full Metrics Table" />
        <Table
          headers={['Team', 'Members', 'Done', 'Failed', 'Points', 'Hours', 'Success%', 'Pts/Hr']}
          colFlex={[2.5, 1, 1, 1, 1, 1, 1.2, 1.2]}
          rows={teams.map(t => ({
            cells: [
              t.name.substring(0, 20),
              String(t.count),
              String(t.completed),
              String(t.failed),
              String(t.pts),
              `${sf(t.hours, 1)}h`,
              `${ar(t)}%`,
              sf(pph(t), 2),
            ],
            colors: [
              t.pts === maxPts ? C.success : null,
              null, null,
              t.failed > 0 ? C.danger : null,
              t.pts === maxPts ? C.success : null,
              null,
              ar(t) >= 80 ? C.success : ar(t) >= 60 ? C.warning : C.danger,
              null,
            ],
          }))}
        />

        <Insight text={`${topTeam.name} leads with ${topTeam.pts} pts — ${sf((topTeam.pts / maxPts) * 100, 0)}% of the group maximum.`} color={C.success} />
        <Footer jobId={jobId} />
      </Page>
    </>
  )
}

export function TeamComparisonReport({ data, jobId }: { data: TeamComparisonData; jobId: string }) {
  return (
    <Document>
      <TeamComparisonReportPages data={data} jobId={jobId} />
    </Document>
  )
}
