import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import React from 'react'
import { Cover, Empty, Footer, HBar, Insight, KpiRow, Section, Sub, Table, sf } from './shared'
import { C, F, base } from './theme'

const s = StyleSheet.create({
  page: { ...base.page },
  twoCol: { flexDirection: 'row', gap: 16, marginBottom: 16 },
  halfCard: { flex: 1, backgroundColor: C.bg, borderRadius: 8, padding: 14, borderWidth: 1, borderColor: C.border },
  halfTitle: { fontSize: F.xs, color: C.muted, fontFamily: 'Helvetica-Bold', letterSpacing: 0.5, marginBottom: 6, textTransform: 'uppercase' },
  halfValue: { fontSize: F.lg, fontFamily: 'Helvetica-Bold', color: C.text },
  halfNote: { fontSize: F.xs, color: C.muted, marginTop: 2 },
})

export interface GeneralData {
  audit: any
  company: string
  dateRange: string
}

export function GeneralReportPages({ data, jobId }: { data: GeneralData; jobId: string }) {
  const a   = data.audit || {}
  const cur = a.current   || {}
  const cmp = a.comparison || {}

  const wtm        = a.worker_time_metrics    || []
  const stageConv  = a.conversion_by_stage    || []
  const stageDur   = a.stage_duration_analysis || []
  const slaRisks   = a.sla_risks              || []
  const engagement = a.worker_engagement      || []
  const costM      = a.cost_metrics           || {}
  const radar      = a.radar_advanced         || {}

  const delta = (c: number, p: number) => {
    if (!p) return 'NEW'
    const pct = Math.round(((c - p) / p) * 100)
    return `${pct > 0 ? '+' : ''}${pct}% vs prior`
  }

  const wtmWithRate = wtm.map((w: any) => ({
    ...w,
    tasks_per_hour: w.total_hours > 0 ? (w.task_count / w.total_hours) : 0,
  }))

  // Avg Time / Task: total active hours → minutes, divided by task count
  const totalHours = costM.total_hours ?? wtm.reduce((s: number, w: any) => s + (w.total_hours || 0), 0)
  const taskCount  = costM.task_count ?? 0
  const avgMinPerTask = taskCount > 0 ? (totalHours * 60) / taskCount : null

  const insights: { text: string; color: string }[] = []
  if ((cur.success_rate || 0) >= 80)
    insights.push({ text: `Strong success rate of ${sf(cur.success_rate, 1)}% — quality control is working.`, color: C.success })
  if ((cur.success_rate || 0) > 0 && (cur.success_rate || 0) < 50)
    insights.push({ text: `Success rate of ${sf(cur.success_rate, 1)}% is below 50%. Investigate root causes of task failure.`, color: C.warning })
  if ((cur.revision_rate || 0) > 30)
    insights.push({ text: `Revision rate of ${sf(cur.revision_rate, 1)}% indicates significant rework. Consider quality gates earlier in the pipeline.`, color: C.warning })
  if (slaRisks.length > 0)
    insights.push({ text: `${slaRisks.length} task${slaRisks.length > 1 ? 's are' : ' is'} at SLA risk (≥99% risk score). Immediate attention required.`, color: C.danger })
  if ((radar.first_pass_yield || 0) > 0)
    insights.push({ text: `First-pass yield: ${sf(radar.first_pass_yield, 1)}% of tasks completed without revision. Flow ratio: ${sf(radar.flow_ratio, 1)}%.`, color: C.primary })
  const top = wtmWithRate.length > 0 ? wtmWithRate[0] : null
  if (top && top.tasks_per_hour > 0)
    insights.push({ text: `Top performer: ${top.full_name} at ${sf(top.tasks_per_hour, 1)} tasks/hour.`, color: C.success })
  if (insights.length === 0)
    insights.push({ text: 'Insufficient data for automated insights. Expand the date range for more meaningful analysis.', color: C.primary })

  return (
    <>
      <Cover
        title="Performance Audit"
        subtitle="Tactical organizational metrics and pipeline health"
        company={data.company}
        dateRange={data.dateRange}
      />

      {/* ── Page 2: KPIs + Stage Funnel ── */}
      <Page size="A4" style={s.page}>
        <Section title="Key Performance Indicators" />
        <KpiRow items={[
          { label: 'Throughput',    value: String(cur.throughput || 0),                    note: delta(cur.throughput || 0, cmp.throughput || 0),                  accent: C.primary },
          { label: 'Lead Time',     value: `${sf(cur.avg_lead_time_minutes || 0, 1)}m`,    note: delta(cur.avg_lead_time_minutes || 0, cmp.avg_lead_time_minutes || 0), accent: C.warning },
          { label: 'Success Rate',  value: `${sf(cur.success_rate || 0, 1)}%`,             note: delta(cur.success_rate || 0, cmp.success_rate || 0),               accent: cur.success_rate >= 80 ? C.success : C.danger, color: cur.success_rate >= 80 ? C.success : C.danger },
          { label: 'Revision Rate', value: `${sf(cur.revision_rate || 0, 1)}%`,            note: 'Rework ratio',                                                    accent: cur.revision_rate < 20 ? C.success : cur.revision_rate < 40 ? C.warning : C.danger, color: cur.revision_rate < 20 ? C.success : cur.revision_rate < 40 ? C.warning : C.danger },
        ]} />

        {(taskCount > 0 || wtm.length > 0) && (
          <View style={s.twoCol}>
            <View style={s.halfCard}>
              <Text style={s.halfTitle}>Total Active Hours</Text>
              <Text style={s.halfValue}>{sf(totalHours, 2)}h</Text>
              <Text style={s.halfNote}>Across {wtm.length} person{wtm.length !== 1 ? 's' : ''}</Text>
            </View>
            <View style={s.halfCard}>
              <Text style={s.halfTitle}>Avg Time / Task</Text>
              <Text style={s.halfValue}>{avgMinPerTask != null ? `${sf(avgMinPerTask, 1)}m` : '—'}</Text>
              <Text style={s.halfNote}>{taskCount > 0 ? `${taskCount} tasks in period` : 'No tasks in period'}</Text>
            </View>
          </View>
        )}

        <Section title="Pipeline Stage Funnel" />
        {stageConv.length > 0 ? (
          <HBar data={stageConv.map((f: any) => ({
            label: String(f.stage_name || 'Unknown').substring(0, 22),
            value: Number(f.task_count) || 0,
            color: C.primary,
          }))} />
        ) : <Empty msg="No pipeline stage data available for this period." />}

        <Footer jobId={jobId} />
      </Page>

      {/* ── Page 3: Operational Analysis ── */}
      <Page size="A4" style={s.page}>
        <Section title="Operational Analysis" />

        <Sub title="Stage Completion Rates" />
        {stageConv.length > 0 ? (
          <HBar data={stageConv.map((r: any) => ({
            label: String(r.stage_name || '—').substring(0, 22),
            value: Math.round((r.completion_rate || 0) * 100),
            display: `${sf((r.completion_rate || 0) * 100, 1)}%`,
            color: (r.completion_rate || 0) >= 0.8 ? C.success : (r.completion_rate || 0) >= 0.5 ? C.warning : C.primary,
          }))} />
        ) : <Empty msg="No completion rate data available." />}

        <Sub title="Stage Duration Analysis" />
        {stageDur.length > 0 ? (
          <Table
            headers={['Stage', 'Avg Duration (days)']}
            colFlex={[3, 2]}
            rows={stageDur.map((s: any) => ({
              cells: [
                String(s.stage_name || '—').substring(0, 30),
                sf(s.avg_duration_days, 2),
              ],
              colors: [null, (s.avg_duration_days || 0) > 3 ? C.danger : (s.avg_duration_days || 0) > 1 ? C.warning : C.success],
            }))}
          />
        ) : <Empty msg="No stage duration data available." />}

        <Sub title="People Engagement (Actions)" />
        {engagement.length > 0 ? (
          <HBar data={engagement.slice(0, 8).map((w: any) => ({
            label: String(w.full_name || '—').substring(0, 22),
            value: w.action_count || 0,
            color: C.primary,
          }))} />
        ) : <Empty msg="No engagement data available." />}

        <Footer jobId={jobId} />
      </Page>

      {/* ── Page 4: Time & Team ── */}
      <Page size="A4" style={s.page}>
        <Section title="Time & Efficiency" />

        <KpiRow items={[
          { label: 'Avg Lead Time',       value: `${sf(cur.avg_lead_time_minutes || 0, 1)}m`, accent: C.warning },
          { label: 'Flow Ratio',          value: `${sf(radar.flow_ratio || 0, 1)}%`,          accent: C.primary },
          { label: 'First-Pass Yield',    value: `${sf(radar.first_pass_yield || 0, 1)}%`,    accent: (radar.first_pass_yield || 0) >= 60 ? C.success : C.warning, color: (radar.first_pass_yield || 0) >= 60 ? C.success : C.warning },
        ]} />

        {wtmWithRate.length > 0 && (
          <>
            <Sub title="Productivity Rankings (Tasks / Hour)" />
            <HBar data={wtmWithRate.slice(0, 8).map((w: any) => ({
              label: String(w.full_name || '—').substring(0, 22),
              value: w.tasks_per_hour || 0,
              display: w.tasks_per_hour > 0 ? `${sf(w.tasks_per_hour, 1)} t/h` : '—',
            }))} />

            <Sub title="People Detail" />
            <Table
              headers={['Person', 'Hours', 'Tasks', 'Tasks/Hr', 'Revision %']}
              colFlex={[3, 1, 1, 1.2, 1.5]}
              rows={wtmWithRate.slice(0, 10).map((w: any) => {
                const rev = w.revision_rate || 0
                return {
                  cells: [
                    String(w.full_name || '—').substring(0, 28),
                    `${sf(w.total_hours, 2)}h`,
                    String(w.task_count || 0),
                    w.tasks_per_hour > 0 ? sf(w.tasks_per_hour, 1) : '—',
                    `${sf(rev, 1)}%`,
                  ],
                  colors: [null, null, null, null, rev < 20 ? C.success : rev < 40 ? C.warning : C.danger],
                }
              })}
            />
          </>
        )}

        {slaRisks.length > 0 && (
          <>
            <Sub title="SLA Risk Items" />
            <Table
              headers={['Task', 'Stage', 'Risk']}
              colFlex={[3, 2, 1]}
              rows={slaRisks.slice(0, 8).map((r: any) => ({
                cells: [
                  String(r.task_number || '—').substring(0, 30),
                  String(r.stage_name  || '—').substring(0, 18),
                  `${r.risk_percent}%`,
                ],
                colors: [null, null, (r.risk_percent || 0) >= 80 ? C.danger : C.warning],
              }))}
            />
          </>
        )}

        <Footer jobId={jobId} />
      </Page>

      {/* ── Page 5: Insights ── */}
      <Page size="A4" style={s.page}>
        <Section title="Insights & Recommendations" />
        {insights.map((ins, i) => <Insight key={i} text={ins.text} color={ins.color} />)}
        <Footer jobId={jobId} />
      </Page>
    </>
  )
}

export function GeneralReport({ data, jobId }: { data: GeneralData; jobId: string }) {
  return (
    <Document>
      <GeneralReportPages data={data} jobId={jobId} />
    </Document>
  )
}
