import { describe, expect, it } from 'vitest'
import { resolvePreviousCompletedPeriod, resolveScheduledOccurrence } from './reportContracts'
import {
  authorizedRecipients,
  buildProtectedReportNotification,
  calendarMarkerVisibility,
  decideScheduleRun,
  occurrenceIsIdempotent,
  retryDecision,
  validateScheduleConfig,
} from './reportScheduleContracts'

describe('report schedule contracts', () => {
  it('validates cadence, IANA timezone, and run-day contracts', () => {
    expect(validateScheduleConfig({ cadence: 'weekly', timezone: 'UTC', localTime: '06:00', weekday: 1 })).toEqual([])
    expect(validateScheduleConfig({ cadence: 'monthly', timezone: 'UTC', localTime: '06:00', dayOfMonth: 31 })).toEqual([])
    expect(validateScheduleConfig({ cadence: 'monthly', timezone: 'not/a-zone', localTime: '06:00', dayOfMonth: 31 })).toContain('timezone must be a valid IANA timezone')
    expect(validateScheduleConfig({ cadence: 'weekly', timezone: 'UTC', localTime: '06:00', weekday: 8 })).toContain('weekday must be 1 through 7')
  })

  it('covers previous week/month/quarter and month-end clamping', () => {
    const week = resolvePreviousCompletedPeriod({ kind: 'iso_week', asOfUtc: '2026-09-23T10:00:00Z', timezone: 'UTC' })
    expect(week.startLocalDate).toBe('2026-09-14')
    const month = resolvePreviousCompletedPeriod({ kind: 'calendar_month', asOfUtc: '2026-03-01T00:01:00Z', timezone: 'UTC' })
    const monthly = resolveScheduledOccurrence({ cadence: 'monthly', targetPeriod: month, timezone: 'UTC', localTime: '06:00', dayOfMonth: 31 })
    expect(monthly.localDate).toBe('2026-03-31')
    const quarter = resolvePreviousCompletedPeriod({ kind: 'calendar_quarter', asOfUtc: '2026-01-01T00:01:00Z', timezone: 'UTC' })
    const quarterly = resolveScheduledOccurrence({ cadence: 'quarterly', targetPeriod: quarter, timezone: 'UTC', localTime: '06:00', dayOfMonth: 31 })
    expect(quarterly.localDate).toBe('2026-01-31')
  })

  it('uses the canonical DST policy and one occurrence key for concurrent attempts', () => {
    const period = resolvePreviousCompletedPeriod({ kind: 'calendar_month', asOfUtc: '2024-03-01T05:01:00Z', timezone: 'America/New_York' })
    const first = resolveScheduledOccurrence({ cadence: 'monthly', targetPeriod: period, timezone: 'America/New_York', localTime: '02:30', dayOfMonth: 10 })
    const second = resolveScheduledOccurrence({ cadence: 'monthly', targetPeriod: period, timezone: 'America/New_York', localTime: '02:30', dayOfMonth: 10 })
    expect(first.dstResolution).toBe('next_valid')
    expect(occurrenceIsIdempotent(first, second)).toBe(true)
  })

  it('requires Pro and current trigger/view authorization, with no entitlement backlog', () => {
    expect(decideScheduleRun('active', { isPro: false, expiresAtUtc: null }, { canManage: true, canTrigger: true, canView: true, sameTenant: true }, '2026-09-23T00:00:00Z')).toMatchObject({ allowed: false, reason: 'not_pro', createBacklog: false })
    expect(decideScheduleRun('active', { isPro: true, expiresAtUtc: '2026-09-01T00:00:00Z' }, { canManage: true, canTrigger: true, canView: true, sameTenant: true }, '2026-09-23T00:00:00Z')).toMatchObject({ allowed: false, reason: 'expired', createBacklog: false })
    expect(decideScheduleRun('active', { isPro: true, expiresAtUtc: null }, { canManage: true, canTrigger: false, canView: true, sameTenant: true }, '2026-09-23T00:00:00Z')).toMatchObject({ allowed: false, reason: 'not_authorized' })
  })

  it('bounds transient retries and never retries authorization/permanent failures', () => {
    expect(retryDecision(0, 'transient')).toEqual({ retry: true, attempt: 1, delaySeconds: 60 })
    expect(retryDecision(2, 'transient')).toEqual({ retry: true, attempt: 3, delaySeconds: 240 })
    expect(retryDecision(3, 'transient').retry).toBe(false)
    expect(retryDecision(0, 'authorization').retry).toBe(false)
  })

  it('rechecks recipients and calendar visibility, and never attaches PDFs', () => {
    expect(authorizedRecipients([
      { userId: 'same-active-viewer', sameTenant: true, active: true, canView: true },
      { userId: 'revoked', sameTenant: true, active: false, canView: true },
      { userId: 'foreign', sameTenant: false, active: true, canView: true },
    ])).toEqual(['same-active-viewer'])
    expect(calendarMarkerVisibility('active', { sameTenant: true, canView: true })).toEqual({ visible: true, marker: 'report_schedule' })
    expect(calendarMarkerVisibility('active', { sameTenant: true, canView: false })).toEqual({ visible: false, marker: null })
    expect(buildProtectedReportNotification('report.schedule.succeeded', 'same-active-viewer', '/reports/run-1', { period: '2026-08' })).toMatchObject({ attachment: null, protectedPath: '/reports/run-1' })
  })
})
