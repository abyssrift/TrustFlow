import { StyleSheet } from '@react-pdf/renderer'

export const C = {
  primary:    '#6366f1',
  primaryDim: '#e0e7ff',
  success:    '#10b981',
  successDim: '#d1fae5',
  danger:     '#ef4444',
  dangerDim:  '#fee2e2',
  warning:    '#f59e0b',
  warningDim: '#fef3c7',
  text:       '#1e293b',
  muted:      '#64748b',
  dim:        '#94a3b8',
  border:     '#e2e8f0',
  bg:         '#f8fafc',
  card:       '#ffffff',
  dark:       '#0f172a',
  darkMid:    '#1e293b',
} as const

// Keep body/cell text above the PDF reader's practical minimum.
export const F = { xs: 8, sm: 9, base: 10, md: 12, lg: 14, xl: 20, '2xl': 28, '3xl': 38 } as const

export const PDF_RENDERER_VERSION = 'trustflow-pdf-v2'
export const PDF_MIN_READABLE_FONT_SIZE = F.xs

export const M = 36   // page margin
export const GAP = 10 // standard gap between elements
export const CONTENT_WIDTH = 595 - (M * 2)

export const statusColor = (s: string) =>
  s === 'hit' || s === 'completed' ? C.success
  : s === 'expired' || s === 'failed' ? C.danger
  : s === 'active' || s === 'processing' ? C.primary
  : C.muted

export const rateColor = (pct: number) =>
  pct >= 80 ? C.success : pct >= 60 ? C.warning : C.danger

export const base = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    backgroundColor: C.card,
    paddingHorizontal: M,
    paddingTop: M,
    paddingBottom: M + 16,
  },
  row: { flexDirection: 'row' },
  col: { flexDirection: 'column' },
  flex1: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
})
