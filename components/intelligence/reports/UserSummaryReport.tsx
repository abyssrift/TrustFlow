import React from 'react'
import { Document, Page, StyleSheet } from '@react-pdf/renderer'
import { C, base } from './theme'
import { Cover, Footer, Section, Sub, KpiRow, Empty, Insight, sf, fmtDate } from './shared'

const s = StyleSheet.create({ page: { ...base.page } })

export interface UserSummaryData {
  summary: any
  workerName: string
  dateStart: string
  dateEnd: string
  company: string
}

export function UserSummaryReport({ data, jobId }: { data: UserSummaryData; jobId: string }) {
  const { summary, workerName, dateStart, dateEnd } = data

  if (!summary) {
    return (
      <Document>
        <Cover title="Worker Performance Summary" subtitle="Aggregated stats for one worker over a date range" company={workerName} dateRange={`${fmtDate(dateStart)} — ${fmtDate(dateEnd)}`} />
        <Page size="A4" style={s.page}>
          <Section title="Summary" />
          <Empty msg="No data found for this worker in the specified period." />
          <Footer jobId={jobId} />
        </Page>
      </Document>
    )
  }

  const activeH = (summary.active_seconds || 0) / 3600
  const estH    = (summary.estimated_seconds || 0) / 3600
  const eff     = summary.timer_efficiency || 0
  const otr     = summary.on_time_rate || 0
  const sr      = summary.completed_tasks + summary.failed_tasks > 0
    ? Math.round((summary.completed_tasks / (summary.completed_tasks + summary.failed_tasks)) * 100)
    : null

  return (
    <Document>
      <Cover
        title="Worker Performance Summary"
        subtitle="Aggregated stats for one worker over a date range"
        company={workerName}
        dateRange={`${fmtDate(dateStart)} — ${fmtDate(dateEnd)}`}
      />

      <Page size="A4" style={s.page}>
        <Section title={`Aggregate Metrics — ${workerName}`} />

        <KpiRow items={[
          { label: 'Weight Points', value: String(summary.weight_points || 0),   accent: C.primary },
          { label: 'Tasks Done',    value: String(summary.completed_tasks || 0), accent: C.success },
          { label: 'Tasks Failed',  value: String(summary.failed_tasks || 0),    accent: C.danger, color: (summary.failed_tasks || 0) > 0 ? C.danger : C.muted },
          { label: 'On-Time',       value: String(summary.on_time_tasks || 0),   accent: C.warning },
        ]} />

        <KpiRow items={[
          { label: 'Active Hours',    value: `${sf(activeH, 2)}h`,  accent: C.primary },
          { label: 'Estimated Hours', value: `${sf(estH, 2)}h`,     accent: C.muted },
          { label: 'Success Rate',    value: sr != null ? `${sr}%` : '—', accent: sr != null ? (sr >= 80 ? C.success : sr >= 60 ? C.warning : C.danger) : C.muted, color: sr != null ? (sr >= 80 ? C.success : sr >= 60 ? C.warning : C.danger) : C.muted },
        ]} />

        <Sub title="Derived Efficiency Metrics" />

        <KpiRow items={[
          {
            label: 'Timer Efficiency',
            value: `${sf(eff, 1)}%`,
            note: eff > 100 ? 'Over budget — tasks taking longer than estimated' : eff > 80 ? 'Good pacing' : 'Under budget — ahead of estimates',
            accent: eff > 100 ? C.warning : C.success,
            color: eff > 100 ? C.warning : C.success,
          },
          {
            label: 'On-Time Rate',
            value: `${sf(otr, 1)}%`,
            note: otr >= 80 ? 'Excellent deadline adherence' : otr >= 60 ? 'Acceptable, room to improve' : 'Below target — review workload distribution',
            accent: otr >= 80 ? C.success : otr >= 60 ? C.warning : C.danger,
            color: otr >= 80 ? C.success : otr >= 60 ? C.warning : C.danger,
          },
          {
            label: 'Revisions',
            value: String(summary.revision_count || 0),
            note: (summary.revision_count || 0) === 0 ? 'No stage revisits — clean workflow' : 'Stage revisits recorded',
            accent: (summary.revision_count || 0) === 0 ? C.success : C.warning,
            color: (summary.revision_count || 0) === 0 ? C.success : C.warning,
          },
        ]} />

        {sr != null && sr < 60 && (
          <Insight
            text={`Success rate of ${sr}% is below the 60% threshold. Review task assignment difficulty and workload balance.`}
            color={C.warning}
          />
        )}
        {eff > 120 && (
          <Insight
            text={`Timer efficiency of ${sf(eff, 1)}% indicates tasks consistently exceed their estimated duration. Consider recalibrating task estimates.`}
            color={C.warning}
          />
        )}
        {sr != null && sr >= 80 && otr >= 80 && (
          <Insight
            text={`${workerName} is performing at a high level — ${sr}% success rate and ${sf(otr, 1)}% on-time delivery across this period.`}
            color={C.success}
          />
        )}

        <Footer jobId={jobId} />
      </Page>
    </Document>
  )
}
