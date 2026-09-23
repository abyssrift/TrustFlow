import { normalizeReportTimeframe, type ReportTimeframe } from './reportTimeframe'

export type ReportPeriodKind = 'iso_week' | 'calendar_month' | 'calendar_quarter'
export type ReportCadence = 'weekly' | 'monthly' | 'quarterly'

export type ReportOutputFormat = 'html' | 'pdf'
export type PresentationProfile = 'manager' | 'analyst' | 'client_ready'
export type MetricStatus = 'observed' | 'not_available' | 'suppressed' | 'failed'
export type Completeness = 'complete' | 'partial' | 'failed'

export interface ReportScope {
  readonly companyId: string
  readonly scopeType: string
  readonly scopeIds: readonly string[]
}

export interface ReportPeriod extends ReportTimeframe {
  readonly kind: ReportPeriodKind
  readonly key: string
  readonly startLocalDate: string
  readonly endLocalDateInclusive: string
}

export interface ReportRequest {
  readonly reportType: string
  readonly companyId: string
  readonly scope: ReportScope
  readonly filters: Readonly<Record<string, unknown>>
  readonly period: ReportPeriod
  readonly comparisonPeriod: ReportPeriod | null
  readonly timezone: string
  readonly locale: string
  readonly presentationProfile: PresentationProfile
  readonly selectedSections: readonly string[]
  readonly outputFormats: readonly ReportOutputFormat[]
  readonly requesterId: string
  readonly idempotencyKey: string
}

export interface MetricDefinition {
  readonly id: string
  readonly version: number
  readonly label: string
  readonly description: string
  readonly numerator: string | null
  readonly denominator: string | null
  readonly eligiblePopulation: string
  readonly aggregationGrain: string
  readonly exclusions: readonly string[]
  readonly unit: string
  readonly periodRule: string
  readonly comparisonRule: string | null
  readonly missingness: 'not_available' | 'suppressed' | 'failed'
  readonly rounding: number | null
  readonly displayFormat: string
}

export interface MetricValue {
  readonly value: number | null
  readonly status: MetricStatus
  readonly numerator: number | null
  readonly denominator: number | null
  readonly sampleCount: number | null
  readonly caveat: string | null
}

export interface ReportMetric {
  readonly definition: MetricDefinition
  readonly value: MetricValue
}

/** Build a ratio value without turning an undefined denominator into zero. */
export function metricRatio(
  numerator: number | null,
  denominator: number | null,
  sampleCount: number | null = null,
  caveat: string | null = null,
): MetricValue {
  if (typeof numerator !== 'number' || !Number.isFinite(numerator) || typeof denominator !== 'number' || !Number.isFinite(denominator) || denominator <= 0 || numerator < 0) {
    return { value: null, status: 'not_available', numerator, denominator, sampleCount, caveat }
  }
  return { value: numerator / denominator, status: 'observed', numerator, denominator, sampleCount, caveat }
}

/** Return a winner only when there is positive observed evidence. */
export function selectMetricLeaders<T extends { readonly id: string; readonly value: number | null }>(
  rows: readonly T[],
): { readonly maxValue: number; readonly leaders: readonly T[] } | null {
  const observed = rows.filter((row): row is T & { readonly value: number } => (
    typeof row.value === 'number' && Number.isFinite(row.value) && row.value > 0
  ))
  if (observed.length === 0) return null
  const maxValue = Math.max(...observed.map(row => row.value))
  return { maxValue, leaders: observed.filter(row => row.value === maxValue) }
}

export interface ReportProvenance {
  readonly tenantFingerprint: string
  readonly scopeFingerprint: string
  readonly appliedFilters: Readonly<Record<string, unknown>>
  readonly period: ReportPeriod
  readonly dataAsOfUtc: string
  readonly sourceVersions: Readonly<Record<string, string>>
  readonly rowCount: number
  readonly sampleCount: number
  readonly exclusionCount: number
  readonly completeness: Completeness
  readonly missingRequiredSources: readonly string[]
}

export interface ReportSection {
  readonly id: string
  readonly title: string
  readonly data: unknown
}

export interface ReportSnapshot {
  readonly schemaVersion: number
  readonly snapshotId: string
  readonly requestId: string
  readonly reportType: string
  readonly scope: ReportScope
  readonly filters: Readonly<Record<string, unknown>>
  readonly period: ReportPeriod
  readonly metrics: Readonly<Record<string, ReportMetric>>
  readonly sections: readonly ReportSection[]
  readonly provenance: ReportProvenance
}

