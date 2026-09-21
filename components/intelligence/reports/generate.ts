import { Document, Page, pdf } from '@react-pdf/renderer'
import { SupabaseClient } from '@supabase/supabase-js'
import React from 'react'
import { countOverlappingTeamMembers, resolveScopedCompletedTasks } from '@/lib/reporting/reportCalculations'
import { requireCompleteReportRows, requireReportCount, requireReportMutationRow, requireReportQueryData, sumValidatedSessionHours } from '@/lib/reporting/reportData'

import { GeneralData, GeneralReport, GeneralReportPages, computeGeneralInsights } from './GeneralReport'
import { PersonalPulseData, PersonalPulseReport, PersonalPulseReportPages } from './PersonalPulseReport'
import { PersonnelData, PersonnelReport, PersonnelReportPages } from './PersonnelReport'
import { ProjectsData, ProjectsReport, ProjectsReportPages, ProjectRow, computeProjectsInsights } from './ProjectsReport'
import { Footer, Insight, Section, fmtDate } from './shared'
import { StageDwellData, StageDwellReport, StageDwellReportPages } from './StageDwellReport'
import { TargetsData, TargetsReport, TargetsReportPages } from './TargetsReport'
import { TeamComparisonData, TeamComparisonReport, TeamComparisonReportPages } from './TeamComparisonReport'
import { C, base } from './theme'
import { ThroughputData, ThroughputReport, ThroughputReportPages } from './ThroughputReport'

// Keep aligned with supabase/config.toml api.max_rows; never let its server cap
// silently turn large team reports into plausible but incomplete totals.
const REPORT_QUERY_MAX_ROWS = 1000
import { UserSeriesData, UserSeriesReport, UserSeriesReportPages } from './UserSeriesReport'
import { UserSummaryData, UserSummaryReport, UserSummaryReportPages } from './UserSummaryReport'
import { WorkerComparisonData, WorkerComparisonReport, WorkerComparisonReportPages } from './WorkerComparisonReport'

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getCompanyName(sb: SupabaseClient, userId: string): Promise<string> {
  const { data, error } = await sb
    .from('users')
    .select('companies(name)')
    .eq('id', userId)
    .single()
  const user = requireReportQueryData('Report company name', { data, error })
  return (user as any)?.companies?.name || 'Organization'
}

async function getWorkerName(sb: SupabaseClient, userId: string): Promise<string> {
  const { data, error } = await sb.from('users').select('full_name').eq('id', userId).single()
  requireReportQueryData('Report worker name', { data, error })
  return (data as any)?.full_name || 'Person'
}

async function getPipelineName(sb: SupabaseClient, pipelineId: string): Promise<string> {
  const { data, error } = await sb.from('pipelines').select('name').eq('id', pipelineId).single()
  requireReportQueryData('Report pipeline name', { data, error })
  return (data as any)?.name || 'Pipeline'
}

function dateRange(from?: string | null, to?: string | null, days?: number): string {
  if (from && to) return `${fmtDate(from)} — ${fmtDate(to)}`
  const d = days || 30
  const now = new Date()
  const past = new Date(now.getTime() - d * 86400000)
  return `${fmtDate(past.toISOString())} — ${fmtDate(now.toISOString())}`
}

// ── Data fetchers per report type ─────────────────────────────────────────────

async function fetchGeneral(sb: SupabaseClient, p: any, userId: string, companyName: string) {
  const { data: audit, error } = await sb.rpc('rpc_get_organizational_audit', {
    p_pipeline_id:          p.pipeline_id || null,
    p_days:                 p.days || 30,
    p_team_id:              p.team_id || null,
    p_worker_id:            p.worker_id || null,
    p_priority:             p.priority || null,
    p_project_id:           null,
    p_date_start:           p.date_start || null,
    p_date_end:             p.date_end || null,
    p_auth_user_id:         userId,
    p_include_time_metrics: true,
    p_include_advanced:     true,
  })
  if (error) throw new Error(`Audit RPC: ${error.message}`)
  return {
    audit,
    company:   (audit as any)?.summary?.company_name || companyName,
    dateRange: dateRange(p.date_start, p.date_end, p.days),
  } satisfies GeneralData
}

