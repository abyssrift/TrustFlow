export type ReportTimeframeErrorCode =
  | 'INVALID_DATE'
  | 'INVALID_TIMEZONE'
  | 'REVERSED_RANGE'
  | 'NONEXISTENT_DATE'

export interface ReportTimeframe {
  timezone: string
  startInclusiveUtc: string
  endExclusiveUtc: string
  endInclusiveUtc: string
  daysInclusive: number
}

export type NormalizeReportTimeframeResult =
  | { ok: true; value: ReportTimeframe }
  | { ok: false; error: { code: ReportTimeframeErrorCode; message: string } }

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

/** Normalize inclusive local calendar dates into UTC query bounds. */
export function normalizeReportTimeframe(
  startDate: string,
  endDate: string,
  timezone: string,
): NormalizeReportTimeframeResult {
  const startParts = parseDate(startDate)
  const endParts = parseDate(endDate)
  if (!startParts || !endParts) {
    return failure('INVALID_DATE', 'Dates must be valid calendar dates in YYYY-MM-DD format.')
  }

  let formatter: Intl.DateTimeFormat
  try {
    formatter = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hourCycle: 'h23',
    })
  } catch {
    return failure('INVALID_TIMEZONE', 'Timezone must be a valid IANA timezone.')
  }

  const startDay = utcDayNumber(startParts)
  const endDay = utcDayNumber(endParts)
  if (startDay > endDay) {
    return failure('REVERSED_RANGE', 'Start date must be on or before end date.')
  }

  const nextDate = dateFromDayNumber(endDay + 1)
  const start = firstInstantOfDate(startDate, startDay, formatter)
  const endExclusive = firstInstantOfDate(formatDate(nextDate), endDay + 1, formatter)
  if (start === null || endExclusive === null) {
    return failure('NONEXISTENT_DATE', 'A selected calendar date does not exist in this timezone.')
  }

  return {
    ok: true,
    value: {
      timezone,
      startInclusiveUtc: new Date(start).toISOString(),
      endExclusiveUtc: new Date(endExclusive).toISOString(),
      endInclusiveUtc: new Date(endExclusive - 1).toISOString().replace(/\.\d{3}Z$/, '.999999Z'),
      daysInclusive: endDay - startDay + 1,
    },
  }
}

function failure(
  code: ReportTimeframeErrorCode,
  message: string,
): NormalizeReportTimeframeResult {
  return { ok: false, error: { code, message } }
}

function parseDate(value: string): [number, number, number] | null {
  const match = DATE_PATTERN.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year < 1 || month < 1 || month > 12 || day < 1) return null

  const date = new Date(0)
  date.setUTCHours(0, 0, 0, 0)
  date.setUTCFullYear(year, month - 1, day)
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null
  }
  return [year, month, day]
}

function utcDayNumber([year, month, day]: [number, number, number]): number {
  const date = new Date(0)
  date.setUTCHours(0, 0, 0, 0)
  date.setUTCFullYear(year, month - 1, day)
  return date.getTime() / DAY_MS
}

function dateFromDayNumber(dayNumber: number): [number, number, number] {
  const date = new Date(dayNumber * DAY_MS)
  return [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()]
}

function formatDate([year, month, day]: [number, number, number]): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function localDateAt(timestamp: number, formatter: Intl.DateTimeFormat): string {
  const parts = formatter.formatToParts(timestamp)
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? ''
  return `${get('year').padStart(4, '0')}-${get('month')}-${get('day')}`
}

function firstInstantOfDate(
  date: string,
  utcDay: number,
  formatter: Intl.DateTimeFormat,
): number | null {
  // Timezone offsets can place local midnight on the previous or following UTC date.
  // Search a wide window, then narrow the first boundary to millisecond precision.
  const lowerBound = (utcDay - 3) * DAY_MS
  const upperBound = (utcDay + 4) * DAY_MS
  let previous = lowerBound
  for (let current = lowerBound + HOUR_MS; current <= upperBound; current += HOUR_MS) {
    if (localDateAt(current, formatter) === date) {
      let low = previous
      let high = current
      while (high - low > 1) {
        const middle = Math.floor((low + high) / 2)
        if (localDateAt(middle, formatter) >= date) high = middle
        else low = middle
      }
      return localDateAt(high, formatter) === date ? high : null
    }
    previous = current
  }
  return null
}
