import React from 'react'
import { Document, Page, StyleSheet } from '@react-pdf/renderer'
import { C, base } from './theme'
import { Cover, Footer, Section, Sub, KpiRow, CompareGrid, HBar, Empty, Insight, sf } from './shared'

const s = StyleSheet.create({ page: { ...base.page } })

export interface TeamComparisonData {
  teamA: { id: string; name: string }
  teamB: { id: string; name: string }
  statsA: { count: number; completed: number; failed: number; pts: number; hours: number }
  statsB: { count: number; completed: number; failed: number; pts: number; hours: number }
  company: string
  dateRange: string
}

export function TeamComparisonReport({ data, jobId }: { data: TeamComparisonData; jobId: string }) {
  const { statsA: sA, statsB: sB, teamA, teamB } = data

  const arA = sA.completed + sA.failed > 0 ? Math.round((sA.completed / (sA.completed + sA.failed)) * 100) : 0
  const arB = sB.completed + sB.failed > 0 ? Math.round((sB.completed / (sB.completed + sB.failed)) * 100) : 0
  const pphA = sA.hours > 0 ? sA.pts / sA.hours : 0
  const pphB = sB.hours > 0 ? sB.pts / sB.hours : 0

  const rows = [
    { label: 'Members',           vA: String(sA.count),            vB: String(sB.count),            winA: null as boolean | null },
    { label: 'Tasks Completed',   vA: String(sA.completed),         vB: String(sB.completed),         winA: sA.completed >= sB.completed },
    { label: 'Tasks Failed',      vA: String(sA.failed),            vB: String(sB.failed),            winA: sA.failed <= sB.failed },
    { label: 'Weight Points',     vA: String(sA.pts),               vB: String(sB.pts),               winA: sA.pts >= sB.pts },
    { label: 'Active Hours',      vA: `${sf(sA.hours, 1)}h`,        vB: `${sf(sB.hours, 1)}h`,        winA: sA.hours >= sB.hours },
    { label: 'Success Rate',      vA: `${arA}%`,                    vB: `${arB}%`,                    winA: arA >= arB },
    { label: 'Points / Hour',     vA: sf(pphA, 2),                  vB: sf(pphB, 2),                  winA: pphA >= pphB },
  ]

  const winsA = rows.filter(r => r.winA === true).length
  const winsB = rows.filter(r => r.winA === false).length
  const winner = winsA > winsB ? teamA.name : winsB > winsA ? teamB.name : null

  return (
    <Document>
      <Cover
        title="Structural Matrix Analysis"
        subtitle="Efficiency metrics across structural units"
        company={data.company}
        dateRange={data.dateRange}
      />

      <Page size="A4" style={s.page}>
        <Section title="Team Overview" />
        <KpiRow items={[
          { label: teamA.name, value: `${arA}%`,           note: `${sA.completed} tasks done · ${sA.count} members`, accent: C.primary },
          { label: teamB.name, value: `${arB}%`,           note: `${sB.completed} tasks done · ${sB.count} members`, accent: C.warning },
          { label: 'Winner',   value: winner || 'TIE',    note: winner ? `${Math.max(winsA, winsB)} of ${rows.filter(r => r.winA !== null).length} categories` : 'Balanced performance', accent: winner ? C.success : C.muted },
        ]} />

        <Sub title="Head-to-Head Breakdown" />
        <CompareGrid
          nameA={teamA.name.substring(0, 18)}
          nameB={teamB.name.substring(0, 18)}
          rows={rows}
        />

        <Sub title="Output Comparison" />
        <HBar data={[
          { label: `${teamA.name.substring(0, 16)} — Points`, value: sA.pts,       color: C.primary },
          { label: `${teamB.name.substring(0, 16)} — Points`, value: sB.pts,       color: C.warning },
          { label: `${teamA.name.substring(0, 16)} — Tasks`,  value: sA.completed, color: C.success },
          { label: `${teamB.name.substring(0, 16)} — Tasks`,  value: sB.completed, color: C.danger },
        ]} />

        {winner && (
          <Insight
            text={`${winner} outperforms in ${Math.max(winsA, winsB)} of ${rows.filter(r => r.winA !== null).length} measured areas over this period.`}
            color={C.success}
          />
        )}
        <Footer jobId={jobId} />
      </Page>
    </Document>
  )
}