async function fetchWorkerComparison(sb: SupabaseClient, p: any, companyName: string): Promise<WorkerComparisonData> {
  const from = p.date_start || new Date(Date.now() - (p.days || 30) * 86400000).toISOString()
  const to   = p.date_end   || new Date().toISOString()
  const userIds: string[] = p.user_ids?.length > 0
    ? p.user_ids
    : [p.worker_a_id, p.worker_b_id].filter(Boolean)
  const { data, error } = await sb.rpc('rpc_compare_personnel', {
    p_user_ids: userIds, p_from: from, p_to: to, p_salaries: {},
  })
  if (error) throw new Error(`Compare personnel: ${error.message}`)
  return { workers: data || [], company: companyName, dateRange: dateRange(from, to) }
}

async function fetchTeamComparison(sb: SupabaseClient, p: any, companyName: string): Promise<TeamComparisonData> {
  const from = p.date_start || new Date(Date.now() - (p.days || 30) * 86400000).toISOString()
  const to   = p.date_end   || new Date().toISOString()

  let teamIds: string[] = p.team_ids?.length > 0
    ? p.team_ids
    : [p.team_a_id, p.team_b_id].filter(Boolean)

  if (teamIds.length === 0) {
    const { data: all, error, count } = await sb.from('teams').select('id', { count: 'exact' })
      .is('deleted_at', null).order('id').range(0, REPORT_QUERY_MAX_ROWS - 1)
    teamIds = requireCompleteReportRows('teams', { data: all, error, count }).map((t: any) => t.id)
  }

  teamIds = [...new Set(teamIds)]

  const { data: teamsData, error: teamsError, count: teamsCount } = await sb.from('teams')
    .select('id, name', { count: 'exact' }).in('id', teamIds).order('id').range(0, REPORT_QUERY_MAX_ROWS - 1)
  const teamRows = requireCompleteReportRows('teams', { data: teamsData, error: teamsError, count: teamsCount }, teamIds.length)
  const teamMap: Record<string, string> = {}
  teamRows.forEach((t: any) => { teamMap[t.id] = t.name })
  const memberIdsByTeam: string[][] = []

  const calcStats = async (teamId: string) => {
    const { data: members, error: memberError, count: membersCount } = await sb.from('team_members')
      .select('user_id', { count: 'exact' }).eq('team_id', teamId).is('removed_at', null)
      .order('user_id').range(0, REPORT_QUERY_MAX_ROWS - 1)
    const memberRows = requireCompleteReportRows(`team_members (${teamId})`, { data: members, error: memberError, count: membersCount })
    const uids = memberRows.map((m: any) => m.user_id)
    memberIdsByTeam.push(uids)
    if (uids.length === 0) return { id: teamId, name: teamMap[teamId] || teamId, count: 0, completed: 0, failed: 0, pts: 0, hours: 0 }
    const { data: parts, error: participantError, count: participantCount } = await sb.from('task_participants')
      .select('task_id, user_id', { count: 'exact' }).in('user_id', uids)
      .order('user_id').order('task_id').range(0, REPORT_QUERY_MAX_ROWS - 1)
    const participantRows = requireCompleteReportRows('task_participants', { data: parts, error: participantError, count: participantCount })
    const taskIds = [...new Set(participantRows.map((p: any) => p.task_id))]
    const { data: tasks, error: taskError, count: taskCount } = await sb.from('tasks')
      .select('id, weight, completed_at, failed_at', { count: 'exact' }).in('id', taskIds)
      .order('id').range(0, REPORT_QUERY_MAX_ROWS - 1)
    const taskRows = requireCompleteReportRows('tasks', { data: tasks, error: taskError, count: taskCount })
    const { data: sessions, error: sessionError, count: sessionCount } = await sb.from('task_work_sessions')
      .select('id, started_at, last_heartbeat_at', { count: 'exact' }).in('user_id', uids)
      .gte('started_at', from).lte('started_at', to).order('started_at').order('id')
      .range(0, REPORT_QUERY_MAX_ROWS - 1)
    const sessionRows = requireCompleteReportRows('task_work_sessions', { data: sessions, error: sessionError, count: sessionCount })
    const inRange = (t: string) => t >= from && t <= to
    const comp = taskRows.filter((t: any) => t.completed_at && inRange(t.completed_at))
    const fail = taskRows.filter((t: any) => t.failed_at && inRange(t.failed_at))
    const hrs  = sumValidatedSessionHours(sessionRows)
    return { id: teamId, name: teamMap[teamId] || teamId, count: uids.length, completed: comp.length, failed: fail.length, pts: comp.reduce((s: number, t: any) => s + (t.weight || 0), 0), hours: hrs }
  }

  const teams = await Promise.all(teamIds.map(calcStats))
  const overlappingMemberCount = countOverlappingTeamMembers(memberIdsByTeam)
  return { teams, company: companyName, dateRange: dateRange(from, to), overlappingMemberCount }
}

