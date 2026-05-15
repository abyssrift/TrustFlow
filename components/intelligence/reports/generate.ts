import { Document, Page, pdf } from '@react-pdf/renderer'
import { SupabaseClient } from '@supabase/supabase-js'
import React from 'react'

import { GeneralData, GeneralReport, GeneralReportPages, computeGeneralInsights } from './GeneralReport'
import { PersonalPulseData, PersonalPulseReport, PersonalPulseReportPages } from './PersonalPulseReport'
import { PersonnelData, PersonnelReport, PersonnelReportPages } from './PersonnelReport'
import { Footer, Insight, Section, fmtDate } from './shared'
import { StageDwellData, StageDwellReport, StageDwellReportPages } from './StageDwellReport'
import { TargetsData, TargetsReport, TargetsReportPages } from './TargetsReport'
import { TeamComparisonData, TeamComparisonReport, TeamComparisonReportPages } from './TeamComparisonReport'
import { base } from './theme'
import { ThroughputData, ThroughputReport, ThroughputReportPages } from './ThroughputReport'
import { UserSeriesData, UserSeriesReport, UserSeriesReportPages } from './UserSeriesReport'
import { UserSummaryData, UserSummaryReport, UserSummaryReportPages } from './UserSummaryReport'
import { WorkerComparisonData, WorkerComparisonReport, WorkerComparisonReportPages } from './WorkerComparisonReport'

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getCompanyName(sb: SupabaseClient, userId: string): Promise<string> {
  const { data } = await sb
    .from('users')
    .select('companies(name)')
    .eq('id', userId)
    .single()
  return (data as any)?.companies?.name || 'Organization'
}

async function getWorkerName(sb: SupabaseClient, userId: string): Promise<string> {
  const { data } = await sb.from('users').select('full_name').eq('id', userId).single()
  return (data as any)?.full_name || 'Person'
}

async function getPipelineName(sb: SupabaseClient, pipelineId: string): Promise<string> {
  const { data } = await sb.from('pipelines').select('name').eq('id', pipelineId).single()
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
  // Support both new user_ids array and legacy worker_a_id/worker_b_id pair
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

  // Support new team_ids array, legacy team_a_id/team_b_id pair, or all teams if empty
  let teamIds: string[] = p.team_ids?.length > 0
    ? p.team_ids
    : [p.team_a_id, p.team_b_id].filter(Boolean)

  if (teamIds.length === 0) {
    const { data: all } = await sb.from('teams').select('id').is('deleted_at', null)
    teamIds = (all || []).map((t: any) => t.id)
  }

  const { data: teamsData } = await sb.from('teams').select('id, name').in('id', teamIds)
  const teamMap: Record<string, string> = {}
  ;(teamsData || []).forEach((t: any) => { teamMap[t.id] = t.name })

  const calcStats = async (teamId: string) => {
    const { data: members } = await sb.from('team_members').select('user_id').eq('team_id', teamId)
    const uids = (members || []).map((m: any) => m.user_id)
    if (uids.length === 0) return { id: teamId, name: teamMap[teamId] || teamId, count: 0, completed: 0, failed: 0, pts: 0, hours: 0 }
    const { data: parts } = await sb.from('task_participants').select('task_id').in('user_id', uids)
    const taskIds = [...new Set((parts || []).map((p: any) => p.task_id))]
    if (taskIds.length === 0) return { id: teamId, name: teamMap[teamId] || teamId, count: uids.length, completed: 0, failed: 0, pts: 0, hours: 0 }
    const { data: tasks } = await sb.from('tasks').select('weight, completed_at, failed_at').in('id', taskIds)
    const { data: sessions } = await sb.from('task_work_sessions').select('started_at, last_heartbeat_at').in('user_id', uids).gte('started_at', from).lte('started_at', to)
    const inRange = (t: string) => t >= from && t <= to
    const comp = (tasks || []).filter((t: any) => t.completed_at && inRange(t.completed_at))
    const fail = (tasks || []).filter((t: any) => t.failed_at && inRange(t.failed_at))
    const hrs  = (sessions || []).reduce((s: number, ws: any) => s + (new Date(ws.last_heartbeat_at).getTime() - new Date(ws.started_at).getTime()) / 3600000, 0)
    return { id: teamId, name: teamMap[teamId] || teamId, count: uids.length, completed: comp.length, failed: fail.length, pts: comp.reduce((s: number, t: any) => s + (t.weight || 0), 0), hours: hrs }
  }

  const teams = await Promise.all(teamIds.map(calcStats))
  return { teams, company: companyName, dateRange: dateRange(from, to) }
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
    p_pipeline_id: p.pipeline_id, p_from: p.date_start, p_to: p.date_end,
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
    p_user_ids: p.user_ids, p_from: p.date_start, p_to: p.date_end, p_salaries: p.salaries || {},
  })
  if (error) throw new Error(`Personnel comparison: ${error.message}`)
  return { rows: data || [], dateStart: p.date_start, dateEnd: p.date_end, company: companyName, hasSalaries: Object.keys(p.salaries || {}).length > 0 }
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
  const { data: parts } = await sb.from('task_participants').select('task_id', { count: 'exact', head: true }).eq('user_id', userId)
  return {
    workerName:          name,
    dailyPts:            (data as any)?.daily_points       || 0,
    monthlyPts:          (data as any)?.monthly_points     || 0,
    activeSecondsToday:  (data as any)?.active_seconds_today || 0,
    isWorking:           (data as any)?.is_working         || false,
    flapRate:            (data as any)?.flap_rate_score    || 0,
    taskCount:           (parts as any)?.count             || 0,
    company:             companyName,
  }
}

