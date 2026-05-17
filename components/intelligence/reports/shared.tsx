import React from 'react'
import { View, Text, StyleSheet, Svg, Rect, Line, Page } from '@react-pdf/renderer'
import { C, F, M, GAP, base, rateColor } from './theme'

// ── Formatters ────────────────────────────────────────────────────────────────

export const sf = (v: any, d = 0) =>
  v == null || isNaN(Number(v)) ? '—' : Number(v).toFixed(d)

export const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

export const fmtSec = (s: number) => {
  if (!s || s <= 0) return '0m'
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

// ── Cover Page ────────────────────────────────────────────────────────────────

const coverStyles = StyleSheet.create({
  page: { backgroundColor: C.dark, padding: 0, fontFamily: 'Helvetica' },
  topBar: { height: 6, backgroundColor: C.primary, width: '100%' },
  body: { flex: 1, paddingHorizontal: 50, paddingVertical: 50, justifyContent: 'space-between' },
  badge: { flexDirection: 'row', alignItems: 'center', marginBottom: 40 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.primary, marginRight: 8 },
  brandText: { color: C.primary, fontSize: F.sm, fontFamily: 'Helvetica-Bold', letterSpacing: 3 },
  title: { color: '#ffffff', fontSize: F['3xl'], fontFamily: 'Helvetica-Bold', lineHeight: 1.1, marginBottom: 12 },
  subtitle: { color: C.muted, fontSize: F.lg, marginBottom: 40 },
  divider: { height: 1, backgroundColor: '#334155', marginBottom: 24 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  metaLabel: { color: C.muted, fontSize: F.xs, fontFamily: 'Helvetica-Bold', letterSpacing: 1, marginBottom: 3 },
  metaValue: { color: '#ffffff', fontSize: F.base, fontFamily: 'Helvetica-Bold' },
  genText: { color: '#475569', fontSize: F.xs },
})

export function Cover({
  title, subtitle, company, dateRange,
}: {
  title: string; subtitle: string; company: string; dateRange: string;
}) {
  return (
    <Page size="A4" style={coverStyles.page}>
      <View style={coverStyles.topBar} />
      <View style={coverStyles.body}>
        <View>
          <View style={coverStyles.badge}>
            <View style={coverStyles.dot} />
            <Text style={coverStyles.brandText}>TRUSTFLOW INTELLIGENCE</Text>
          </View>
          <Text style={coverStyles.title}>{title}</Text>
          <Text style={coverStyles.subtitle}>{subtitle}</Text>
        </View>
        <View>
          <View style={coverStyles.divider} />
          <View style={coverStyles.metaRow}>
            <View>
              <Text style={coverStyles.metaLabel}>ORGANIZATION</Text>
              <Text style={coverStyles.metaValue}>{company}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={coverStyles.metaLabel}>PERIOD</Text>
              <Text style={coverStyles.metaValue}>{dateRange}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={coverStyles.metaLabel}>GENERATED</Text>
              <Text style={coverStyles.genText}>{new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</Text>
            </View>
          </View>
        </View>
      </View>
    </Page>
  )
}

// ── Footer ────────────────────────────────────────────────────────────────────

const footerS = StyleSheet.create({
  wrap: { position: 'absolute', bottom: 16, left: M, right: M, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  line: { position: 'absolute', top: -6, left: 0, right: 0 },
  txt: { color: C.dim, fontSize: F.xs },
})

export function Footer({ jobId, pageNum }: { jobId: string; pageNum?: number }) {
  return (
    <View style={footerS.wrap} fixed>
      <Svg height={1} width={523} style={footerS.line}>
        <Line x1={0} y1={0} x2={523} y2={0} stroke={C.border} strokeWidth={0.5} />
      </Svg>
      <Text style={footerS.txt}>TrustFlow · Report #{jobId.substring(0, 8).toUpperCase()}</Text>
      <Text style={footerS.txt} render={({ pageNumber, totalPages }) => `Page ${pageNumber} / ${totalPages}`} />
    </View>
  )
}

// ── Section Divider (module header, replaces Cover in multi-report mode) ─────

const divS = StyleSheet.create({
  wrap:  { borderRadius: 4, marginBottom: 12, overflow: 'hidden', borderWidth: 1, borderColor: C.border },
  top:   { backgroundColor: C.primary, paddingHorizontal: 10, paddingVertical: 4, flexDirection: 'row', alignItems: 'center' },
  dot:   { width: 4, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.6)', marginRight: 6 },
  brand: { color: 'rgba(255,255,255,0.85)', fontSize: F.xs, fontFamily: 'Helvetica-Bold', letterSpacing: 2 },
  body:  { paddingHorizontal: 10, paddingTop: 7, paddingBottom: 7, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f1f5f9' },
  title: { color: C.text, fontSize: F.md, fontFamily: 'Helvetica-Bold' },
  meta:  { color: C.muted, fontSize: F.xs },
})

export function SectionDivider({ title, company, dateRange }: { title: string; company: string; dateRange: string }) {
  return (
    <View style={divS.wrap}>
      <View style={divS.top}>
        <View style={divS.dot} />
        <Text style={divS.brand}>TRUSTFLOW INTELLIGENCE</Text>
      </View>
      <View style={divS.body}>
        <Text style={divS.title}>{title}</Text>
        <Text style={divS.meta}>{company} · {dateRange}</Text>
      </View>
    </View>
  )
}

// ── Section Header ────────────────────────────────────────────────────────────

const sectionS = StyleSheet.create({
  wrap: { backgroundColor: C.primary, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, marginBottom: 10 },
  text: { color: '#ffffff', fontSize: F.md, fontFamily: 'Helvetica-Bold', letterSpacing: 0.5 },
})

export function Section({ title }: { title: string }) {
  return (
    <View style={sectionS.wrap}>
      <Text style={sectionS.text}>{title}</Text>
    </View>
  )
}

// ── Sub-heading ───────────────────────────────────────────────────────────────

const subS = StyleSheet.create({
  wrap: { borderLeftWidth: 3, borderLeftColor: C.primary, paddingLeft: 8, marginBottom: 8, marginTop: 4 },
  text: { color: C.text, fontSize: F.base, fontFamily: 'Helvetica-Bold' },
})

export function Sub({ title }: { title: string }) {
  return (
    <View style={subS.wrap}>
      <Text style={subS.text}>{title}</Text>
    </View>
  )
}

// ── KPI Row ───────────────────────────────────────────────────────────────────

const kpiS = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  card: { flex: 1, backgroundColor: C.bg, borderRadius: 6, padding: 10, borderWidth: 1, borderColor: C.border, borderLeftWidth: 3 },
  label: { color: C.muted, fontSize: F.xs, fontFamily: 'Helvetica-Bold', letterSpacing: 0.5, marginBottom: 4, textTransform: 'uppercase' },
  value: { color: C.text, fontSize: F.xl, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  note: { fontSize: F.xs },
})

export function KpiRow({ items }: {
  items: { label: string; value: string; note?: string; color?: string; accent?: string }[]
}) {
  return (
    <View style={kpiS.row}>
      {items.map((item, i) => (
        <View key={i} style={[kpiS.card, { borderLeftColor: item.accent || C.primary }]}>
          <Text style={kpiS.label}>{item.label}</Text>
          <Text style={kpiS.value}>{item.value}</Text>
          {item.note ? <Text style={[kpiS.note, { color: item.color || C.muted }]}>{item.note}</Text> : null}
        </View>
      ))}
    </View>
  )
}

// ── Table ─────────────────────────────────────────────────────────────────────

const tableS = StyleSheet.create({
  wrap: { marginBottom: 10, borderRadius: 6, overflow: 'hidden', borderWidth: 1, borderColor: C.border },
  header: { flexDirection: 'row', backgroundColor: C.primary, paddingVertical: 5, paddingHorizontal: 8 },
  headerCell: { color: '#ffffff', fontSize: F.xs, fontFamily: 'Helvetica-Bold', letterSpacing: 0.3 },
  row: { flexDirection: 'row', paddingVertical: 4, paddingHorizontal: 8, borderTopWidth: 1, borderTopColor: C.border },
  cell: { fontSize: F.sm, color: C.text },
})

export interface TableRow { cells: string[]; colors?: (string | null | undefined)[] }

export function Table({
  headers, colFlex, rows,
}: {
  headers: string[]; colFlex: number[]; rows: TableRow[];
}) {
  return (
    <View style={tableS.wrap}>
      <View style={tableS.header}>
        {headers.map((h, i) => (
          <Text key={i} style={[tableS.headerCell, { flex: colFlex[i] }]}>{h}</Text>
        ))}
      </View>
      {rows.map((row, ri) => (
        <View key={ri} style={[tableS.row, { backgroundColor: ri % 2 === 0 ? C.card : C.bg }]}>
          {row.cells.map((cell, ci) => (
            <Text key={ci} style={[tableS.cell, { flex: colFlex[ci], color: row.colors?.[ci] || C.text }]}>
              {cell}
            </Text>
          ))}
        </View>
      ))}
      {rows.length === 0 && (
        <View style={[tableS.row, { backgroundColor: C.card }]}>
          <Text style={[tableS.cell, { color: C.muted, fontStyle: 'italic' }]}>No data available.</Text>
        </View>
      )}
    </View>
  )
}

// ── Horizontal Bar Chart ──────────────────────────────────────────────────────

const hbarS = StyleSheet.create({
  wrap: { marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  label: { fontSize: F.xs, color: C.muted, width: 110 },
  track: { flex: 1, height: 14, backgroundColor: C.bg, borderRadius: 3, overflow: 'hidden', borderWidth: 1, borderColor: C.border },
  fill: { height: 14, borderRadius: 3 },
  valText: { fontSize: F.xs, color: C.text, fontFamily: 'Helvetica-Bold', width: 68, textAlign: 'right' },
})

export function HBar({ data }: {
  data: { label: string; value: number; display?: string; color?: string }[]
}) {
  const max = Math.max(...data.map(d => d.value), 1)
  return (
    <View style={hbarS.wrap}>
      {data.map((item, i) => (
        <View key={i} style={hbarS.row}>
          <Text style={hbarS.label} numberOfLines={1}>{item.label}</Text>
          <View style={hbarS.track}>
            <View style={[hbarS.fill, { width: `${(item.value / max) * 100}%`, backgroundColor: item.color || C.primary }]} />
          </View>
          <Text style={hbarS.valText}>{item.display ?? String(item.value)}</Text>
        </View>
      ))}
    </View>
  )
}

// ── Vertical Bar Chart (SVG) ──────────────────────────────────────────────────

const vbarS = StyleSheet.create({
  wrap: { marginBottom: 16 },
  labels: { flexDirection: 'row', marginTop: 3 },
  labelTxt: { fontSize: 6, color: C.muted, textAlign: 'center' },
})

export function VBar({ data, height = 80, color = C.primary }: {
  data: { label: string; value: number }[]; height?: number; color?: string
}) {
  const max = Math.max(...data.map(d => d.value), 1)
  const chartW = 523 // content width (595 - 36*2)
  const n = data.length
  const barW = Math.max(6, Math.floor((chartW / n) * 0.65))
  const gapW = Math.floor(chartW / n)

  return (
    <View style={vbarS.wrap}>
      <Svg height={height} width={chartW}>
        {/* baseline */}
        <Line x1={0} y1={height} x2={chartW} y2={height} stroke={C.border} strokeWidth={0.5} />
        {data.map((item, i) => {
          const barH = Math.max(2, (item.value / max) * (height - 4))
          const x = i * gapW + (gapW - barW) / 2
          return (
            <Rect key={i} x={x} y={height - barH} width={barW} height={barH} fill={color} rx={2} />
          )
        })}
      </Svg>
      <View style={vbarS.labels}>
        {data.map((item, i) => (
          <Text key={i} style={[vbarS.labelTxt, { width: gapW }]} numberOfLines={1}>
            {item.label}
          </Text>
        ))}
      </View>
    </View>
  )
}

// ── Stacked Bar (success/fail) ────────────────────────────────────────────────

export function StackedVBar({ data, height = 80 }: {
  data: { label: string; success: number; fail: number }[]
}) {
  const maxTotal = Math.max(...data.map(d => d.success + d.fail), 1)
  const chartW = 523
  const n = data.length
  const barW = Math.max(6, Math.floor((chartW / n) * 0.6))
  const gapW = Math.floor(chartW / n)

  return (
    <View style={vbarS.wrap}>
      <Svg height={height} width={chartW}>
        <Line x1={0} y1={height} x2={chartW} y2={height} stroke={C.border} strokeWidth={0.5} />
        {data.map((item, i) => {
          const total = item.success + item.fail
          const totalH = Math.max(2, (total / maxTotal) * (height - 4))
          const successH = total > 0 ? (item.success / total) * totalH : 0
          const failH = totalH - successH
          const x = i * gapW + (gapW - barW) / 2
          return (
            <React.Fragment key={i}>
              {failH > 0 && <Rect x={x} y={height - totalH} width={barW} height={Math.max(0, failH)} fill={C.danger} rx={2} />}
              {successH > 0 && <Rect x={x} y={height - successH} width={barW} height={Math.max(0, successH)} fill={C.success} rx={2} />}
            </React.Fragment>
          )
        })}
      </Svg>
      <View style={vbarS.labels}>
        {data.map((item, i) => (
          <Text key={i} style={[vbarS.labelTxt, { width: gapW }]} numberOfLines={1}>
            {item.label}
          </Text>
        ))}
      </View>
    </View>
  )
}

// ── Empty State ───────────────────────────────────────────────────────────────

const emptyS = StyleSheet.create({
  wrap: { padding: 20, borderRadius: 6, backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, marginBottom: 16, alignItems: 'center' },
  text: { color: C.muted, fontSize: F.sm, fontStyle: 'italic' },
})

export function Empty({ msg = 'No data available for this period.' }: { msg?: string }) {
  return (
    <View style={emptyS.wrap}>
      <Text style={emptyS.text}>{msg}</Text>
    </View>
  )
}

// ── Badge ─────────────────────────────────────────────────────────────────────

const badgeS = StyleSheet.create({
  wrap: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, alignSelf: 'flex-start' },
  text: { fontSize: F.xs, fontFamily: 'Helvetica-Bold', letterSpacing: 0.3 },
})

export function Badge({ label, color, bg }: { label: string; color: string; bg: string }) {
  return (
    <View style={[badgeS.wrap, { backgroundColor: bg }]}>
      <Text style={[badgeS.text, { color }]}>{label.toUpperCase()}</Text>
    </View>
  )
}

// ── Comparison Row (two-column metric grid) ───────────────────────────────────

const cmpS = StyleSheet.create({
  header: { flexDirection: 'row', paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: C.border, marginBottom: 6 },
  headerLabel: { flex: 1, fontSize: F.xs, fontFamily: 'Helvetica-Bold', color: C.muted, letterSpacing: 0.5, textTransform: 'uppercase' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: C.bg },
  metricLabel: { flex: 1.2, fontSize: F.sm, color: C.muted },
  metricVal: { flex: 1, fontSize: F.sm, fontFamily: 'Helvetica-Bold' },
})

export function CompareGrid({
  nameA, nameB,
  rows,
}: {
  nameA: string; nameB: string;
  rows: { label: string; vA: string; vB: string; winA: boolean | null }[]
}) {
  return (
    <View style={{ marginBottom: 16 }}>
      <View style={cmpS.header}>
        <Text style={[cmpS.headerLabel, { flex: 1.2 }]}>Metric</Text>
        <Text style={cmpS.headerLabel}>{nameA}</Text>
        <Text style={cmpS.headerLabel}>{nameB}</Text>
      </View>
      {rows.map((row, i) => (
        <View key={i} style={cmpS.row}>
          <Text style={cmpS.metricLabel}>{row.label}</Text>
          <Text style={[cmpS.metricVal, { color: row.winA === true ? C.success : row.winA === false ? C.text : C.text }]}>
            {row.vA}{row.winA === true ? ' ✓' : ''}
          </Text>
          <Text style={[cmpS.metricVal, { color: row.winA === false ? C.success : row.winA === true ? C.text : C.text }]}>
            {row.vB}{row.winA === false ? ' ✓' : ''}
          </Text>
        </View>
      ))}
    </View>
  )
}

// ── Insight callout ───────────────────────────────────────────────────────────

const insightS = StyleSheet.create({
  wrap: { flexDirection: 'row', padding: 10, borderRadius: 6, marginBottom: 8, alignItems: 'flex-start' },
  bar: { width: 3, borderRadius: 2, marginRight: 10, alignSelf: 'stretch' },
  text: { fontSize: F.sm, flex: 1, lineHeight: 1.5 },
})

export function Insight({ text, color }: { text: string; color: string }) {
  const bg = color + '18'
  return (
    <View style={[insightS.wrap, { backgroundColor: bg }]}>
      <View style={[insightS.bar, { backgroundColor: color }]} />
      <Text style={[insightS.text, { color: C.text }]}>{text}</Text>
    </View>
  )
}
