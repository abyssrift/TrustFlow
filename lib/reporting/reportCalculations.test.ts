import { describe, expect, it } from 'vitest'
import {
  computeSuccessRateTrend,
  countOverlappingTeamMembers,
  compareTeamMetric,
  tallyComparisonWins,
  findTopTeamPointLeaders,
  computeTeamSuccessRate,
  computeAverageTeamSuccessRate,
  computeAverageObservedMetric,
  computeRatePercent,
  computeWeightedAverage,
  resolveScopedCompletedTasks,
  sortPeriodsChronologically,
} from './reportCalculations'

describe('report calculations', () => {
  it('sorts newest-first period data into stable chronological order', () => {
    const rows = [
      { period_start: '2025-03-01', id: 'march' },
      { period_start: '2025-01-01', id: 'jan-a' },
      { period_start: '2025-01-01', id: 'jan-b' },
      { period_start: '2025-02-01', id: 'feb' },
    ]

    expect(sortPeriodsChronologically(rows).map(row => row.id)).toEqual([
      'jan-a', 'jan-b', 'feb', 'march',
    ])
    expect(rows[0].id).toBe('march')
  })

  it('puts invalid period dates last and preserves their relative order', () => {
    const rows = [
      { period_start: 'not-a-date', id: 'bad-a' },
      { period_start: '2025-02-01', id: 'feb' },
      { period_start: '', id: 'bad-b' },
      { period_start: '2025-01-01', id: 'jan' },
    ]

    expect(sortPeriodsChronologically(rows).map(row => row.id)).toEqual([
      'jan', 'feb', 'bad-a', 'bad-b',
    ])
  })

  it('computes latest minus earliest success rate in percentage points from raw counts', () => {
    const newestFirst = [
      { period_start: '2025-03-01', tasks_succeeded: 2, tasks_failed: 1, success_rate: 66.7 },
      { period_start: '2025-02-01', tasks_succeeded: 0, tasks_failed: 0, success_rate: null },
      { period_start: '2025-01-01', tasks_succeeded: 1, tasks_failed: 2, success_rate: 33.3 },
    ]

    expect(computeSuccessRateTrend(newestFirst)).toBeCloseTo(100 / 3, 10)
  })

  it('returns no trend unless two valid non-empty periods exist', () => {
    expect(computeSuccessRateTrend([])).toBeNull()
    expect(computeSuccessRateTrend([
      { period_start: '2025-01-01', tasks_succeeded: 0, tasks_failed: 0 },
      { period_start: '2025-02-01', tasks_succeeded: 2, tasks_failed: 1 },
    ])).toBeNull()
    expect(computeSuccessRateTrend([
      { period_start: '2025-01-01', tasks_succeeded: -1, tasks_failed: 0 },
      { period_start: '2025-02-01', tasks_succeeded: 1, tasks_failed: 1 },
    ])).toBeNull()
  })

  it('preserves an explicit zero scoped completion count', () => {
    expect(resolveScopedCompletedTasks(0, 17)).toBe(0)
  })

  it('falls back only when the scoped count is absent', () => {
    expect(resolveScopedCompletedTasks(undefined, 17)).toBe(17)
    expect(resolveScopedCompletedTasks(null, 17)).toBe(17)
    expect(resolveScopedCompletedTasks(3, 17)).toBe(3)
  })

  it('counts distinct users appearing in more than one selected team', () => {
    expect(countOverlappingTeamMembers([
      ['member-a', 'member-b', 'member-a'],
      ['member-b', 'member-c'],
      ['member-b', 'member-d'],
    ])).toBe(1)
  })

  it('returns zero when selected teams have no members in common', () => {
    expect(countOverlappingTeamMembers([['member-a'], ['member-b'], []])).toBe(0)
  })

  it('does not award tied categories to Team A', () => {
    expect(tallyComparisonWins([null, null, null])).toEqual({
      winsA: 0,
      winsB: 0,
      decided: 0,
      winner: null,
    })
  })

  it('counts only decisive categories when choosing a comparison winner', () => {
    expect(tallyComparisonWins([true, false, null, true])).toEqual({
      winsA: 2,
      winsB: 1,
      decided: 3,
      winner: 'a',
    })
  })

  it('leaves equal or invalid team metrics undecided and respects better direction', () => {
    expect(compareTeamMetric(5, 5)).toBeNull()
    expect(compareTeamMetric(5, 5, 'lower')).toBeNull()
    expect(compareTeamMetric(6, 5, 'higher')).toBe(true)
    expect(compareTeamMetric(6, 5, 'lower')).toBe(false)
    expect(compareTeamMetric(Number.NaN, 5)).toBeNull()
    expect(compareTeamMetric(null, 0)).toBeNull()
  })

  it('returns every team tied at the actual maximum points', () => {
    expect(findTopTeamPointLeaders([
      { id: 'a', pts: 18 },
      { id: 'b', pts: 25 },
      { id: 'c', pts: 25 },
      { id: 'd', pts: 10 },
    ])).toEqual({ maxPoints: 25, leaders: [{ id: 'b', pts: 25 }, { id: 'c', pts: 25 }] })
  })

  it('uses the true maximum even when all team points are below one', () => {
    expect(findTopTeamPointLeaders([{ id: 'a', pts: 0 }, { id: 'b', pts: 0 }]))
      .toEqual({ maxPoints: 0, leaders: [{ id: 'a', pts: 0 }, { id: 'b', pts: 0 }] })
    expect(findTopTeamPointLeaders([{ id: 'a', pts: -4 }, { id: 'b', pts: -2 }]))
      .toEqual({ maxPoints: -2, leaders: [{ id: 'b', pts: -2 }] })
    expect(findTopTeamPointLeaders([])).toBeNull()
  })

  it('keeps missing success-rate observations distinct from zero success', () => {
    expect(computeTeamSuccessRate(0, 0)).toBeNull()
    expect(computeTeamSuccessRate(null, 2)).toBeNull()
    expect(computeTeamSuccessRate(-1, 2)).toBeNull()
    expect(computeTeamSuccessRate(0, 3)).toBe(0)
    expect(computeTeamSuccessRate(2, 1)).toBe(67)
  })

  it('averages only teams with observed outcomes and returns null when none exist', () => {
    expect(computeAverageTeamSuccessRate([null, 80, 0])).toBe(40)
    expect(computeAverageTeamSuccessRate([null, null])).toBeNull()
  })

  it('averages nullable performance metrics only across finite observations', () => {
    expect(computeAverageObservedMetric([null, undefined, Number.NaN, 82, 118])).toBe(100)
    expect(computeAverageObservedMetric([null, undefined])).toBeNull()
  })

  it('returns no percentage for an empty or invalid ratio denominator', () => {
    expect(computeRatePercent(0, 0)).toBeNull()
    expect(computeRatePercent(1, 0)).toBeNull()
    expect(computeRatePercent(-1, 2)).toBeNull()
    expect(computeRatePercent(1, 2)).toBe(50)
  })

  it('weights aggregate means by their observation counts', () => {
    expect(computeWeightedAverage([
      { value: 90, weight: 1 },
      { value: 10, weight: 9 },
    ])).toBe(18)
    expect(computeWeightedAverage([
      { value: 90, weight: 0 },
      { value: null, weight: 9 },
    ])).toBeNull()
  })
})
