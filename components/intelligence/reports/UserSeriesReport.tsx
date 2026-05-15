import { Document, Page, StyleSheet } from '@react-pdf/renderer'
import React from 'react'
import { Cover, Empty, Footer, Insight, KpiRow, Section, SectionDivider, Sub, Table, VBar, sf } from './shared'
import { C, base } from './theme'

const s = StyleSheet.create({ page: { ...base.page } })

export interface UserSeriesData {
  rows: any[]
  workerName: string
  periodType: string
  nPeriods: number
  company: string
}

export function UserSeriesReportPages({ data, jobId, isModule }: { data: UserSeriesData; jobId: string; isModule?: boolean }) {
  const { rows, workerName, periodType, nPeriods } = data

  const totalPts  = rows.reduce((s, r) => s + (r.weight_points || 0), 0)
  const totalComp = rows.reduce((s, r) => s + (r.completed_tasks || 0), 0)
  const totalFail = rows.reduce((s, r) => s + (r.failed_tasks || 0), 0)
  const totalHrs  = rows.reduce((s, r) => s + (r.active_seconds || 0), 0) / 3600
  const sr        = totalComp + totalFail > 0 ? Math.round((totalComp / (totalComp + totalFail)) * 100) : null

  return (
    <>
      {!isModule && (
        <Cover
          title="Performance Timeline"
          subtitle={`Period-by-period output, session hours & efficiency`}
          company={workerName}
          dateRange={`${nPeriods} ${periodType}(s)`}
        />
      )}

      <Page size="A4" style={s.page}>
        {isModule && <SectionDivider title="Performance Timeline" company={workerName} dateRange={`${nPeriods} ${periodType}(s)`} />}
        <Section title={`Performance Summary — ${workerName}`} />

        <KpiRow items={[
          { label: 'Total Points',    value: String(totalPts),         accent: C.primary },
          { label: 'Tasks Done',      value: String(totalComp),        accent: C.success },
          { label: 'Tasks Failed',    value: String(totalFail),        accent: C.danger, color: totalFail > 0 ? C.danger : C.muted },
          { label: 'Success Rate',    value: sr != null ? `${sr}%` : '—', accent: sr != null ? (sr >= 80 ? C.success : sr >= 60 ? C.warning : C.danger) : C.muted, color: sr != null ? (sr >= 80 ? C.success : sr >= 60 ? C.warning : C.danger) : C.muted },
        ]} />

        <KpiRow items={[
          { label: 'Active Hours',    value: `${sf(totalHrs, 1)}h`,   accent: C.primary },
          { label: 'Periods Tracked', value: String(rows.length),      accent: C.muted },
          { label: 'Avg Points/Period', value: rows.length > 0 ? sf(totalPts / rows.length, 1) : '—', accent: C.primary },
        ]} />

        <Sub title={`Points by ${periodType}`} />
        {rows.length > 0 ? (
          <VBar
            data={rows.map(r => ({ label: r.period_label || '—', value: r.weight_points || 0 }))}
            height={90}
            color={C.primary}
          />
        ) : <Empty />}

        <Sub title="Period Breakdown" />
        {rows.length > 0 ? (
          <Table
            headers={['Period', 'Points', 'Done', 'Failed', 'On-Time', 'Revisions', 'Hours']}
            colFlex={[2, 1, 1, 1, 1, 1.2, 1]}
            rows={rows.map(r => ({
              cells: [
                r.period_label || '—',
                String(r.weight_points || 0),
                String(r.completed_tasks || 0),
                String(r.failed_tasks || 0),
                String(r.on_time_tasks || 0),
                String(r.revision_count || 0),
                `${sf((r.active_seconds || 0) / 3600, 1)}h`,
              ],
              colors: [null, null, null, (r.failed_tasks || 0) > 0 ? C.danger : null, null, (r.revision_count || 0) > 0 ? C.warning : null, null],
            }))}
          />
        ) : <Empty />}

        {sr != null && (
          <Insight
            text={`Overall success rate across ${nPeriods} ${periodType}(s): ${sr}% — ${sr >= 80 ? 'excellent' : sr >= 60 ? 'acceptable' : 'needs improvement'}.`}
            color={sr >= 80 ? C.success : sr >= 60 ? C.warning : C.danger}
          />
        )}

        <Footer jobId={jobId} />
      </Page>
    </>
  )
}

export function UserSeriesReport({ data, jobId }: { data: UserSeriesData; jobId: string }) {
  return (
    <Document>
      <UserSeriesReportPages data={data} jobId={jobId} />
    </Document>
  )
}
