import { Document, Page, StyleSheet } from '@react-pdf/renderer'
import React from 'react'
import { CompareGrid, Cover, Empty, Footer, HBar, Insight, KpiRow, Section, SectionDivider, Sub, Table, sf } from './shared'
import { C, base } from './theme'
import { compareTeamMetric, computeAverageTeamSuccessRate, computeTeamSuccessRate, findTopTeamPointLeaders, tallyComparisonWins } from '@/lib/reporting/reportCalculations'

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
  overlappingMemberCount: number
}

export function TeamComparisonReportPages({ data, jobId, isModule }: { data: TeamComparisonData; jobId: string; isModule?: boolean }) {
  const teams = data.teams || []
  const overlapNote = data.overlappingMemberCount > 0
    ? `${data.overlappingMemberCount} member${data.overlappingMemberCount === 1 ? '' : 's'} belong to multiple selected teams. Their activity is included in each team's totals.`
    : null

  if (teams.length === 0) {
    return (
      <>
        {!isModule && <Cover title="Team Comparison" subtitle="Efficiency metrics across teams" company={data.company} dateRange={data.dateRange} />}
        <Page size="A4" style={s.page}>
          {isModule && <SectionDivider title="Team Comparison" company={data.company} dateRange={data.dateRange} />}
          <Section title="Comparison" />
          <Empty msg="No team data found for the selected period." />
          <Footer jobId={jobId} />
        </Page>
      </>
    )
  }

  const ar  = (t: TeamStats) => computeTeamSuccessRate(t.completed, t.failed)
  const formatRate = (rate: number | null) => rate === null ? '—' : `${rate}%`
  const pph = (t: TeamStats) => t.hours > 0 ? t.pts / t.hours : 0

  // ── 2-team head-to-head layout ────────────────────────────────────────────
  if (teams.length === 2) {
    const [tA, tB] = teams
    const arA = ar(tA), arB = ar(tB)
    const pphA = pph(tA), pphB = pph(tB)

    const rows = [
      { label: 'Members',         vA: String(tA.count),       vB: String(tB.count),       winA: null as boolean | null },
      { label: 'Tasks Completed', vA: String(tA.completed),   vB: String(tB.completed),   winA: compareTeamMetric(tA.completed, tB.completed) },
      { label: 'Tasks Failed',    vA: String(tA.failed),      vB: String(tB.failed),      winA: compareTeamMetric(tA.failed, tB.failed, 'lower') },
      { label: 'Weight Points',   vA: String(tA.pts),         vB: String(tB.pts),         winA: compareTeamMetric(tA.pts, tB.pts) },
      { label: 'Active Hours',    vA: `${sf(tA.hours, 1)}h`,  vB: `${sf(tB.hours, 1)}h`,  winA: compareTeamMetric(tA.hours, tB.hours) },
      { label: 'Success Rate',    vA: formatRate(arA),        vB: formatRate(arB),        winA: compareTeamMetric(arA, arB) },
      { label: 'Points / Hour',   vA: sf(pphA, 2),            vB: sf(pphB, 2),            winA: compareTeamMetric(pphA, pphB) },
    ]
    const tally = tallyComparisonWins(rows.map(row => row.winA))
    const winsA = tally.winsA
    const winsB = tally.winsB
    const winner = tally.winner === 'a' ? tA.name : tally.winner === 'b' ? tB.name : null
    const decided = tally.decided

    return (
      <>
        {!isModule && <Cover title="Team Comparison" subtitle="Efficiency metrics across teams" company={data.company} dateRange={data.dateRange} />}
        <Page size="A4" style={s.page}>
          {isModule && <SectionDivider title="Team Comparison" company={data.company} dateRange={data.dateRange} />}
          <Section title="Team Overview" />
          <KpiRow items={[
            { label: tA.name, value: formatRate(arA), note: `${tA.completed} tasks done · ${tA.count} members${arA === null ? ' · no task outcomes' : ''}`, accent: C.primary },
            { label: tB.name, value: formatRate(arB), note: `${tB.completed} tasks done · ${tB.count} members${arB === null ? ' · no task outcomes' : ''}`, accent: C.warning },
            { label: 'Winner', value: winner || 'TIE', note: winner ? `${Math.max(winsA, winsB)} of ${decided} categories` : 'Balanced performance', accent: winner ? C.success : C.muted },
          ]} />
          {overlapNote && <Insight text={overlapNote} color={C.warning} />}
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
  const topSummary = findTopTeamPointLeaders(teams)!
  const { maxPoints, leaders } = topSummary
  const hasObservedPoints = maxPoints > 0
  const avgAr   = computeAverageTeamSuccessRate(teams.map(ar))

  return (
    <>
      {!isModule && <Cover title="Team Comparison" subtitle={`${teams.length}-team group comparison`} company={data.company} dateRange={data.dateRange} />}
      <Page size="A4" style={s.page}>
        {isModule && <SectionDivider title="Team Comparison" company={data.company} dateRange={data.dateRange} />}
        <Section title="Group Overview" />
        <KpiRow items={[
          { label: 'Teams Compared',    value: String(teams.length),                             accent: C.primary },
          { label: hasObservedPoints ? (leaders.length === 1 ? 'Top Team' : 'Top Teams') : 'Top Team', value: hasObservedPoints ? (leaders.length === 1 ? leaders[0].name.substring(0, 14) : `${leaders.length} tied`) : 'N/A', note: hasObservedPoints ? `${maxPoints} pts${leaders.length === 1 ? '' : ' each'}` : 'No observed output', accent: hasObservedPoints ? C.success : C.muted },
          { label: 'Avg Success Rate',  value: avgAr === null ? 'N/A' : `${sf(avgAr, 1)}%`, accent: avgAr === null ? C.muted : avgAr >= 80 ? C.success : avgAr >= 60 ? C.warning : C.danger, color: avgAr === null ? C.muted : avgAr >= 80 ? C.success : avgAr >= 60 ? C.warning : C.danger },
        ]} />
        {overlapNote && <Insight text={overlapNote} color={C.warning} />}

        <Sub title="Points Ranking" />
        <HBar data={teams.map(t => ({
          label: t.name.substring(0, 22),
          value: t.pts,
          color: hasObservedPoints && t.pts === maxPoints ? C.success : C.primary,
        }))} />

        <Sub title="Full Metrics Table" />
        <Table
          headers={['Team', 'Members', 'Done', 'Failed', 'Points', 'Hours', 'Success%', 'Pts/Hr']}
          colFlex={[2.5, 1, 1, 1, 1, 1, 1.2, 1.2]}
          rows={teams.map(t => {
            const successRate = ar(t)
            return {
              cells: [
                t.name.substring(0, 20),
                String(t.count),
                String(t.completed),
                String(t.failed),
                String(t.pts),
                `${sf(t.hours, 1)}h`,
                formatRate(successRate),
                sf(pph(t), 2),
              ],
              colors: [
                hasObservedPoints && t.pts === maxPoints ? C.success : null,
                null, null,
                t.failed > 0 ? C.danger : null,
                hasObservedPoints && t.pts === maxPoints ? C.success : null,
                null,
                successRate === null ? null : successRate >= 80 ? C.success : successRate >= 60 ? C.warning : C.danger,
                null,
              ],
            }
          })}
        />

        {hasObservedPoints
          ? <Insight text={leaders.length === 1
              ? `${leaders[0].name} leads with ${maxPoints} pts.`
              : `${leaders.length} teams tie for the lead at ${maxPoints} pts.`} color={C.success} />
          : <Empty kind="no_leader" msg="All selected teams have zero observed points in this period." />}
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