async function fetchUserSeries(sb: SupabaseClient, p: any, userId: string, companyName: string): Promise<UserSeriesData> {
  const { data, error } = await sb.rpc('rpc_get_user_performance_series', {
    p_user_id: p.user_id, p_period_type: p.period_type || 'month', p_n_periods: p.n_periods || 12,
  })
  if (error) throw new Error(`Performance series: ${error.message}`)
  const name = await getWorkerName(sb, p.user_id)
  return { rows: data || [], workerName: name, periodType: p.period_type || 'month', nPeriods: p.n_periods || 12, company: companyName }
}

async function fetchUserSummary(sb: SupabaseClient, p: any, companyName: string): Promise<UserSummaryData> {
  const { data, error } = await sb.rpc('rpc_get_user_performance_summary', {
    p_user_id: p.user_id, p_from: p.date_start, p_to: p.date_end,
  })
  if (error) throw new Error(`Performance summary: ${error.message}`)
  const name = await getWorkerName(sb, p.user_id)
  return { summary: data, workerName: name, dateStart: p.date_start, dateEnd: p.date_end, company: companyName }
}

async function fetchStageDwell(sb: SupabaseClient, p: any, companyName: string): Promise<StageDwellData> {
  const { data, error } = await sb.rpc('rpc_get_pipeline_stage_dwell', {
    p_pipeline_id: p.pipeline_id,
    p_from: p.date_start_local || p.date_start,
    p_to: p.date_end_local || p.date_end,
  })
  if (error) throw new Error(`Stage dwell: ${error.message}`)
  const pipelineName = await getPipelineName(sb, p.pipeline_id)
  return { rows: data || [], pipelineName, dateStart: p.date_start, dateEnd: p.date_end, company: companyName }
}

async function fetchThroughput(sb: SupabaseClient, p: any, companyName: string): Promise<ThroughputData> {
  const { data, error } = await sb.rpc('rpc_get_pipeline_throughput', {
    p_pipeline_id: p.pipeline_id, p_period_type: p.period_type || 'month', p_n_periods: p.n_periods || 12,
  })
  if (error) throw new Error(`Throughput: ${error.message}`)
  const pipelineName = await getPipelineName(sb, p.pipeline_id)
  return { rows: data || [], pipelineName, periodType: p.period_type || 'month', nPeriods: p.n_periods || 12, company: companyName }
}

async function fetchPersonnel(sb: SupabaseClient, p: any, companyName: string): Promise<PersonnelData> {
  const { data, error } = await sb.rpc('rpc_compare_personnel', {
    p_user_ids: p.user_ids, p_from: p.date_start, p_to: p.date_end, p_salaries: {},
  })
  if (error) throw new Error(`Personnel comparison: ${error.message}`)
  return { rows: data || [], dateStart: p.date_start, dateEnd: p.date_end, company: companyName }
}

async function fetchTargets(sb: SupabaseClient, companyName: string): Promise<TargetsData> {
  const { data, error } = await sb.rpc('rpc_get_targets_status')
  if (error) throw new Error(`Targets status: ${error.message}`)
  const targets = (data || []).map((t: any) => ({
    pipeline: t.pipeline_name || '—',
    stage:    t.stage_name    || '—',
    type:     t.target_type   || '—',
    target:   t.target_value,
    current:  t.current_value,
    deadline: t.deadline,
    status:   t.status,
  }))
  return { targets, company: companyName }
}

async function fetchPersonalPulse(sb: SupabaseClient, userId: string, companyName: string): Promise<PersonalPulseData> {
  const { data, error } = await sb.rpc('rpc_get_personal_pulse')
  if (error) throw new Error(`Personal pulse: ${error.message}`)
  const name = await getWorkerName(sb, userId)
  const { count, error: partsError } = await sb.from('task_participants').select('task_id', { count: 'exact', head: true }).eq('user_id', userId)
  const taskCount = requireReportCount('Personal pulse task count', { data: count, error: partsError })
  return {
    workerName:          name,
    dailyPts:            (data as any)?.daily_points       || 0,
    monthlyPts:          (data as any)?.monthly_points     || 0,
    activeSecondsToday:  (data as any)?.active_seconds_today || 0,
    isWorking:           (data as any)?.is_working         || false,
    flapRate:            (data as any)?.flap_rate_score    || 0,
    taskCount,
    company:             companyName,
  }
}

