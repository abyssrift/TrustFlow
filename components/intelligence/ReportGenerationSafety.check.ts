import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const adaptive = readFileSync(resolve('components/intelligence/_ReportGenerator_adaptive.tsx'), 'utf8')
const handlerStart = adaptive.indexOf('const handleGenerateReport = async () => {')
const requestStart = adaptive.indexOf("supabase.rpc('rpc_request_report'", handlerStart)
assert.ok(handlerStart >= 0 && requestStart > handlerStart)
const handler = adaptive.slice(handlerStart, requestStart)
const nativeGuard = handler.indexOf("Platform.OS !== 'web'")
assert.ok(nativeGuard >= 0, 'adaptive generation must reject native clients')
assert.ok(nativeGuard < handler.indexOf('const expanded = expandJobs('), 'native guard must run before job expansion')
assert.match(handler.slice(nativeGuard), /setGenError\([\s\S]*?return/)

const generator = readFileSync(resolve('components/intelligence/reports/generate.ts'), 'utf8')
const teamFetcher = generator.slice(
  generator.indexOf('async function fetchTeamComparison'),
  generator.indexOf('async function fetchUserSeries'),
)
for (const source of ['teams', 'team_members', 'task_participants', 'tasks', 'task_work_sessions']) {
  assert.ok(
    teamFetcher.includes(`requireReportQueryData('${source}'`) ||
    teamFetcher.includes(`requireReportQueryData(\`${source}`) ||
    teamFetcher.includes(`requireCompleteReportRows('${source}'`) ||
    teamFetcher.includes(`requireCompleteReportRows(\`${source}`),
    `${source} errors must fail the report`,
  )
}
assert.match(teamFetcher, /sumValidatedSessionHours\(/)

for (const helper of ['getCompanyName', 'getWorkerName', 'getPipelineName']) {
  const start = generator.indexOf(`async function ${helper}`)
  const next = generator.indexOf('\nasync function ', start + 1)
  assert.ok(start >= 0 && next > start, `${helper} helper must be present`)
  assert.match(generator.slice(start, next), /requireReportQueryData\(/, `${helper} must fail closed on query errors`)
}

const pulseFetcher = generator.slice(generator.indexOf('async function fetchPersonalPulse'), generator.indexOf('async function fetchProjects'))
assert.match(pulseFetcher, /count, error: partsError/)
assert.match(pulseFetcher, /requireReportCount\('Personal pulse task count'/)
assert.doesNotMatch(pulseFetcher, /taskCount[\s\S]*\?\? 0/)
assert.match(pulseFetcher, /taskCount,/)

const projectFetcher = generator.slice(generator.indexOf('async function fetchProjects'), generator.indexOf('function isModuleEmpty'))
assert.match(projectFetcher, /requireReportQueryData\('Project pipelines'/)
assert.match(projectFetcher, /requireReportQueryData\('Project date-scoped tasks'/)

const teamReport = readFileSync(resolve('components/intelligence/reports/TeamComparisonReport.tsx'), 'utf8')
const personnelReport = readFileSync(resolve('components/intelligence/reports/PersonnelReport.tsx'), 'utf8')
const targetsReport = readFileSync(resolve('components/intelligence/reports/TargetsReport.tsx'), 'utf8')
const workerComparisonReport = readFileSync(resolve('components/intelligence/reports/WorkerComparisonReport.tsx'), 'utf8')
const stageDwellReport = readFileSync(resolve('components/intelligence/reports/StageDwellReport.tsx'), 'utf8')
const userSummaryReport = readFileSync(resolve('components/intelligence/reports/UserSummaryReport.tsx'), 'utf8')
const teamComparisonFetcher = generator.slice(generator.indexOf('async function fetchTeamComparison'), generator.indexOf('async function fetchUserSeries'))
assert.match(teamComparisonFetcher, /countOverlappingTeamMembers\(memberIdsByTeam\)/)
assert.match(teamComparisonFetcher, /teamIds = \[\.\.\.new Set\(teamIds\)\]/)
assert.equal((teamComparisonFetcher.match(/count: 'exact'/g) || []).length, 6, 'all paginated team report reads must request exact counts')
assert.equal((teamComparisonFetcher.match(/\.range\(0, REPORT_QUERY_MAX_ROWS - 1\)/g) || []).length, 6, 'team report reads must expose and detect the configured response cap')
assert.equal((teamComparisonFetcher.match(/requireCompleteReportRows\(/g) || []).length, 6, 'team report reads must reject capped responses')
assert.match(teamComparisonFetcher, /requireCompleteReportRows\('teams'[\s\S]*?teamIds\.length\)/, 'every requested team must be visible to the caller')
assert.match(teamComparisonFetcher, /from\('team_members'\)[\s\S]*?\.is\('removed_at', null\)/, 'former team members must not count in current team metrics')
assert.match(teamReport, /overlappingMemberCount/)
assert.match(teamReport, /Their activity is included in each team's totals/)
assert.equal((teamReport.match(/overlapNote && <Insight/g) || []).length, 2, 'both team-comparison layouts must disclose overlap')
assert.match(teamReport, /compareTeamMetric\(tA\.completed, tB\.completed\)/)
assert.match(teamReport, /compareTeamMetric\(tA\.failed, tB\.failed, 'lower'\)/)
assert.match(teamReport, /tallyComparisonWins\(rows\.map\(row => row\.winA\)\)/)
assert.match(teamReport, /findTopTeamPointLeaders\(teams\)/)
assert.match(teamReport, /teams tie for the lead/)
assert.match(teamReport, /computeTeamSuccessRate\(t\.completed, t\.failed\)/)
assert.match(teamReport, /computeAverageTeamSuccessRate\(teams\.map\(ar\)\)/)
assert.match(teamReport, /no task outcomes/)
assert.match(teamReport, /avgAr === null \? 'N\/A'/)
assert.match(personnelReport, /computeAverageObservedMetric\(rows\.map\(r => r\.on_time_rate\)\)/)
assert.match(personnelReport, /computeAverageObservedMetric\(rows\.map\(r => r\.timer_efficiency\)\)/)
assert.match(personnelReport, /avgOtr === null \? 'N\/A'/)
assert.match(personnelReport, /avgEff === null \? 'N\/A'/)
assert.match(personnelReport, /formatPercent\(r\.on_time_rate\)/)
assert.match(personnelReport, /findTopTeamPointLeaders\(/, 'Personnel report must compute all tied leaders')
assert.match(personnelReport, /people tie for the lead/, 'Personnel report must disclose tied top performers')
assert.match(targetsReport, /computeRatePercent\(hit\.length, targets\.length\)/)
assert.match(targetsReport, /hitRate === null \? 'N\/A'/)
assert.match(workerComparisonReport, /compareTeamMetric\(/, 'worker head-to-head scoring must leave ties undecided')
assert.match(workerComparisonReport, /tallyComparisonWins\(/, 'worker win totals must count only decisive categories')
assert.match(workerComparisonReport, /findTopTeamPointLeaders\(workers\.map/)
assert.match(workerComparisonReport, /computeAverageObservedMetric\(workers\.map\(w => w\.on_time_rate\)\)/)
assert.match(workerComparisonReport, /people tie for the lead/)
assert.match(stageDwellReport, /computeWeightedAverage\(rows\.map\(r => \(\{ value: r\.avg_seconds, weight: r\.sample_count \}\)\)\)/)
assert.match(stageDwellReport, /avgDwell === null \? 'N\/A'/)
assert.match(userSummaryReport, /computeTeamSuccessRate\(summary\.completed_tasks, summary\.failed_tasks\)/)
assert.match(userSummaryReport, /typeof summary\.timer_efficiency === 'number'/)
assert.match(userSummaryReport, /No task outcomes available/)

const signedUrl = generator.slice(generator.indexOf("createSignedUrl(path"), generator.indexOf('\n\n  } catch', generator.indexOf("createSignedUrl(path")))
assert.match(signedUrl, /error/)
assert.match(signedUrl, /if \(!signedUrl\)/)
assert.ok(signedUrl.indexOf('createSignedUrl') < signedUrl.indexOf("status: 'completed'"), 'signed URL must exist before marking report complete')
assert.match(signedUrl, /requireReportMutationRow\('Report completion status update'/)
assert.match(signedUrl, /select\('id'\)\.maybeSingle\(\)/)

const failureHandler = generator.slice(generator.indexOf('  } catch (err: any) {', generator.indexOf('export async function generateAndUploadReport')))
assert.match(failureHandler, /requireReportMutationRow\('Report failure status update'/)
assert.match(failureHandler, /Failed status could not be persisted/)
