import React from 'react'
import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer'
import { C, F, base } from './theme'
import { Cover, Footer, Section, Sub, KpiRow, Empty, Insight, sf, fmtSec } from './shared'

const s = StyleSheet.create({
  page: { ...base.page },
  statusBadge: { alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 6, marginBottom: 16 },
  statusText: { fontSize: F.base, fontFamily: 'Helvetica-Bold', letterSpacing: 0.5 },
  note: { fontSize: F.sm, color: C.muted, fontStyle: 'italic', marginTop: 16, lineHeight: 1.6 },
})

export interface PersonalPulseData {
  workerName: string
  dailyPts: number
  monthlyPts: number
  activeSecondsToday: number
  isWorking: boolean
  flapRate: number
  taskCount: number
  company: string
}

export function PersonalPulseReport({ data, jobId }: { data: PersonalPulseData; jobId: string }) {
  const {
    workerName, dailyPts, monthlyPts, activeSecondsToday,
    isWorking, flapRate, taskCount, company,
  } = data

  const flapColor = flapRate > 2 ? C.danger : flapRate > 1.5 ? C.warning : C.success
  const flapNote  = flapRate > 2 ? 'High reversal activity — review workflow discipline' : flapRate > 1.5 ? 'Moderate revisit rate' : 'Clean workflow — minimal stage revisits'

  return (
    <Document>
      <Cover
        title="Personal Activity Snapshot"
        subtitle="Real-time daily points, session time & flap rate"
        company={workerName}
        dateRange={new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
      />

      <Page size="A4" style={s.page}>
        <Section title="Today at a Glance" />

        <View style={[s.statusBadge, { backgroundColor: isWorking ? C.successDim : C.bg, borderWidth: 1, borderColor: isWorking ? C.success : C.border }]}>
          <Text style={[s.statusText, { color: isWorking ? C.success : C.muted }]}>
            {isWorking ? '● Currently Active' : '○ Not Clocked In'}
          </Text>
        </View>

        <KpiRow items={[
          { label: 'Daily Points',    value: String(dailyPts),              note: isWorking ? 'Session in progress' : 'Session ended', accent: C.primary },
          { label: 'Monthly Points',  value: String(monthlyPts),            note: 'This calendar month',                               accent: C.success },
          { label: 'Session Time',    value: fmtSec(activeSecondsToday),    note: 'Active today',                                      accent: C.warning },
        ]} />

        <Section title="30-Day Metrics" />

        <KpiRow items={[
          { label: 'Flap Rate',     value: sf(flapRate, 2),   note: flapNote,               accent: flapColor, color: flapColor },
          { label: 'Total Tasks',   value: String(taskCount), note: 'Assigned over 30 days', accent: C.primary },
        ]} />

        {dailyPts === 0 && monthlyPts === 0 && (
          <Empty msg="No completed tasks found. Points accumulate as tasks are completed and approved." />
        )}

        {isWorking && (
          <Insight text={`${workerName} is currently in an active session. This snapshot reflects progress up to the moment of report generation.`} color={C.success} />
        )}
        {flapRate > 2 && (
          <Insight text={`Flap rate of ${sf(flapRate, 2)} is above the healthy threshold of 2.0. Consider reviewing stage transition habits and approval workflows.`} color={C.danger} />
        )}
        {monthlyPts > 0 && (
          <Insight text={`${monthlyPts} points earned this calendar month. Daily average: ${sf(monthlyPts / new Date().getDate(), 1)} pts/day.`} color={C.primary} />
        )}

        <Text style={s.note}>
          This snapshot was captured at the moment of report generation. Point totals reset at calendar boundaries (daily at midnight, monthly on the 1st).
        </Text>

        <Footer jobId={jobId} />
      </Page>
    </Document>
  )
}