async function fetchProjects(sb: SupabaseClient, p: any, companyName: string): Promise<ProjectsData> {
  // Snapshot by default; if date_start/date_end provided, use as a scope label and to filter task completion
  const projectIds: string[] = Array.isArray(p.project_ids) ? p.project_ids : []
  const fromIso = p.date_start || null
  const toIso   = p.date_end   || null

  // Load projects (filter to selected if provided)
  let projectQuery = sb
    .from('projects')
    .select('id, name, status, pipeline_id, created_at, expiry_date')
    .is('deleted_at', null)
  if (projectIds.length > 0) projectQuery = projectQuery.in('id', projectIds)
  const { data: projects, error: pErr } = await projectQuery
  if (pErr) throw new Error(`Projects fetch: ${pErr.message}`)
  if (!projects || projects.length === 0) {
    return {
      rows: [],
      company: companyName,
      dateRange: fromIso && toIso ? `${fmtDate(fromIso)} — ${fmtDate(toIso)}` : null,
    }
  }

  // Pipeline names for joining
  const pipelineIds = [...new Set(projects.map((pr: any) => pr.pipeline_id).filter(Boolean))]
  const pipelineMap: Record<string, string> = {}
  if (pipelineIds.length > 0) {
    const { data: pipes, error: pipelineError } = await sb.from('pipelines').select('id, name').in('id', pipelineIds)
    const pipelineRows = requireReportQueryData('Project pipelines', { data: pipes, error: pipelineError }) || []
    pipelineRows.forEach((pp: any) => { pipelineMap[pp.id] = pp.name })
  }

  // Lifetime stats via the existing RPC (this respects company RLS)
  const ids = projects.map((pr: any) => pr.id)
  const { data: stats, error: sErr } = await sb.rpc('rpc_get_project_stats', { p_project_ids: ids })
  if (sErr) throw new Error(`Project stats: ${sErr.message}`)
  const statsMap: Record<string, { total_tasks: number; completed_tasks: number; overdue_tasks: number; completion_rate: number }> = {}
  ;(stats || []).forEach((row: any) => { statsMap[row.project_id] = row })

  // If date range scope is provided, also count tasks completed inside that window per project for the "rate" view
  let scopedDoneMap: Record<string, number> = {}
  if (fromIso && toIso) {
    let scopedQuery = sb
      .from('tasks')
      .select('project_id, completed_at')
      .in('project_id', ids)
      .gte('completed_at', fromIso)
      .not('completed_at', 'is', null)
    scopedQuery = p.date_end_exclusive
      ? scopedQuery.lt('completed_at', p.date_end_exclusive)
      : scopedQuery.lte('completed_at', toIso)
    const { data: scoped, error: scopedError } = await scopedQuery
    const scopedRows = requireReportQueryData('Project date-scoped tasks', { data: scoped, error: scopedError }) || []
    scopedRows.forEach((t: any) => {
      if (!t.project_id) return
      scopedDoneMap[t.project_id] = (scopedDoneMap[t.project_id] || 0) + 1
    })
  }

  const nowMs = Date.now()
  const sevenDaysMs = 7 * 86400000

  const rows: ProjectRow[] = projects.map((pr: any) => {
    const st = statsMap[pr.id] || { total_tasks: 0, completed_tasks: 0, overdue_tasks: 0, completion_rate: 0 }
    const createdMs = pr.created_at ? new Date(pr.created_at).getTime() : nowMs
    const daysActive = Math.max(1, (nowMs - createdMs) / 86400000)

    const scopedCompleted = fromIso && toIso ? scopedDoneMap[pr.id] : undefined
    const completedForRate = resolveScopedCompletedTasks(scopedCompleted, st.completed_tasks)
    const windowDays = fromIso && toIso
      ? Math.max(1, Number(p.days) || (new Date(toIso).getTime() - new Date(fromIso).getTime()) / 86400000)
      : daysActive
    const tasksPerDay = completedForRate / windowDays

    const remaining = Math.max(0, st.total_tasks - st.completed_tasks)
    const projectedEta = (remaining > 0 && tasksPerDay > 0)
      ? new Date(nowMs + (remaining / tasksPerDay) * 86400000).toISOString()
      : null

    let health: ProjectRow['health']
    const expiryMs = pr.expiry_date ? new Date(pr.expiry_date).getTime() : null
    if (remaining === 0 && st.total_tasks > 0) {
      health = 'complete'
    } else if (expiryMs && expiryMs < nowMs) {
      health = 'overdue'
    } else if (tasksPerDay === 0 && st.total_tasks > 0) {
      health = 'stalled'
    } else if (expiryMs && projectedEta && new Date(projectedEta).getTime() > expiryMs) {
      health = 'at_risk'
    } else if (expiryMs && (expiryMs - nowMs) < sevenDaysMs && (st.completion_rate || 0) < 60) {
      health = 'at_risk'
    } else {
      health = 'on_track'
    }

    return {
      id:              pr.id,
      name:            pr.name || 'Untitled',
      pipeline_name:   pipelineMap[pr.pipeline_id] || null,
      status:          pr.status,
      total_tasks:     st.total_tasks,
      completed_tasks: st.completed_tasks,
      overdue_tasks:   st.overdue_tasks,
      completion_rate: st.completion_rate || 0,
      days_active:     daysActive,
      tasks_per_day:   tasksPerDay,
      expiry_date:     pr.expiry_date,
      projected_eta:   projectedEta,
      health,
    }
  })

  // Sort by health severity, then by name
  const order: Record<ProjectRow['health'], number> = { overdue: 0, at_risk: 1, stalled: 2, on_track: 3, complete: 4 }
  rows.sort((a, b) => (order[a.health] - order[b.health]) || a.name.localeCompare(b.name))

  return {
    rows,
    company: companyName,
    dateRange: fromIso && toIso ? `${fmtDate(fromIso)} — ${fmtDate(toIso)}` : null,
  }
}