// ── Multi-report: build pages for a single module ─────────────────────────────

type ModuleResult = {
  element: React.ReactElement
  insights: { text: string; color: string }[]
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
  switch (type) {
    case 'general':
    case 'workflow_analysis': {
      const data = await fetchGeneral(sb, p, userId, company)
      return {
        element: React.createElement(GeneralReportPages, { data, jobId, isModule }),
        insights: computeGeneralInsights(data),
      }
    }
    case 'worker_comparison': {
      const data = await fetchWorkerComparison(sb, p, company)
      return { element: React.createElement(WorkerComparisonReportPages, { data, jobId, isModule }), insights: [] }
    }
    case 'team_comparison': {
      const data = await fetchTeamComparison(sb, p, company)
      return { element: React.createElement(TeamComparisonReportPages, { data, jobId, isModule }), insights: [] }
    }
    case 'user_performance_series': {
      const data = await fetchUserSeries(sb, p, userId, company)
      return { element: React.createElement(UserSeriesReportPages, { data, jobId, isModule }), insights: [] }
    }
    case 'user_performance_summary': {
      const data = await fetchUserSummary(sb, p, company)
      return { element: React.createElement(UserSummaryReportPages, { data, jobId, isModule }), insights: [] }
    }
    case 'pipeline_stage_dwell': {
      const data = await fetchStageDwell(sb, p, company)
      return { element: React.createElement(StageDwellReportPages, { data, jobId, isModule }), insights: [] }
    }
    case 'pipeline_throughput': {
      const data = await fetchThroughput(sb, p, company)
      return { element: React.createElement(ThroughputReportPages, { data, jobId, isModule }), insights: [] }
    }
    case 'personnel_comparison': {
      const data = await fetchPersonnel(sb, p, company)
      return { element: React.createElement(PersonnelReportPages, { data, jobId, isModule }), insights: [] }
    }
    case 'targets_status': {
      const data = await fetchTargets(sb, company)
      return { element: React.createElement(TargetsReportPages, { data, jobId, isModule }), insights: [] }
    }
    case 'personal_pulse': {
      const data = await fetchPersonalPulse(sb, userId, company)
      return { element: React.createElement(PersonalPulseReportPages, { data, jobId, isModule }), insights: [] }
    }
    default: {
      const data = await fetchGeneral(sb, p, userId, company)
      return {
        element: React.createElement(GeneralReportPages, { data, jobId, isModule }),
        insights: computeGeneralInsights(data),
      }
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
  await sb.from('reporting_jobs').update({ status: 'processing', updated_at: new Date().toISOString() }).eq('id', jobId)

  try {
    const company = await getCompanyName(sb, userId)
    const p = parameters || {}

    let element: React.ReactElement

    if (reportType === 'multi_report') {
      // Fetch all module data in parallel and assemble into one Document
      const modules = (p.modules || []) as Array<{ type: string; parameters: any }>
      if (modules.length === 0) throw new Error('No report modules specified')

      const results = await Promise.all(
        modules.map(m => buildReportSection(m.type, m.parameters || {}, sb, userId, company, jobId, true))
      )

      const sectionElements = results.map(r => r.element)
      const allInsights = results.flatMap(r => r.insights)

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
        default: {
          const data = await fetchGeneral(sb, p, userId, company)
          element = React.createElement(GeneralReport, { data, jobId })
        }
      }
    }

    const blob = await pdf(element as any).toBlob()
    const path = `${companyId}/${jobId}.pdf`

    const { error: uploadErr } = await sb.storage.from('reports').upload(path, blob, {
      contentType: 'application/pdf', upsert: true,
    })
    if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`)

    await sb.from('reporting_jobs').update({
      status: 'completed', file_url: path, updated_at: new Date().toISOString(),
    }).eq('id', jobId)

    const { data: signed } = await sb.storage.from('reports').createSignedUrl(path, 300)
    return signed?.signedUrl || ''

  } catch (err: any) {
    await sb.from('reporting_jobs').update({
      status: 'failed', error_log: err.message, updated_at: new Date().toISOString(),
    }).eq('id', jobId)
    throw err
  }
}
