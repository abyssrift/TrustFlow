import { describe, expect, it } from 'vitest'
import { requireCompleteReportRows, requireReportCount, requireReportMutationRow, requireReportQueryData, sumValidatedSessionHours } from './reportData'

describe('requireReportQueryData', () => {
  it('returns null when a query succeeds with an empty result', () => {
    expect(requireReportQueryData('sessions', { data: null, error: null })).toBeNull()
  })

  it('throws an error with query context when the query fails', () => {
    expect(() => requireReportQueryData('sessions', {
      data: [{ id: 'ignored' }],
      error: new Error('database unavailable'),
    })).toThrow('sessions query failed: database unavailable')
  })

  it('preserves Supabase error messages from plain error objects', () => {
    expect(() => requireReportQueryData('sessions', {
      data: null,
      error: { message: 'permission denied' },
    })).toThrow('sessions query failed: permission denied')
  })

  it('preserves a legitimate zero count and rejects a failed count query', () => {
    expect(requireReportCount('Personal pulse task count', { data: 0, error: null })).toBe(0)
    expect(requireReportCount('Personal pulse task count', { data: 17, error: null })).toBe(17)
    expect(() => requireReportQueryData('Personal pulse task count', {
      data: null,
      error: { message: 'permission denied' },
    })).toThrow('Personal pulse task count query failed: permission denied')
  })

  it('rejects a missing or invalid count instead of presenting a false zero', () => {
    expect(() => requireReportCount('Personal pulse task count', { data: null, error: null }))
      .toThrow('Personal pulse task count query returned an invalid count')
    expect(() => requireReportCount('Personal pulse task count', { data: -1, error: null }))
      .toThrow('Personal pulse task count query returned an invalid count')
  })
})

describe('requireReportMutationRow', () => {
  it('returns the updated row and rejects errors or zero-row updates', () => {
    expect(requireReportMutationRow('Report completion', { data: { id: 'job-1' }, error: null }))
      .toEqual({ id: 'job-1' })
    expect(() => requireReportMutationRow('Report completion', { data: null, error: null }))
      .toThrow('Report completion did not update a row')
    expect(() => requireReportMutationRow('Report completion', { data: null, error: new Error('database unavailable') }))
      .toThrow('Report completion query failed: database unavailable')
  })
})

describe('requireCompleteReportRows', () => {
  it('returns rows when exact count matches the complete response', () => {
    expect(requireCompleteReportRows('team members', {
      data: [{ id: 'a' }, { id: 'b' }], count: 2, error: null,
    })).toEqual([{ id: 'a' }, { id: 'b' }])
  })

  it('rejects a response capped below its exact count instead of undercounting', () => {
    expect(() => requireCompleteReportRows('team participants', {
      data: [{ id: 'a' }, { id: 'b' }], count: 3, error: null,
    })).toThrow('team participants query returned 2 of 3 rows; report is incomplete')
  })

  it('preserves empty results and fails closed when the exact count is missing', () => {
    expect(requireCompleteReportRows('team members', { data: null, count: 0, error: null })).toEqual([])
    expect(() => requireCompleteReportRows('team members', { data: [], count: null, error: null }))
      .toThrow('team members query returned an invalid exact count')
  })

  it('rejects a valid empty response when selected team IDs were not returned', () => {
    expect(() => requireCompleteReportRows('selected teams', {
      data: [], count: 0, error: null,
    }, 1)).toThrow('selected teams query did not resolve all requested rows')
  })
})

describe('sumValidatedSessionHours', () => {
  it('sums session durations in hours', () => {
    expect(sumValidatedSessionHours([
      { started_at: '2025-01-01T00:00:00.000Z', last_heartbeat_at: '2025-01-01T01:30:00.000Z' },
      { started_at: '2025-01-02T00:00:00.000Z', last_heartbeat_at: '2025-01-02T00:30:00.000Z' },
    ])).toBe(2)
  })

  it.each([
    ['invalid', 'not-a-date'],
    ['malformed', '2025'],
    ['missing', undefined],
  ])('rejects a %s session timestamp', (_kind, startedAt) => {
    expect(() => sumValidatedSessionHours([
      { started_at: startedAt, last_heartbeat_at: '2025-01-01T01:00:00.000Z' },
    ])).toThrow('row 1 has an invalid started_at timestamp')
  })

  it('rejects a session whose end precedes its start', () => {
    expect(() => sumValidatedSessionHours([
      { started_at: '2025-01-01T02:00:00.000Z', last_heartbeat_at: '2025-01-01T01:00:00.000Z' },
    ])).toThrow('row 1 ends before it starts')
  })
})