export interface ArtifactManifestEntry {
  readonly format: ReportOutputFormat
  readonly rendererVersion: string
  readonly checksum: string
}

export interface ReportManifest {
  readonly manifestVersion: number
  readonly runId: string
  readonly snapshotId: string
  readonly request: ReportRequest
  readonly provenance: ReportProvenance
  readonly metricCatalogVersion: string
  readonly reportModelVersion: string
  readonly renderers: Readonly<Record<ReportOutputFormat, string>>
  readonly buildRevision: string
  readonly artifacts: readonly ArtifactManifestEntry[]
  readonly creatorId: string
  readonly scheduleId: string | null
  readonly recipientIds: readonly string[]
  readonly status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  readonly createdAtUtc: string
  readonly completedAtUtc: string | null
}

export interface PreviousCompletedPeriodInput {
  readonly kind: ReportPeriodKind
  readonly asOfUtc: string
  readonly timezone: string
}

export interface ScheduledOccurrenceInput {
  readonly cadence: ReportCadence
  readonly targetPeriod: ReportPeriod
  readonly timezone: string
  readonly localTime: string
  readonly weekday?: number
  readonly dayOfMonth?: number
}

export interface ScheduledOccurrence {
  readonly timezone: string
  readonly localDate: string
  readonly requestedLocalTime: string
  readonly resolvedLocalTime: string
  readonly resolvedUtc: string
  readonly dstResolution: 'exact' | 'next_valid' | 'earlier_repeated'
  readonly occurrenceKey: string
}

/** Resolve the immediately preceding completed calendar period in a local timezone. */
export function resolvePreviousCompletedPeriod(input: PreviousCompletedPeriodInput): ReportPeriod {
  const asOf = parseTimestamp(input.asOfUtc)
  if (asOf === null) throw new Error('asOfUtc must be a valid ISO timestamp')
  const localDate = localDateForTimestamp(asOf, input.timezone)
  if (localDate === null) throw new Error('timezone must be a valid IANA timezone')

  const localDay = dayNumber(parseDate(localDate))
  let startDay: number
  let endDay: number
  if (input.kind === 'iso_week') {
    const monday = localDay - (weekdayMondayFirst(localDay) - 1)
    startDay = monday - 7
    endDay = monday - 1
  } else if (input.kind === 'calendar_month') {
    const current = parseDate(localDate)
    const currentMonthStart = dayNumber([current[0], current[1], 1])
    startDay = previousMonthStart(currentMonthStart)
    endDay = startDay + daysInMonth(dayNumberToDate(startDay)) - 1
  } else {
    const current = parseDate(localDate)
    const currentQuarterMonth = Math.floor((current[1] - 1) / 3) * 3 + 1
    const currentQuarterStart = dayNumber([current[0], currentQuarterMonth, 1])
    startDay = addMonths(currentQuarterStart, -3)
    endDay = addMonths(startDay, 3) - 1
  }

  const startDate = formatDate(dayNumberToDate(startDay))
  const endDate = formatDate(dayNumberToDate(endDay))
  const normalized = normalizeReportTimeframe(startDate, endDate, input.timezone)
  if (!normalized.ok) throw new Error(normalized.error.message)
  return {
    ...normalized.value,
    kind: input.kind,
    key: `${input.kind}:${startDate}`,
    startLocalDate: startDate,
    endLocalDateInclusive: endDate,
  }
}

/** Resolve one local scheduled occurrence, applying the documented DST policy. */
export function resolveScheduledOccurrence(input: ScheduledOccurrenceInput): ScheduledOccurrence {
  const localDate = occurrenceDate(input)
  const time = parseLocalTime(input.localTime)
  if (time === null) throw new Error('localTime must use HH:mm')
  const resolved = resolveLocalWallTime(localDate, input.localTime, input.timezone)
  if (resolved === null) throw new Error('timezone must be a valid IANA timezone')
  return {
    timezone: input.timezone,
    localDate,
    requestedLocalTime: input.localTime,
    resolvedLocalTime: resolved.localTime,
    resolvedUtc: new Date(resolved.timestamp).toISOString(),
    dstResolution: resolved.policy,
    occurrenceKey: `${input.cadence}:${input.targetPeriod.key}:${localDate}T${input.localTime}`,
  }
}

