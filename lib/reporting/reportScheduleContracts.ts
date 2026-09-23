import type { ReportCadence, ScheduledOccurrence } from './reportContracts'

export type ScheduleStatus = 'active' | 'paused' | 'expired'
export type RetryClass = 'transient' | 'authorization' | 'permanent'

export interface ReportScheduleConfig {
  readonly cadence: ReportCadence
  readonly timezone: string
  readonly localTime: string
  readonly weekday?: number
  readonly dayOfMonth?: number
}

export interface ScheduleEntitlement {
  readonly isPro: boolean
  readonly expiresAtUtc: string | null
}

export interface ScheduleAccess {
  readonly canManage: boolean
  readonly canTrigger: boolean
  readonly canView: boolean
  readonly sameTenant: boolean
}

export interface RecipientAccess {
  readonly userId: string
  readonly sameTenant: boolean
  readonly active: boolean
  readonly canView: boolean
}

export interface ScheduleRunDecision {
  readonly allowed: boolean
  readonly reason: 'allowed' | 'paused' | 'expired' | 'not_pro' | 'not_authorized' | 'not_viewable'
  readonly createBacklog: boolean
}

export interface RetryDecision {
  readonly retry: boolean
  readonly attempt: number
  readonly delaySeconds: number
}

export interface ProtectedReportNotification {
  readonly type: 'report.schedule.succeeded' | 'report.schedule.failed' | 'report.schedule.paused'
  readonly recipientId: string
  readonly protectedPath: string
  readonly attachment: null
  readonly payload: Readonly<Record<string, string>>
}

export interface CalendarMarkerVisibility {
  readonly visible: boolean
  readonly marker: 'report_schedule' | null
}

const MAX_RETRY_ATTEMPTS = 3
const MAX_RETRY_DELAY_SECONDS = 15 * 60

export function validateScheduleConfig(config: ReportScheduleConfig): string[] {
  const errors: string[] = []
  if (!['weekly', 'monthly', 'quarterly'].includes(config.cadence)) errors.push('unsupported cadence')
  if (!/^\d{2}:\d{2}$/.test(config.localTime)) errors.push('localTime must use HH:mm')
  else {
    const [hour, minute] = config.localTime.split(':').map(Number)
    if (hour > 23 || minute > 59) errors.push('localTime must use HH:mm')
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: config.timezone }).format()
  } catch {
    errors.push('timezone must be a valid IANA timezone')
  }
  if (config.cadence === 'weekly' && (!Number.isInteger(config.weekday) || config.weekday! < 1 || config.weekday! > 7)) {
    errors.push('weekday must be 1 through 7')
  }
  if (config.cadence !== 'weekly' && (!Number.isInteger(config.dayOfMonth) || config.dayOfMonth! < 1 || config.dayOfMonth! > 31)) {
    errors.push('dayOfMonth must be 1 through 31')
  }
  return errors
}

export function decideScheduleRun(
  status: ScheduleStatus,
  entitlement: ScheduleEntitlement,
  access: ScheduleAccess,
  nowUtc: string,
): ScheduleRunDecision {
  if (status !== 'active') return { allowed: false, reason: 'paused', createBacklog: false }
  if (!entitlement.isPro) return { allowed: false, reason: 'not_pro', createBacklog: false }
  if (entitlement.expiresAtUtc !== null && Date.parse(nowUtc) >= Date.parse(entitlement.expiresAtUtc)) {
    return { allowed: false, reason: 'expired', createBacklog: false }
  }
  if (!access.sameTenant || !access.canTrigger) return { allowed: false, reason: 'not_authorized', createBacklog: false }
  if (!access.canView) return { allowed: false, reason: 'not_viewable', createBacklog: false }
  return { allowed: true, reason: 'allowed', createBacklog: false }
}

export function retryDecision(attempt: number, kind: RetryClass): RetryDecision {
  if (kind !== 'transient' || !Number.isInteger(attempt) || attempt < 0 || attempt >= MAX_RETRY_ATTEMPTS) {
    return { retry: false, attempt, delaySeconds: 0 }
  }
  return {
    retry: true,
    attempt: attempt + 1,
    delaySeconds: Math.min(2 ** attempt * 60, MAX_RETRY_DELAY_SECONDS),
  }
}

export function authorizedRecipients(recipients: readonly RecipientAccess[]): string[] {
  return recipients.filter(recipient => recipient.sameTenant && recipient.active && recipient.canView).map(recipient => recipient.userId)
}

export function buildProtectedReportNotification(
  type: ProtectedReportNotification['type'],
  recipientId: string,
  protectedPath: string,
  payload: Readonly<Record<string, string>>,
): ProtectedReportNotification {
  if (!protectedPath.startsWith('/reports/')) throw new Error('protectedPath must be an in-app report path')
  return { type, recipientId, protectedPath, attachment: null, payload }
}

export function calendarMarkerVisibility(
  status: ScheduleStatus,
  access: Pick<ScheduleAccess, 'sameTenant' | 'canView'>,
): CalendarMarkerVisibility {
  return status === 'active' && access.sameTenant && access.canView
    ? { visible: true, marker: 'report_schedule' }
    : { visible: false, marker: null }
}

export function occurrenceIsIdempotent(a: ScheduledOccurrence, b: ScheduledOccurrence): boolean {
  return a.occurrenceKey === b.occurrenceKey
}
