import { describe, expect, it } from 'vitest'
import {
  metricRatio,
  resolvePreviousCompletedPeriod,
  resolveScheduledOccurrence,
  selectMetricLeaders,
  type ReportPeriod,
  type ReportSnapshot,
} from './reportContracts'
import { normalizeReportTimeframe } from './reportTimeframe'

describe('canonical reporting contracts', () => {
  it('keeps observed zero distinct from an unavailable zero denominator', () => {
    expect(metricRatio(0, 4, 4)).toEqual({
      value: 0, status: 'observed', numerator: 0, denominator: 4, sampleCount: 4, caveat: null,
    })
    expect(metricRatio(0, 0, 0)).toEqual({
      value: null, status: 'not_available', numerator: 0, denominator: 0, sampleCount: 0, caveat: null,
    })
    expect(metricRatio(null, 4)).toMatchObject({ value: null, status: 'not_available' })
  })

  it('does not select a leader for no evidence or an all-zero population', () => {
    expect(selectMetricLeaders([
      { id: 'a', value: null }, { id: 'b', value: 0 }, { id: 'c', value: null },
    ])).toBeNull()
    expect(selectMetricLeaders([
      { id: 'a', value: 8 }, { id: 'b', value: 8 }, { id: 'c', value: 2 },
    ])).toEqual({ maxValue: 8, leaders: [{ id: 'a', value: 8 }, { id: 'b', value: 8 }] })
  })

  it('resolves the previous ISO week at Monday boundaries', () => {
    const result = resolvePreviousCompletedPeriod({
      kind: 'iso_week', asOfUtc: '2024-04-01T00:01:00.000Z', timezone: 'UTC',
    })
    expect(result).toMatchObject({
      key: 'iso_week:2024-03-25', startLocalDate: '2024-03-25', endLocalDateInclusive: '2024-03-31',
    })
  })

  it('resolves previous month and clamps scheduled day 31 to month end', () => {
    const period = resolvePreviousCompletedPeriod({
      kind: 'calendar_month', asOfUtc: '2024-03-01T01:00:00.000Z', timezone: 'UTC',
    })
    expect(period).toMatchObject({ startLocalDate: '2024-02-01', endLocalDateInclusive: '2024-02-29' })
    const occurrence = resolveScheduledOccurrence({
      cadence: 'monthly', targetPeriod: period, timezone: 'UTC', localTime: '06:00', dayOfMonth: 31,
    })
    expect(occurrence).toMatchObject({
      localDate: '2024-03-31', resolvedUtc: '2024-03-31T06:00:00.000Z', dstResolution: 'exact',
    })
  })

  it('resolves the previous quarter across year boundaries', () => {
    const result = resolvePreviousCompletedPeriod({
      kind: 'calendar_quarter', asOfUtc: '2025-01-01T00:01:00.000Z', timezone: 'UTC',
    })
    expect(result).toMatchObject({
      key: 'calendar_quarter:2024-10-01', startLocalDate: '2024-10-01', endLocalDateInclusive: '2024-12-31',
    })
  })

  it('preserves leap-day period bounds', () => {
    const result = resolvePreviousCompletedPeriod({
      kind: 'calendar_month', asOfUtc: '2024-03-01T00:01:00.000Z', timezone: 'UTC',
    })
    expect(result.endLocalDateInclusive).toBe('2024-02-29')
    expect(result.endExclusiveUtc).toBe('2024-03-01T00:00:00.000Z')
  })

  it('moves a nonexistent DST wall time forward to the next valid instant', () => {
    const period = resolvePreviousCompletedPeriod({
      kind: 'calendar_month', asOfUtc: '2024-04-01T05:01:00.000Z', timezone: 'America/New_York',
    })
    const occurrence = resolveScheduledOccurrence({
      cadence: 'monthly', targetPeriod: period, timezone: 'America/New_York', localTime: '02:30', dayOfMonth: 10,
    })
    expect(occurrence).toMatchObject({
      localDate: '2024-04-10', resolvedLocalTime: '02:30', dstResolution: 'exact',
    })

    const february = resolvePreviousCompletedPeriod({
      kind: 'calendar_month', asOfUtc: '2024-03-01T05:01:00.000Z', timezone: 'America/New_York',
    })
    const spring = resolveScheduledOccurrence({
      cadence: 'monthly', targetPeriod: february, timezone: 'America/New_York', localTime: '02:30', dayOfMonth: 10,
    })
    expect(spring).toMatchObject({ localDate: '2024-03-10', resolvedLocalTime: '03:00', dstResolution: 'next_valid' })
  })

  it('uses one earlier occurrence for a repeated DST wall time', () => {
    const period = resolvePreviousCompletedPeriod({
      kind: 'calendar_month', asOfUtc: '2024-12-01T00:01:00.000Z', timezone: 'America/New_York',
    })
    const occurrence = resolveScheduledOccurrence({
      cadence: 'monthly', targetPeriod: period, timezone: 'America/New_York', localTime: '01:30', dayOfMonth: 3,
    })
    expect(occurrence.dstResolution).toBe('earlier_repeated')
    expect(occurrence.resolvedUtc).toBe('2024-11-03T05:30:00.000Z')
  })

  it('keeps the canonical snapshot identical when only presentation profile changes', () => {
    const period = normalizeReportTimeframe('2024-01-01', '2024-01-31', 'UTC')
    expect(period.ok).toBe(true)
    if (!period.ok) return
    const canonicalPeriod: ReportPeriod = {
      ...period.value, kind: 'calendar_month', key: 'calendar_month:2024-01-01',
      startLocalDate: '2024-01-01', endLocalDateInclusive: '2024-01-31',
    }
    const makeSnapshot = (profile: 'manager' | 'analyst'): ReportSnapshot => ({
      schemaVersion: 1, snapshotId: 'snapshot-1', requestId: 'request-1', reportType: 'general',
      scope: { companyId: 'company-1', scopeType: 'company', scopeIds: ['company-1'] }, filters: { team: 'all' },
      period: canonicalPeriod, metrics: {}, sections: [], provenance: {
        tenantFingerprint: 'tenant-fp', scopeFingerprint: 'scope-fp', appliedFilters: { team: 'all' },
        period: canonicalPeriod, dataAsOfUtc: '2024-02-01T00:00:00.000Z', sourceVersions: { rpc: 'v1' },
        rowCount: 0, sampleCount: 0, exclusionCount: 0, completeness: 'complete', missingRequiredSources: [],
      },
    })
    expect(makeSnapshot('manager')).toEqual(makeSnapshot('analyst'))
  })
})