function occurrenceDate(input: ScheduledOccurrenceInput): string {
  if (input.cadence === 'weekly') {
    if (!Number.isInteger(input.weekday) || input.weekday! < 1 || input.weekday! > 7) throw new Error('weekday must be 1 through 7')
    return formatDate(dayNumberToDate(dayNumber(parseDate(input.targetPeriod.startLocalDate)) + 7 + input.weekday! - 1))
  }
  if (!Number.isInteger(input.dayOfMonth) || input.dayOfMonth! < 1 || input.dayOfMonth! > 31) throw new Error('dayOfMonth must be 1 through 31')
  const target = parseDate(input.targetPeriod.startLocalDate)
  const monthOffset = input.cadence === 'monthly' ? 1 : 3
  const monthIndex = target[0] * 12 + target[1] - 1 + monthOffset
  const year = Math.floor(monthIndex / 12)
  const month = monthIndex % 12 + 1
  const day = Math.min(input.dayOfMonth!, daysInMonth([year, month, 1]))
  return formatDate([year, month, day])
}

function resolveLocalWallTime(date: string, requested: string, timezone: string): { timestamp: number; localTime: string; policy: ScheduledOccurrence['dstResolution'] } | null {
  const formatter = makeDateTimeFormatter(timezone)
  if (formatter === null) return null
  const exact: number[] = []
  const requestedKey = `${date}T${requested}`
  const [year, month, day] = parseDate(date)
  const [hour, minute] = parseLocalTime(requested)!
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0, 0)
  for (let timestamp = naive - 14 * 60 * 60 * 1000; timestamp <= naive + 14 * 60 * 60 * 1000; timestamp += 60 * 1000) {
    if (localDateTime(timestamp, formatter) === requestedKey) exact.push(timestamp)
  }
  if (exact.length > 0) {
    const timestamp = Math.min(...exact)
    return { timestamp, localTime: requested, policy: exact.length > 1 ? 'earlier_repeated' : 'exact' }
  }
  for (let timestamp = naive; timestamp <= naive + 14 * 60 * 60 * 1000; timestamp += 60 * 1000) {
    const local = localDateTime(timestamp, formatter)
    if (local > requestedKey) return { timestamp, localTime: local.slice(11), policy: 'next_valid' }
  }
  return null
}

function localDateForTimestamp(timestamp: number, timezone: string): string | null {
  const formatter = makeDateTimeFormatter(timezone)
  return formatter === null ? null : localDateTime(timestamp, formatter).slice(0, 10)
}

function makeDateTimeFormatter(timezone: string): Intl.DateTimeFormat | null {
  try {
    return new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    })
  } catch {
    return null
  }
}

function localDateTime(timestamp: number, formatter: Intl.DateTimeFormat): string {
  const parts = formatter.formatToParts(timestamp)
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? ''
  return `${value('year').padStart(4, '0')}-${value('month')}-${value('day')}T${value('hour')}:${value('minute')}`
}

function parseTimestamp(value: string): number | null {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

function parseLocalTime(value: string): [number, number] | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null
  return [Number(match[1]), Number(match[2])]
}

function parseDate(value: string): [number, number, number] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) throw new Error(`Invalid date: ${value}`)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function dayNumber(date: [number, number, number]): number {
  return Date.UTC(date[0], date[1] - 1, date[2]) / 86400000
}

function dayNumberToDate(value: number): [number, number, number] {
  const date = new Date(value * 86400000)
  return [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()]
}

function formatDate([year, month, day]: [number, number, number]): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function previousMonthStart(startDay: number): number {
  const [year, month] = dayNumberToDate(startDay)
  return dayNumber(month === 1 ? [year - 1, 12, 1] : [year, month - 1, 1])
}

function addMonths(startDay: number, amount: number): number {
  const [year, month] = dayNumberToDate(startDay)
  const monthIndex = year * 12 + month - 1 + amount
  return dayNumber([Math.floor(monthIndex / 12), monthIndex % 12 + 1, 1])
}

function daysInMonth([year, month]: [number, number, number]): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function weekdayMondayFirst(day: number): number {
  const sundayFirst = new Date(day * 86400000).getUTCDay()
  return sundayFirst === 0 ? 7 : sundayFirst
}