// ── Multi-report: build pages for a single module ─────────────────────────────

type ModuleResult = {
  element: React.ReactElement
  insights: { text: string; color: string }[]
  skipped?: string
}

const MODULE_DISPLAY_NAMES: Record<string, string> = {
  general:                  'Performance Audit',
  workflow_analysis:        'Workflow Analysis',
  worker_comparison:        'People Comparison',
  team_comparison:          'Team Comparison',
  user_performance_series:  'Performance Series',
  user_performance_summary: 'Performance Summary',
  pipeline_stage_dwell:     'Stage Dwell Time',
  pipeline_throughput:      'Pipeline Throughput',
  personnel_comparison:     'Personnel Comparison',
  targets_status:           'Targets Status',
  personal_pulse:           'Personal Pulse',
  projects:                 'Projects',
}

function isModuleEmpty(type: string, data: any): boolean {
  switch (type) {
    case 'worker_comparison':        return (data.workers  || []).length === 0
    case 'team_comparison':          return (data.teams    || []).length === 0
    case 'user_performance_series':  return (data.rows     || []).length === 0
    case 'user_performance_summary': return !data.summary
    case 'pipeline_stage_dwell':     return (data.rows     || []).length === 0
    case 'pipeline_throughput':      return (data.rows     || []).length === 0
    case 'personnel_comparison':     return (data.rows     || []).length === 0
    case 'targets_status':           return (data.targets  || []).length === 0
    case 'projects':                 return (data.rows     || []).length === 0
    default:                         return false
  }
}

