import { describe, expect, it } from 'vitest'
import { normalizeReportTimeframe } from './reportTimeframe'

describe('normalizeReportTimeframe', () => {
  it('normalizes a UTC single day to inclusive and exclusive UTC bounds', () => {
    expect(normalizeReportTimeframe('2024-01-15', '2024-01-15', 'UTC')).toEqual({
      ok: true,
      value: {
        timezone: 'UTC',
        startInclusiveUtc: '2024-01-15T00:00:00.000Z',
        endExclusiveUtc: '2024-01-16T00:00:00.000Z',
        endInclusiveUtc: '2024-01-15T23:59:59.999999Z',
        daysInclusive: 1,
      },
    })
  })

  it('uses 23 elapsed hours for a New York spring-forward day', () => {
    const result = normalizeReportTimeframe('2024-03-10', '2024-03-10', 'America/New_York')
    expect(result).toEqual({
      ok: true,
      value: {
        timezone: 'America/New_York',
        startInclusiveUtc: '2024-03-10T05:00:00.000Z',
        endExclusiveUtc: '2024-03-11T04:00:00.000Z',
        endInclusiveUtc: '2024-03-11T03:59:59.999999Z',
        daysInclusive: 1,
      },
    })
    if (result.ok) {
      expect(Date.parse(result.value.endExclusiveUtc) - Date.parse(result.value.startInclusiveUtc))
        .toBe(23 * 60 * 60 * 1000)
    }
  })

  it('uses 25 elapsed hours for a New York fall-back day', () => {
    const result = normalizeReportTimeframe('2024-11-03', '2024-11-03', 'America/New_York')
    expect(result).toEqual({
      ok: true,
      value: {
        timezone: 'America/New_York',
        startInclusiveUtc: '2024-11-03T04:00:00.000Z',
        endExclusiveUtc: '2024-11-04T05:00:00.000Z',
        endInclusiveUtc: '2024-11-04T04:59:59.999999Z',
        daysInclusive: 1,
      },
    })
    if (result.ok) {
      expect(Date.parse(result.value.endExclusiveUtc) - Date.parse(result.value.startInclusiveUtc))
        .toBe(25 * 60 * 60 * 1000)
    }
  })

  it('accepts leap day and counts calendar days across leap day', () => {
    expect(normalizeReportTimeframe('2024-02-28', '2024-03-01', 'UTC')).toMatchObject({
      ok: true,
      value: { daysInclusive: 3, startInclusiveUtc: '2024-02-28T00:00:00.000Z' },
    })
  })

  it('normalizes a Cairo local day across the UTC date boundary', () => {
    expect(normalizeReportTimeframe('2024-01-15', '2024-01-15', 'Africa/Cairo')).toMatchObject({
      ok: true,
      value: {
        startInclusiveUtc: '2024-01-14T22:00:00.000Z',
        endExclusiveUtc: '2024-01-15T22:00:00.000Z',
        daysInclusive: 1,
      },
    })
  })

  it('counts inclusive calendar dates across a year boundary', () => {
    expect(normalizeReportTimeframe('2023-12-31', '2024-01-01', 'UTC')).toMatchObject({
      ok: true,
      value: { daysInclusive: 2, endExclusiveUtc: '2024-01-02T00:00:00.000Z' },
    })
  })

  it.each(['2024-2-01', '2024-02-30', 'not-a-date'])('rejects malformed or nonexistent date %s', date => {
    expect(normalizeReportTimeframe(date, '2024-03-01', 'UTC')).toMatchObject({
      ok: false,
      error: { code: 'INVALID_DATE' },
    })
  })

  it('rejects a reversed range', () => {
    expect(normalizeReportTimeframe('2024-03-02', '2024-03-01', 'UTC')).toMatchObject({
      ok: false,
      error: { code: 'REVERSED_RANGE' },
    })
  })

  it('rejects an invalid timezone', () => {
    expect(normalizeReportTimeframe('2024-03-01', '2024-03-01', 'Mars/Olympus')).toMatchObject({
      ok: false,
      error: { code: 'INVALID_TIMEZONE' },
    })
  })

  it('rejects a civil date skipped by a timezone date-line transition', () => {
    expect(normalizeReportTimeframe('2011-12-30', '2011-12-30', 'Pacific/Apia')).toMatchObject({
      ok: false,
      error: { code: 'NONEXISTENT_DATE' },
    })
  })

  it('formats the inclusive end at microsecond precision and counts local dates', () => {
    expect(normalizeReportTimeframe('2024-03-09', '2024-03-11', 'America/New_York')).toMatchObject({
      ok: true,
      value: {
        endExclusiveUtc: '2024-03-12T04:00:00.000Z',
        endInclusiveUtc: '2024-03-12T03:59:59.999999Z',
        daysInclusive: 3,
      },
    })
  })
})
