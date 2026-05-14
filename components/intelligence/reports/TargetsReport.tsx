import React from 'react'
import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer'
import { C, F, base, statusColor } from './theme'
import { Cover, Footer, Section, Sub, KpiRow, Table, HBar, Empty, Insight, sf, fmtDate } from './shared'

const s = StyleSheet.create({
  page: { ...base.page },
  groupHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, marginTop: 4 },
  groupDot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  groupLabel: { fontFamily: 'Helvetica-Bold', fontSize: F.base },
})

export interface TargetItem {
  pipeline: string
  stage: string
  type: string
  target: number
  current: number
  deadline: string | null
  status: 'hit' | 'active' | 'expired'
}

export interface TargetsData {
  targets: TargetItem[]
  company: string
}

export function TargetsReport({ data, jobId }: { data: TargetsData; jobId: string }) {
  const { targets, company } = data

  const hit     = targets.filter(t => t.status === 'hit')
  const active  = targets.filter(t => t.status === 'active')
  const expired = targets.filter(t => t.status === 'expired')
  const hitRate = targets.length > 0 ? Math.round((hit.length / targets.length) * 100) : 0

  const renderGroup = (items: TargetItem[], label: string, color: string) => {
    if (items.length === 0) return null
    return (
      <>
        <View style={s.groupHeader}>
          <View style={[s.groupDot, { backgroundColor: color }]} />
          <Text style={[s.groupLabel, { color }]}>{label} ({items.length})</Text>
        </View>
        <Table
          headers={['Pipeline', 'Stage', 'Type', 'Target', 'Current', 'Deadline']}
          colFlex={[2.5, 2, 1.5, 1, 1, 2]}
          rows={items.map(t => ({
            cells: [
              t.pipeline.substring(0, 22),
              t.stage.substring(0, 18),
              t.type,
              String(t.target),
              String(t.current),
              fmtDate(t.deadline),
            ],
            colors: [null, null, null, null, t.current >= t.target ? C.success : C.muted, null],
          }))}
        />
      </>
    )
  }

  return (
    <Document>
      <Cover
        title="Objectives & SLA Report"
        subtitle="All active, hit, and expired performance targets"
        company={company}
        dateRange={`As of ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`}
      />

      <Page size="A4" style={s.page}>
        <Section title="Company-Wide Performance Targets" />

        <KpiRow items={[
          { label: 'Total Targets',   value: String(targets.length),    accent: C.primary },
          { label: 'Hit',             value: String(hit.length),         accent: C.success, color: hit.length > 0 ? C.success : C.muted },
          { label: 'Active',          value: String(active.length),      accent: C.primary },
          { label: 'Expired',         value: String(expired.length),     accent: C.danger,  color: expired.length > 0 ? C.danger : C.muted },
          { label: 'Hit Rate',        value: `${hitRate}%`,              accent: hitRate >= 70 ? C.success : hitRate >= 40 ? C.warning : C.danger, color: hitRate >= 70 ? C.success : hitRate >= 40 ? C.warning : C.danger },
        ]} />

        {targets.length === 0 ? (
          <Empty msg="No performance targets configured. Set targets from Pipeline Settings." />
        ) : (
          <>
            {active.length > 0 && (
              <>
                <Sub title="Progress on Active Targets" />
                <HBar data={active.map(t => ({
                  label: `${t.pipeline.substring(0, 12)} — ${t.stage.substring(0, 10)}`,
                  value: t.current,
                  display: `${t.current} / ${t.target}`,
                  color: t.current >= t.target * 0.8 ? C.success : t.current >= t.target * 0.5 ? C.warning : C.primary,
                }))} />
              </>
            )}

            {renderGroup(hit,     'HIT',     C.success)}
            {renderGroup(active,  'ACTIVE',  C.primary)}
            {renderGroup(expired, 'EXPIRED', C.danger)}

            {hitRate >= 70 && <Insight text={`${hitRate}% of targets have been hit — strong objective achievement this period.`} color={C.success} />}
            {expired.length > 0 && <Insight text={`${expired.length} target${expired.length > 1 ? 's' : ''} expired without being hit. Review feasibility and adjust future targets accordingly.`} color={C.warning} />}
            {active.length > 0 && active.some(t => t.deadline && new Date(t.deadline) < new Date(Date.now() + 7 * 86400000)) && (
              <Insight text={`${active.filter(t => t.deadline && new Date(t.deadline) < new Date(Date.now() + 7 * 86400000)).length} active target(s) have deadlines within the next 7 days.`} color={C.warning} />
            )}
          </>
        )}

        <Footer jobId={jobId} />
      </Page>
    </Document>
  )
}
