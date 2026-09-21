export interface PeriodCounts {
  period_start?: string | null
  tasks_succeeded?: number | null
  tasks_failed?: number | null
}

export function sortPeriodsChronologically<T extends { period_start?: string | null }>(
  rows: readonly T[],
): T[] {
  return rows
    .map((row, index) => ({ row, index, time: validPeriodTime(row.period_start) }))
    .sort((a, b) => {
      if (a.time === null && b.time !== null) return 1
      if (a.time !== null && b.time === null) return -1
      if (a.time !== null && b.time !== null && a.time !== b.time) return a.time - b.time
      return a.index - b.index
    })
    .map(({ row }) => row)
}

export function computeSuccessRateTrend(rows: readonly PeriodCounts[]): number | null {
  const rates = sortPeriodsChronologically(rows).flatMap(row => {
    const succeeded = row.tasks_succeeded
    const failed = row.tasks_failed
    const time = validPeriodTime(row.period_start)
    if (time === null || !Number.isFinite(succeeded) || !Number.isFinite(failed)) return []
    if ((succeeded as number) < 0 || (failed as number) < 0) return []

    const total = (succeeded as number) + (failed as number)
    if (total <= 0) return []
    return [((succeeded as number) / total) * 100]
  })

  if (rates.length < 2) return null
  return rates[rates.length - 1] - rates[0]
}

export function resolveScopedCompletedTasks(
  scopedCompleted: number | null | undefined,
  fallbackCompleted: number,
): number {
  return scopedCompleted ?? fallbackCompleted
}

export function countOverlappingTeamMembers(teamMemberIds: readonly (readonly string[])[]): number {
  const teamCountByMember = new Map<string, number>()
  for (const teamMemberIdsForTeam of teamMemberIds) {
    for (const memberId of new Set(teamMemberIdsForTeam.filter(Boolean))) {
      teamCountByMember.set(memberId, (teamCountByMember.get(memberId) ?? 0) + 1)
    }
  }
  return [...teamCountByMember.values()].filter(teamCount => teamCount > 1).length
}

export function computeTeamSuccessRate(
  completed: number | null | undefined,
  failed: number | null | undefined,
): number | null {
  if (!Number.isFinite(completed) || !Number.isFinite(failed)) return null
  if ((completed as number) < 0 || (failed as number) < 0) return null
  const total = (completed as number) + (failed as number)
  if (total === 0) return null
  return Math.round(((completed as number) / total) * 100)
}

export function computeAverageTeamSuccessRate(rates: readonly (number | null)[]): number | null {
  const observed = rates.filter((rate): rate is number => typeof rate === 'number' && Number.isFinite(rate) && rate >= 0 && rate <= 100)
  if (observed.length === 0) return null
  return observed.reduce((sum, rate) => sum + rate, 0) / observed.length
}

export function computeAverageObservedMetric(values: readonly (number | null | undefined)[]): number | null {
  const observed = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  if (observed.length === 0) return null
  return observed.reduce((sum, value) => sum + value, 0) / observed.length
}

export function computeRatePercent(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null
  if (numerator < 0 || denominator <= 0 || numerator > denominator) return null
  return Math.round((numerator / denominator) * 100)
}

export function computeWeightedAverage(
  observations: readonly { value: number | null | undefined; weight: number | null | undefined }[],
): number | null {
  let weightedTotal = 0
  let totalWeight = 0
  for (const { value, weight } of observations) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0) continue
    weightedTotal += value * weight
    totalWeight += weight
  }
  if (totalWeight <= 0 || !Number.isFinite(weightedTotal)) return null
  return weightedTotal / totalWeight
}

export function compareTeamMetric(a: number | null, b: number | null, better: 'higher' | 'lower' = 'higher'): boolean | null {
  if (a === null || b === null || !Number.isFinite(a) || !Number.isFinite(b) || a === b) return null
  return better === 'higher' ? a > b : a < b
}

export function tallyComparisonWins(results: readonly (boolean | null)[]) {
  const winsA = results.filter(result => result === true).length
  const winsB = results.filter(result => result === false).length
  const decided = winsA + winsB
  return {
    winsA,
    winsB,
    decided,
    winner: winsA > winsB ? 'a' as const : winsB > winsA ? 'b' as const : null,
  }
}

export function findTopTeamPointLeaders<T extends { pts: number }>(teams: readonly T[]): { maxPoints: number; leaders: T[] } | null {
  if (teams.length === 0) return null

  const maxPoints = Math.max(...teams.map(team => team.pts))
  return {
    maxPoints,
    leaders: teams.filter(team => team.pts === maxPoints),
  }
}

function validPeriodTime(value: string | null | undefined): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const time = Date.parse(`${value}T00:00:00Z`)
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) return null
  return time
}