async function buildReportSection(
  type: string,
  p: any,
  sb: SupabaseClient,
  userId: string,
  company: string,
  jobId: string,
  isModule = false,
): Promise<ModuleResult> {
  const skip = (data: any): ModuleResult | null => {
    if (!isModule || !isModuleEmpty(type, data)) return null
    return { element: React.createElement(React.Fragment), insights: [], skipped: MODULE_DISPLAY_NAMES[type] || type }
  }

  switch (type) {
    case 'general':
    case 'workflow_analysis': {
      const data = await fetchGeneral(sb, p, userId, company)
      return { element: React.createElement(GeneralReportPages, { data, jobId, isModule }), insights: computeGeneralInsights(data) }
    }
    case 'worker_comparison': {
      const data = await fetchWorkerComparison(sb, p, company)
      return skip(data) ?? { element: React.createElement(WorkerComparisonReportPages, { data, jobId, isModule }), insights: [] }
    }
    case 'team_comparison': {
      const data = await fetchTeamComparison(sb, p, company)
      return skip(data) ?? { element: React.createElement(TeamComparisonReportPages, { data, jobId, isModule }), insights: [] }
    }
    case 'user_performance_series': {
      const data = await fetchUserSeries(sb, p, userId, company)
      return skip(data) ?? { element: React.createElement(UserSeriesReportPages, { data, jobId, isModule }), insights: [] }
    }
    case 'user_performance_summary': {
      const data = await fetchUserSummary(sb, p, company)
      return skip(data) ?? { element: React.createElement(UserSummaryReportPages, { data, jobId, isModule }), insights: [] }
    }
    case 'pipeline_stage_dwell': {
      const data = await fetchStageDwell(sb, p, company)
      return skip(data) ?? { element: React.createElement(StageDwellReportPages, { data, jobId, isModule }), insights: [] }
    }
    case 'pipeline_throughput': {
      const data = await fetchThroughput(sb, p, company)
      return skip(data) ?? { element: React.createElement(ThroughputReportPages, { data, jobId, isModule }), insights: [] }
    }
    case 'personnel_comparison': {
      const data = await fetchPersonnel(sb, p, company)
      return skip(data) ?? { element: React.createElement(PersonnelReportPages, { data, jobId, isModule }), insights: [] }
    }
    case 'targets_status': {
      const data = await fetchTargets(sb, company)
      return skip(data) ?? { element: React.createElement(TargetsReportPages, { data, jobId, isModule }), insights: [] }
    }
    case 'personal_pulse': {
      const data = await fetchPersonalPulse(sb, userId, company)
      return { element: React.createElement(PersonalPulseReportPages, { data, jobId, isModule }), insights: [] }
    }
    case 'projects': {
      const data = await fetchProjects(sb, p, company)
      return skip(data) ?? { element: React.createElement(ProjectsReportPages, { data, jobId, isModule }), insights: computeProjectsInsights(data) }
    }
    default: {
      const data = await fetchGeneral(sb, p, userId, company)
      return { element: React.createElement(GeneralReportPages, { data, jobId, isModule }), insights: computeGeneralInsights(data) }
    }
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function generateAndUploadReport(
  jobId:     string,
  reportType: string,
  parameters: any,
  sb:         SupabaseClient,
  userId:     string,
  companyId:  string,
): Promise<string> {
  const t0 = Date.now()
  const log = (label: string) => {
    console.log(`[report ${jobId.slice(0, 8)}] ${label} +${Date.now() - t0}ms`)
  }

  log(`start type=${reportType}`)
  const startedIso = new Date().toISOString()

  try {
    const { data: startedJob, error: startErr } = await sb.from('reporting_jobs').update({
      status: 'processing',
      started_at: startedIso,
      updated_at: startedIso,
    }).eq('id', jobId).select('id').maybeSingle()
    if (startErr) throw new Error(`Status update failed: ${startErr.message}`)
    if (!startedJob) throw new Error('Report job could not be started; it may not exist or may not be accessible.')

    const company = await getCompanyName(sb, userId)
    const p = parameters || {}

    let element: React.ReactElement

    if (reportType === 'multi_report') {
      const modules = (p.modules || []) as Array<{ type: string; parameters: any }>
      if (modules.length === 0) throw new Error('No report modules specified')

      log(`fetching ${modules.length} modules`)
      const results = await Promise.all(
        modules.map(m => buildReportSection(m.type, m.parameters || {}, sb, userId, company, jobId, true))
      )

      const skippedNames = results.filter(r => r.skipped).map(r => r.skipped!)
      const sectionElements = results.filter(r => !r.skipped).map(r => r.element)

      // Dedupe insights by exact text — picking the first occurrence's color
      const seen = new Set<string>()
      const allInsights: { text: string; color: string }[] = []
      for (const r of results) {
        for (const ins of r.insights) {
          if (seen.has(ins.text)) continue
          seen.add(ins.text)
          allInsights.push(ins)
        }
      }
      if (skippedNames.length > 0) {
        allInsights.push({
          text: `Modules omitted — no data in period: ${skippedNames.join(', ')}.`,
          color: C.muted,
        })
      }

      const children: React.ReactElement[] = [...sectionElements]

      if (allInsights.length > 0) {
        const insightsPage = React.createElement(
          Page,
          { size: 'A4', style: base.page },
          React.createElement(Section, { title: 'Insights & Recommendations' }),
          ...allInsights.map((ins, i) =>
            React.createElement(Insight, { key: String(i), text: ins.text, color: ins.color })
          ),
          React.createElement(Footer, { jobId })
        )
        children.push(insightsPage)
      }

      element = React.createElement(Document, null, ...children)
    } else {
      switch (reportType) {
        case 'general':
        case 'workflow_analysis': {
          const data = await fetchGeneral(sb, p, userId, company)
          element = React.createElement(GeneralReport, { data, jobId })
          break
        }
        case 'worker_comparison': {
          const data = await fetchWorkerComparison(sb, p, company)
          element = React.createElement(WorkerComparisonReport, { data, jobId })
          break
        }
        case 'team_comparison': {
          const data = await fetchTeamComparison(sb, p, company)
          element = React.createElement(TeamComparisonReport, { data, jobId })
          break
        }
        case 'user_performance_series': {
          const data = await fetchUserSeries(sb, p, userId, company)
          element = React.createElement(UserSeriesReport, { data, jobId })
          break
        }
        case 'user_performance_summary': {
          const data = await fetchUserSummary(sb, p, company)
          element = React.createElement(UserSummaryReport, { data, jobId })
          break
        }
        case 'pipeline_stage_dwell': {
          const data = await fetchStageDwell(sb, p, company)
          element = React.createElement(StageDwellReport, { data, jobId })
          break
        }
        case 'pipeline_throughput': {
          const data = await fetchThroughput(sb, p, company)
          element = React.createElement(ThroughputReport, { data, jobId })
          break
        }
        case 'personnel_comparison': {
          const data = await fetchPersonnel(sb, p, company)
          element = React.createElement(PersonnelReport, { data, jobId })
          break
        }
        case 'targets_status': {
          const data = await fetchTargets(sb, company)
          element = React.createElement(TargetsReport, { data, jobId })
          break
        }
        case 'personal_pulse': {
          const data = await fetchPersonalPulse(sb, userId, company)
          element = React.createElement(PersonalPulseReport, { data, jobId })
          break
        }
        case 'projects': {
          const data = await fetchProjects(sb, p, company)
          element = React.createElement(ProjectsReport, { data, jobId })
          break
        }
        default: {
          const data = await fetchGeneral(sb, p, userId, company)
          element = React.createElement(GeneralReport, { data, jobId })
        }
      }
    }

    log('data fetched, building blob')
    const blob = await pdf(element as any).toBlob()
    log(`blob built size=${(blob as any).size ?? '?'}b, uploading`)

    const path = `${companyId}/${jobId}.pdf`
    const { error: uploadErr } = await sb.storage.from('reports').upload(path, blob, {
      contentType: 'application/pdf', upsert: true,
    })
    if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`)
    log('uploaded, marking completed')

    const { data: signed, error: signedError } = await sb.storage.from('reports').createSignedUrl(path, 300)
    requireReportQueryData('Report signed URL', { data: signed, error: signedError })
    const signedUrl = signed?.signedUrl
    if (!signedUrl) throw new Error('Report file was uploaded but a download URL could not be created.')

    const completedIso = new Date().toISOString()
    const { data: completedJob, error: dbErr } = await sb.from('reporting_jobs').update({
      status: 'completed',
      file_url: path,
      completed_at: completedIso,
      updated_at: completedIso,
    }).eq('id', jobId).select('id').maybeSingle()
    requireReportMutationRow('Report completion status update', { data: completedJob, error: dbErr })
    log('row completed in DB')

    return signedUrl

  } catch (err: any) {
    console.error(`[report ${jobId.slice(0, 8)}] FAILED:`, err?.message || err)
    const failedIso = new Date().toISOString()
    try {
      const { data: failedJob, error: failureStatusError } = await sb.from('reporting_jobs').update({
        status: 'failed', error_log: err.message, completed_at: failedIso, updated_at: failedIso,
      }).eq('id', jobId).select('id').maybeSingle()
      requireReportMutationRow('Report failure status update', { data: failedJob, error: failureStatusError })
    } catch (statusError: any) {
      const generationError = err?.message || String(err)
      throw new Error(`${generationError}. Failed status could not be persisted: ${statusError?.message || statusError}`, { cause: err })
    }
    throw err
  }
}
