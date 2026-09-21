export function requireReportQueryData<T>(
  label: string,
  result: { data: T; error: unknown | null },
): T {
  if (result.error != null) {
    const detail = errorMessage(result.error)
    throw new Error(`${label} query failed: ${detail}`)
  }
  return result.data
}

export function requireReportCount(
  label: string,
  result: { data: number | null; error: unknown | null },
): number {
  const count = requireReportQueryData(label, result)
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
    throw new Error(`${label} query returned an invalid count`)
  }
  return count
}

export function requireReportMutationRow<T>(
  label: string,
  result: { data: T | null; error: unknown | null },
): T {
  const row = requireReportQueryData(label, result)
  if (row == null) throw new Error(`${label} did not update a row`)
  return row
}

export function requireCompleteReportRows<T>(
  label: string,
  result: { data: T[] | null; count: number | null; error: unknown | null },
  expectedRowCount?: number,
): T[] {
  const data = requireReportQueryData(label, result) ?? []
  const { count } = result
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
    throw new Error(`${label} query returned an invalid exact count`)
  }
  if (data.length !== count) {
    throw new Error(`${label} query returned ${data.length} of ${count} rows; report is incomplete`)
  }
  if (expectedRowCount !== undefined && count !== expectedRowCount) {
    throw new Error(`${label} query did not resolve all requested rows`)
  }
  return data
}

export interface ReportSessionDurationRow {
  started_at?: unknown
  last_heartbeat_at?: unknown
}

const HOUR_IN_MILLISECONDS = 60 * 60 * 1000

export function sumValidatedSessionHours(rows: readonly ReportSessionDurationRow[]): number {
  return rows.reduce((total, row, index) => {
    const rowNumber = index + 1
    const startedAt = parseTimestamp(row.started_at, rowNumber, 'started_at')
    const endedAt = parseTimestamp(row.last_heartbeat_at, rowNumber, 'last_heartbeat_at')
    if (endedAt < startedAt) {
      throw new Error(`Session row ${rowNumber} ends before it starts`)
    }

    const duration = (endedAt - startedAt) / HOUR_IN_MILLISECONDS
    if (!Number.isFinite(duration)) {
      throw new Error(`Session row ${rowNumber} has an invalid duration`)
    }
    const nextTotal = total + duration
    if (!Number.isFinite(nextTotal)) {
      throw new Error('Report session duration total is invalid')
    }
    return nextTotal
  }, 0)
}

function parseTimestamp(value: unknown, rowNumber: number, field: string): number {
  const timestamp = typeof value === 'string' && isStrictTimestamp(value) ? Date.parse(value) : Number.NaN
  if (!Number.isFinite(timestamp)) {
    throw new Error(`Session row ${rowNumber} has an invalid ${field} timestamp`)
  }
  return timestamp
}

function isStrictTimestamp(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.exec(value)
  if (!match) return false

  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  if (year < 1 || month < 1 || month > 12 || day < 1 || Number(hourText) > 23 || Number(minuteText) > 59 || Number(secondText) > 59) {
    return false
  }

  const date = new Date(0)
  date.setUTCHours(0, 0, 0, 0)
  date.setUTCFullYear(year, month - 1, day)
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.length > 0) return message
  }
  return String(error)
}
