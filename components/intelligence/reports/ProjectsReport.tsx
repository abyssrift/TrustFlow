import { Document, Page, StyleSheet, View } from '@react-pdf/renderer'
import React from 'react'
import { C, base } from './theme'
import { Cover, Empty, Footer, HBar, Insight, KpiRow, Section, SectionDivider, Sub, Table, fmtDate, sf } from './shared'

const s = StyleSheet.create({ page: { ...base.page } })

export interface ProjectRow {
  id: string
  name: string
  pipeline_name: string | null
  status: string
  total_tasks: number
  completed_tasks: number
  overdue_tasks: number
  completion_rate: number       // 0..100
  days_active: number
  tasks_per_day: number
  expiry_date: string | null
  projected_eta: string | null  // ISO date or null
  health: 'on_track' | 'at_risk' | 'overdue' | 'complete' | 'stalled'
}

export interface ProjectsData {
  rows: ProjectRow[]
  company: string
  dateRange: string | null      // null = lifetime snapshot
}

function healthLabel(h: ProjectRow['health']): string {
  switch (h) {
    case 'on_track': return 'On Track'
    case 'at_risk':  return 'At Risk'
    case 'overdue':  return 'Overdue'
    case 'complete': return 'Complete'
    case 'stalled':  return 'Stalled'
  }
}

function healthColor(h: ProjectRow['health']): string {
  switch (h) {
    case 'on_track': return C.success
    case 'at_risk':  return C.warning
    case 'overdue':  return C.danger
    case 'complete': return C.primary
    case 'stalled':  return C.muted
  }
}

export function computeProjectsInsights(data: ProjectsData): { text: string; color: string }[] {
  const rows = data.rows || []
  const ins: { text: string; color: string }[] = []
  if (rows.length === 0) return ins

  const atRisk  = rows.filter(r => r.health === 'at_risk')
  const overdue = rows.filter(r => r.health === 'overdue')
  const stalled = rows.filter(r => r.health === 'stalled')
  const strong  = rows.filter(r => r.completion_rate >= 80 && r.health !== 'overdue')

  if (overdue.length > 0)
    ins.push({ text: `${overdue.length} project${overdue.length > 1 ? 's are' : ' is'} past its expiry without completing. Immediate review required.`, color: C.danger })
  if (atRisk.length > 0)
    ins.push({ text: `${atRisk.length} project${atRisk.length > 1 ? 's are' : ' is'} at risk — projected completion exceeds the expiry date.`, color: C.warning })
  if (stalled.length > 0)
    ins.push({ text: `${stalled.length} project${stalled.length > 1 ? 's have' : ' has'} shown no task throughput recently. Consider re-engaging or archiving.`, color: C.warning })
  if (strong.length > 0)
    ins.push({ text: `${strong.length} project${strong.length > 1 ? 's are' : ' is'} above 80% complete and projected to land before expiry.`, color: C.success })

  return ins
}

export function ProjectsReportPages({ data, jobId, isModule }: { data: ProjectsData; jobId: string; isModule?: boolean }) {
  const rows = data.rows || []
  const dateLabel = data.dateRange || `Snapshot · ${fmtDate(new Date().toISOString())}`

  if (rows.length === 0) {
    return (
      <>
        {!isModule && <Cover title="Projects Status" subtitle="Folder-of-tasks completion, throughput, and projected ETA" company={data.company} dateRange={dateLabel} />}
        <Page size="A4" style={s.page}>
          {isModule && <SectionDivider title="Projects Status" company={data.company} dateRange={dateLabel} />}
          <Section title="Projects Overview" />
          <Empty msg="No projects found for this company. Create a project to start grouping tasks." />
          <Footer jobId={jobId} />
        </Page>
      </>
    )
  }

  const total       = rows.length
  const complete    = rows.filter(r => r.health === 'complete').length
  const overdue     = rows.filter(r => r.health === 'overdue').length
  const atRisk      = rows.filter(r => r.health === 'at_risk').length
  const onTrack     = rows.filter(r => r.health === 'on_track').length
  const avgRate     = rows.reduce((s, r) => s + (r.completion_rate || 0), 0) / total
  const totalTasks  = rows.reduce((s, r) => s + (r.total_tasks || 0), 0)
  const doneTasks   = rows.reduce((s, r) => s + (r.completed_tasks || 0), 0)

  return (
    <>
      {!isModule && <Cover title="Projects Status" subtitle="Folder-of-tasks completion, throughput, and projected ETA" company={data.company} dateRange={dateLabel} />}

      <Page size="A4" style={s.page}>
        {isModule && <SectionDivider title="Projects Status" company={data.company} dateRange={dateLabel} />}
        <Section title="Projects Overview" />

        <KpiRow items={[
          { label: 'Projects',         value: String(total),                            accent: C.primary },
          { label: 'Avg Completion',   value: `${sf(avgRate, 1)}%`,                     accent: avgRate >= 80 ? C.success : avgRate >= 50 ? C.warning : C.danger, color: avgRate >= 80 ? C.success : avgRate >= 50 ? C.warning : C.danger },
          { label: 'On Track',         value: String(onTrack),                          accent: C.success },
          { label: 'At Risk / Overdue', value: `${atRisk} / ${overdue}`,                accent: (atRisk + overdue) > 0 ? C.danger : C.muted, color: (atRisk + overdue) > 0 ? C.danger : C.muted },
        ]} />

        <KpiRow items={[
          { label: 'Total Tasks',      value: String(totalTasks),                       accent: C.primary },
          { label: 'Completed Tasks',  value: String(doneTasks),                        accent: C.success },
          { label: 'Complete Projects', value: String(complete),                        accent: C.primary },
        ]} />

        <Sub title="Completion Percentage by Project" />
        <HBar data={rows.map(r => ({
          label: r.name.substring(0, 22),
          value: r.completion_rate || 0,
          display: `${sf(r.completion_rate, 0)}%`,
          color: healthColor(r.health),
        }))} />

        <View break>
          <Section title="Project Details" />
          <Table
            headers={['Project', 'Pipeline', 'Done / Total', '%', 'Tasks/Day', 'Expiry', 'Projected', 'Status']}
            colFlex={[2.2, 1.8, 1.4, 0.9, 1.1, 1.4, 1.4, 1.2]}
            rows={rows.map(r => ({
              cells: [
                r.name.substring(0, 22),
                (r.pipeline_name || '—').substring(0, 18),
                `${r.completed_tasks}/${r.total_tasks}`,
                `${sf(r.completion_rate, 0)}%`,
                sf(r.tasks_per_day, 2),
                r.expiry_date ? fmtDate(r.expiry_date) : '—',
                r.projected_eta ? fmtDate(r.projected_eta) : (r.tasks_per_day === 0 ? '—' : 'Complete'),
                healthLabel(r.health),
              ],
              colors: [
                null, null, null,
                r.completion_rate >= 80 ? C.success : r.completion_rate >= 50 ? C.warning : C.muted,
                r.tasks_per_day > 0 ? C.primary : C.muted,
                null, null,
                healthColor(r.health),
              ],
            }))}
          />

          {/* Inline insights surface only when running standalone — multi-report consolidates them */}
          {!isModule && computeProjectsInsights(data).map((ins, i) => (
            <Insight key={i} text={ins.text} color={ins.color} />
          ))}
        </View>

        <Footer jobId={jobId} />
      </Page>
    </>
  )
}

export function ProjectsReport({ data, jobId }: { data: ProjectsData; jobId: string }) {
  return (
    <Document>
      <ProjectsReportPages data={data} jobId={jobId} />
    </Document>
  )
}
