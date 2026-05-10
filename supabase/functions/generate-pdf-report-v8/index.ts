import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { jsPDF } from "https://esm.sh/jspdf@2.5.1?target=deno"

/**
 * Enhanced PDF Report Generator - Version 8 (REPAIRED)
 * 
 * ✅ Fix: Added job status lifecycle updates (pending -> processing -> completed/failed)
 * ✅ Fix: Proper error reporting to the database
 */

// Color helpers
const hexToRgb = (hex: string): [number, number, number] => {
  const cleanHex = hex.replace('#', '').toUpperCase()
  if (cleanHex.length === 3) {
    return [
      parseInt(cleanHex[0] + cleanHex[0], 16),
      parseInt(cleanHex[1] + cleanHex[1], 16),
      parseInt(cleanHex[2] + cleanHex[2], 16)
    ]
  } else if (cleanHex.length === 6) {
    return [
      parseInt(cleanHex.substring(0, 2), 16),
      parseInt(cleanHex.substring(2, 4), 16),
      parseInt(cleanHex.substring(4, 6), 16)
    ]
  }
  return [99, 102, 241]
}

// Safe toFixed helper to prevent crashes on null/undefined
const safeToFixed = (val: any, digits: number = 0): string => {
  if (val === null || val === undefined || isNaN(Number(val))) return "0";
  return Number(val).toFixed(digits);
}

// Text wrapping helper
const wrapText = (doc: any, text: string, x: number, y: number, maxWidth: number, lineHeight: number = 3) => {
  const words = text.split(' ')
  let line = ''
  let currentY = y
  
  words.forEach((word: string) => {
    const testLine = line + (line ? ' ' : '') + word
    const metrics = doc.getTextDimensions(testLine)
    
    if (metrics.w > maxWidth && line) {
      doc.text(line, x, currentY)
      line = word
      currentY += lineHeight
    } else {
      line = testLine
    }
  })
  
  if (line) {
    doc.text(line, x, currentY)
  }
  
  return currentY
}

// Page break helper
const checkPageBreak = (doc: any, currentY: number, neededSpace: number = 40) => {
  const pageHeight = doc.internal.pageSize.getHeight()
  if (currentY + neededSpace > pageHeight - 10) {
    doc.addPage()
    return 15
  }
  return currentY
}

// Title builder
const buildReportTitle = (reportType: string, params: any): string => {
  const typeMap: any = {
    'general': 'Performance Audit',
    'worker_comparison': 'Worker Comparison',
    'team_comparison': 'Team Comparison',
    'workflow_analysis': 'Workflow Analysis'
  }
  
  let title = typeMap[reportType] || 'Performance Audit'
  if (params.pipeline) title += ` - ${params.pipeline}`
  if (params.team) title += ` - ${params.team} Team`
  if (params.worker) title += ` - ${params.worker}`
  
  return title.toUpperCase()
}

// Filter builder
const buildFilterDisplay = (params: any): string[] => {
  const filters: string[] = []
  if (params.pipeline) filters.push(`Pipeline: ${params.pipeline}`)
  if (params.team) filters.push(`Team: ${params.team}`)
  if (params.worker) filters.push(`Worker: ${params.worker}`)
  if (params.priority) filters.push(`Priority: ${params.priority}`)
  if (params.project) filters.push(`Project: ${params.project}`)
  if (params.date_start || params.date_end) {
    filters.push(`Period: ${params.date_start ? new Date(params.date_start).toLocaleDateString() : 'Start'} to ${params.date_end ? new Date(params.date_end).toLocaleDateString() : 'Now'}`)
  }
  return filters
}

serve(async (req) => {
  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  let jId = "unknown"
  try {
    const { job_id } = await req.json()
    jId = job_id

    console.log(`\n🎬 Starting V8 PDF generation: ${job_id}`)

    // 1. Mark as processing
    await sb.from('reporting_jobs').update({ status: 'processing', updated_at: new Date().toISOString() }).eq('id', job_id)

    // Fetch job with all parameters
    const { data: job, error: jobErr } = await sb
      .from('reporting_jobs')
      .select('*, requested_by(*)')
      .eq('id', job_id)
      .single()

    if (jobErr) throw new Error(`Job fetch failed: ${jobErr.message}`)
    if (!job) throw new Error('Job not found')

    const params = job.parameters || {}
    const days = params.days || 30

    console.log(`📊 Fetching comprehensive audit data...`)

    // Fetch WITH all new metrics
    const { data: auditData, error: auditErr } = await sb.rpc(
      'rpc_get_organizational_audit',
      {
        p_pipeline_id: params.pipeline_id || null,
        p_days: days,
        p_team_id: params.team_id || null,
        p_worker_id: params.worker_id || null,
        p_priority: params.priority || null,
        p_project_id: params.project_id || null,
        p_date_start: params.date_start || null,
        p_date_end: params.date_end || null,
        p_auth_user_id: job.requested_by?.id || null,
        p_include_time_metrics: true,
        p_include_advanced: true
      }
    )

    if (auditErr) {
      console.error(`❌ RPC ERROR: ${auditErr.message}`)
      throw new Error(`Audit data fetch failed: ${auditErr.message}`)
    }

    if (!auditData) {
      console.error(`❌ NO DATA RETURNED`)
      throw new Error('No audit data returned')
    }

    console.log(`✅ Data received - generating PDF...`)

    // Initialize PDF
    const doc = new jsPDF()
    const pageWidth = doc.internal.pageSize.getWidth()
    const pageHeight = doc.internal.pageSize.getHeight()
    const margin = 10
    const contentWidth = pageWidth - (2 * margin)
    let currentY = margin

    const theme = {
      primary: auditData?.summary?.theme?.primary || '#6366f1',
      success: '#10b981',
      danger: '#ef4444',
      warning: '#f59e0b',
      muted: '#64748b',
      text: '#1e293b',
      textLight: '#64748b'
    }

    const primaryRgb = hexToRgb(theme.primary)
    const successRgb = hexToRgb(theme.success)
    const dangerRgb = hexToRgb(theme.danger)
    const warningRgb = hexToRgb(theme.warning)

    // ========== PAGE 1: EXECUTIVE SUMMARY ==========

    // Header
    doc.setFillColor(...primaryRgb)
    doc.rect(0, 0, pageWidth, 30, 'F')

    doc.setTextColor(255, 255, 255)
    doc.setFontSize(20)
    doc.setFont(undefined, 'bold')
    const reportTitle = buildReportTitle(job.report_type, params)
    doc.text(reportTitle, margin, 11)

    doc.setFontSize(7)
    doc.setFont(undefined, 'normal')
    const company = auditData?.summary?.company_name || 'Organization'
    const period = auditData?.summary?.report_period
    const periodText = period ? `${new Date(period.start).toLocaleDateString()} — ${new Date(period.end).toLocaleDateString()}` : 'Current Period'
    doc.text(`${company} | ${periodText}`, margin, 18)
    doc.text(`Generated: ${new Date().toLocaleString()}`, margin, 23)

    currentY = 35

    // Applied Filters
    const appliedFilters = buildFilterDisplay(params)
    if (appliedFilters.length > 0) {
      doc.setFontSize(6.5)
      doc.setTextColor(...hexToRgb(theme.primary))
      doc.setFont(undefined, 'bold')
      doc.text('APPLIED FILTERS', margin, currentY)
      currentY += 3
      
      doc.setFontSize(6)
      doc.setTextColor(...hexToRgb(theme.textLight))
      doc.setFont(undefined, 'normal')
      appliedFilters.slice(0, 3).forEach((filter: string) => {
        doc.text(`• ${filter}`, margin + 2, currentY)
        currentY += 2.5
      })
      currentY += 2
    }

    currentY = checkPageBreak(doc, currentY, 45)

    // KPI Cards
    const current = auditData?.current || {}
    const comparison = auditData?.comparison || {}
    
    const calcDelta = (cur: any, prev: any) => {
      if (!prev || prev === 0) return { text: 'NEW', color: theme.muted }
      const pct = Math.round(((cur - prev) / prev) * 100)
      return { text: `${pct > 0 ? '+' : ''}${pct}%`, color: pct > 0 ? theme.danger : theme.success }
    }

    const kpiSection = (label: string, value: string, delta: string, deltaColor: string, xPos: number, yPos: number) => {
      const cardWidth = (contentWidth - 6) / 3
      
      doc.setFillColor(240, 243, 250)
      doc.rect(xPos, yPos, cardWidth, 24, 'F')
      doc.setDrawColor(...hexToRgb(theme.primary))
      doc.setLineWidth(0.2)
      doc.rect(xPos, yPos, cardWidth, 24)

      doc.setFontSize(6)
      doc.setTextColor(...hexToRgb(theme.primary))
      doc.setFont(undefined, 'bold')
      doc.text(label, xPos + 2, yPos + 4)

      doc.setFontSize(12)
      doc.setTextColor(...hexToRgb(theme.text))
      doc.setFont(undefined, 'bold')
      doc.text(String(value), xPos + 2, yPos + 14)

      doc.setFontSize(5.5)
      doc.setTextColor(...hexToRgb(deltaColor))
      doc.text(`vs. prev: ${delta}`, xPos + 2, yPos + 20)
    }

    const throughputDelta = calcDelta(current.throughput || 0, comparison?.throughput || 0)
    const leadTimeDelta = calcDelta(current.avg_lead_time_business || 0, comparison?.avg_lead_time_business || 0)

    doc.setFontSize(8)
    doc.setTextColor(...hexToRgb(theme.text))
    doc.setFont(undefined, 'bold')
    doc.text('KEY PERFORMANCE INDICATORS', margin, currentY)
    currentY += 4

    kpiSection('THROUGHPUT', String(current.throughput || 0), throughputDelta.text, throughputDelta.color, margin, currentY)
    kpiSection('LEAD TIME', `${Math.round(current.avg_lead_time_business || 0)}m`, leadTimeDelta.text, leadTimeDelta.color, margin + (contentWidth / 3) + 2, currentY)
    kpiSection('SUCCESS RATE', `${Math.round(current.success_rate || 0)}%`, 'STABLE', theme.success, margin + (contentWidth * 2 / 3) + 4, currentY)

    currentY += 30

    // Time Metrics (if available)
    const workerTimeMetrics = auditData?.worker_time_metrics || []
    if (workerTimeMetrics.length > 0) {
      currentY = checkPageBreak(doc, currentY, 20)
      
      const topWorker = workerTimeMetrics[0] || {}
      const timeMetricBox = (label: string, value: string, xPos: number, yPos: number) => {
        const boxWidth = (contentWidth - 4) / 2
        
        doc.setFillColor(245, 247, 252)
        doc.rect(xPos, yPos, boxWidth, 14, 'F')
        doc.setDrawColor(220, 230, 245)
        doc.setLineWidth(0.1)
        doc.rect(xPos, yPos, boxWidth, 14)

        doc.setFontSize(5.5)
        doc.setTextColor(...hexToRgb(theme.primary))
        doc.setFont(undefined, 'bold')
        doc.text(label, xPos + 2, yPos + 4)

        doc.setFontSize(10)
        doc.setTextColor(...hexToRgb(theme.text))
        doc.setFont(undefined, 'bold')
        doc.text(value, xPos + 2, yPos + 11)
      }

      timeMetricBox('TOTAL HOURS', `${topWorker.total_hours || 0}h`, margin, currentY)
      timeMetricBox('AVG PER TASK', `${topWorker.avg_hours_per_task || 0}h`, margin + (contentWidth / 2) + 2, currentY)

      currentY += 18
    }

    currentY = checkPageBreak(doc, currentY, 35)

    // Pipeline Funnel
    doc.setFontSize(8)
    doc.setTextColor(...hexToRgb(theme.text))
    doc.setFont(undefined, 'bold')
    doc.text('PIPELINE FUNNEL ANALYSIS', margin, currentY)
    currentY += 5

    const funnel = auditData?.funnel || []
    if (funnel && funnel.length > 0) {
      const maxValue = Math.max(...funnel.map((f: any) => f.task_count || 0), 1)
      
      funnel.forEach((stage: any) => {
        const value = stage.task_count || 0
        const percentage = ((value / maxValue) * 100)
        
        doc.setFontSize(6.5)
        doc.setTextColor(...hexToRgb(theme.text))
        doc.setFont(undefined, 'bold')
        doc.text(stage.stage_name || 'Unknown', margin, currentY + 2)
        
        doc.setFillColor(230, 235, 245)
        doc.rect(margin + 35, currentY - 0.5, contentWidth - 37, 3.5, 'F')
        
        doc.setFillColor(...primaryRgb)
        doc.rect(margin + 35, currentY - 0.5, (percentage / 100) * (contentWidth - 37), 3.5, 'F')
        
        doc.setFontSize(5)
        doc.setTextColor(...hexToRgb(theme.textLight))
        doc.text(`${value} (${safeToFixed(percentage, 0)}%)`, margin + 36 + (percentage / 100) * (contentWidth - 39), currentY + 2)
        
        currentY += 5
      })
    }

    currentY += 3

    // ========== PAGE 2: OPERATIONAL ANALYSIS ==========
    doc.addPage()
    currentY = margin

    doc.setFontSize(16)
    doc.setTextColor(...hexToRgb(theme.text))
    doc.setFont(undefined, 'bold')
    doc.text('OPERATIONAL ANALYSIS', margin, currentY)
    currentY += 8

    // Stage Duration Analysis
    const stageDurations = auditData?.stage_durations || []
    if (stageDurations.length > 0) {
      doc.setFontSize(7.5)
      doc.setTextColor(...hexToRgb(theme.primary))
      doc.setFont(undefined, 'bold')
      doc.text('Stage Duration Analysis', margin, currentY)
      
      doc.setFontSize(5)
      doc.setTextColor(...hexToRgb(theme.textLight))
      doc.setFont(undefined, 'normal')
      doc.text('Average time spent in each pipeline stage', margin, currentY + 4)
      currentY += 7

      stageDurations.forEach((stage: any) => {
        currentY = checkPageBreak(doc, currentY, 8)
        
        doc.setFontSize(6)
        doc.setTextColor(...hexToRgb(theme.text))
        doc.setFont(undefined, 'bold')
        doc.text(`${stage.stage_name} (${stage.avg_duration_hours || 0}h avg)`, margin, currentY + 1)
        
        doc.setFontSize(5)
        doc.setTextColor(...hexToRgb(theme.textLight))
        doc.text(`Min: ${stage.min_duration || 0}h | Max: ${stage.max_duration || 0}h | Tasks: ${stage.task_count || 0}`, margin + 2, currentY + 5)
        
        currentY += 7
      })
    }

    currentY += 3

    // Conversion Rates
    currentY = checkPageBreak(doc, currentY, 30)
    
    const conversionRates = auditData?.conversion_rates || []
    if (conversionRates.length > 0) {
      doc.setFontSize(7.5)
      doc.setTextColor(...hexToRgb(theme.primary))
      doc.setFont(undefined, 'bold')
      doc.text('Stage Conversion Rates', margin, currentY)
      
      doc.setFontSize(5)
      doc.setTextColor(...hexToRgb(theme.textLight))
      doc.setFont(undefined, 'normal')
      doc.text('Percentage of tasks advancing to next stage', margin, currentY + 4)
      currentY += 7

      conversionRates.slice(0, 5).forEach((rate: any) => {
        const conversionPct = rate.conversion_percentage || 0
        const convColor = conversionPct >= 80 ? theme.success : conversionPct >= 60 ? theme.warning : theme.danger

        doc.setFontSize(5.5)
        doc.setTextColor(...hexToRgb(theme.text))
        doc.setFont(undefined, 'normal')
        doc.text(`${rate.from_stage} → ${rate.to_stage}:`, margin, currentY + 1)
        
        doc.setTextColor(...hexToRgb(convColor))
        doc.setFont(undefined, 'bold')
        doc.text(`${safeToFixed(conversionPct, 1)}%`, margin + 50, currentY + 1)

        currentY += 5
      })
    }

    currentY += 5

    // Activity Trend
    currentY = checkPageBreak(doc, currentY, 25)

    const activityTrend = auditData?.activity_trend || []
    if (activityTrend.length > 0) {
      doc.setFontSize(7.5)
      doc.setTextColor(...hexToRgb(theme.primary))
      doc.setFont(undefined, 'bold')
      doc.text('Activity Trend (Last 14 Days)', margin, currentY)
      
      currentY += 4

      const maxMovement = Math.max(...activityTrend.map((a: any) => a.movement_count || 0), 1)
      const sparkWidth = (contentWidth) / Math.min(activityTrend.length, 14)
      let sparkX = margin

      activityTrend.slice(-14).forEach((day: any, idx: number) => {
        const barHeight = ((day.movement_count || 0) / maxMovement) * 15
        
        doc.setFillColor(...primaryRgb)
        doc.rect(sparkX, currentY + 15 - barHeight, sparkWidth - 0.3, barHeight, 'F')
        
        if (idx % 2 === 0) {
          doc.setFontSize(4)
          doc.setTextColor(...hexToRgb(theme.textLight))
          const dateStr = new Date(day.date).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })
          doc.text(dateStr, sparkX, currentY + 18)
        }
        
        sparkX += sparkWidth
      })
      currentY += 22
    }

    // ========== PAGE 3: TIME & EFFICIENCY ==========
    doc.addPage()
    currentY = margin

    doc.setFontSize(16)
    doc.setTextColor(...hexToRgb(theme.text))
    doc.setFont(undefined, 'bold')
    doc.text('TIME & EFFICIENCY ANALYSIS', margin, currentY)
    currentY += 8

    // Time Efficiency vs Lead Time
    if (current.avg_lead_time_minutes) {
      const actualWorkTimeHours = workerTimeMetrics.length > 0 ? 
        (workerTimeMetrics.reduce((sum: any, w: any) => sum + (w.total_hours || 0), 0) / workerTimeMetrics.length) :
        current.avg_lead_time_minutes / 60

      const leadTimeHours = current.avg_lead_time_minutes / 60
      const efficiency = leadTimeHours > 0 ? safeToFixed((actualWorkTimeHours / leadTimeHours) * 100, 1) : "0"

      doc.setFontSize(7.5)
      doc.setTextColor(...hexToRgb(theme.primary))
      doc.setFont(undefined, 'bold')
      doc.text('Work Time vs Lead Time', margin, currentY)
      currentY += 5

      const effColor = parseFloat(efficiency) > 70 ? theme.success : parseFloat(efficiency) > 50 ? theme.warning : theme.danger

      doc.setFontSize(6)
      doc.setTextColor(...hexToRgb(theme.text))
      doc.setFont(undefined, 'normal')
      doc.text(`Average Lead Time: ${safeToFixed(current.avg_lead_time_minutes, 1)}m`, margin, currentY)
      currentY += 4
      
      doc.text(`Actual Work Time (Avg): ${safeToFixed(actualWorkTimeHours, 1)}h`, margin, currentY)
      currentY += 4
      
      doc.setTextColor(...hexToRgb(effColor))
      doc.setFont(undefined, 'bold')
      doc.text(`Efficiency: ${efficiency}%`, margin, currentY)
      
      currentY += 8
    }

    currentY = checkPageBreak(doc, currentY, 40)

    // Productivity Rankings
    if (workerTimeMetrics.length > 0) {
      doc.setFontSize(7.5)
      doc.setTextColor(...hexToRgb(theme.primary))
      doc.setFont(undefined, 'bold')
      doc.text('Productivity Rankings (Tasks/Hour)', margin, currentY)
      currentY += 5

      workerTimeMetrics.slice(0, 6).forEach((worker: any, idx: number) => {
        const tasksPerHour = worker.tasks_per_hour || 0
        const barWidth = tasksPerHour * 15

        doc.setFontSize(5.5)
        doc.setTextColor(...hexToRgb(theme.text))
        doc.setFont(undefined, 'bold')
        doc.text(`${idx + 1}. ${worker.full_name}`, margin, currentY + 1)

        doc.setFontSize(5)
        doc.setTextColor(...hexToRgb(theme.textLight))
        doc.setFont(undefined, 'normal')
        doc.text(`${safeToFixed(tasksPerHour, 2)} tasks/h (${worker.total_hours || 0}h total)`, margin + 45, currentY + 1)

        doc.setFillColor(230, 235, 245)
        doc.rect(margin + 80, currentY - 0.5, 25, 3, 'F')
        
        doc.setFillColor(...primaryRgb)
        doc.rect(margin + 80, currentY - 0.5, Math.min(barWidth, 25), 3, 'F')

        currentY += 5
      })
    }

    currentY += 5

    // ========== PAGE 4: TEAM & QUALITY ==========
    doc.addPage()
    currentY = margin

    doc.setFontSize(16)
    doc.setTextColor(...hexToRgb(theme.text))
    doc.setFont(undefined, 'bold')
    doc.text('TEAM PERFORMANCE & QUALITY', margin, currentY)
    currentY += 8

    // Worker Time Metrics Table
    if (workerTimeMetrics.length > 0) {
      doc.setFontSize(7.5)
      doc.setTextColor(...hexToRgb(theme.primary))
      doc.setFont(undefined, 'bold')
      doc.text('Worker Time & Productivity Metrics', margin, currentY)
      currentY += 5

      // Table headers
      doc.setFontSize(5.5)
      doc.setTextColor(255, 255, 255)
      doc.setFillColor(...primaryRgb)
      doc.rect(margin, currentY - 3, contentWidth, 4, 'F')
      doc.text('Worker', margin + 2, currentY + 0.5)
      doc.text('Hours', margin + 35, currentY + 0.5)
      doc.text('Tasks', margin + 50, currentY + 0.5)
      doc.text('Tasks/Hr', margin + 60, currentY + 0.5)
      doc.text('Revision %', margin + 75, currentY + 0.5)

      currentY += 5

      // Table rows
      doc.setFontSize(5)
      doc.setTextColor(...hexToRgb(theme.text))
      
      workerTimeMetrics.slice(0, 8).forEach((worker: any, idx: number) => {
        currentY = checkPageBreak(doc, currentY, 5)

        const bgColor = idx % 2 === 0 ? [250, 251, 254] : [245, 247, 252]
        doc.setFillColor(...bgColor)
        doc.rect(margin, currentY - 3, contentWidth, 4, 'F')

        doc.setTextColor(...hexToRgb(theme.text))
        doc.setFont(undefined, 'normal')
        doc.text(worker.full_name || '-', margin + 2, currentY + 0.5)
        doc.text(`${worker.total_hours || 0}h`, margin + 35, currentY + 0.5)
        doc.text(`${worker.task_count || 0}`, margin + 50, currentY + 0.5)
        doc.text(`${safeToFixed(worker.tasks_per_hour, 2)}`, margin + 60, currentY + 0.5)
        
        const revRate = worker.revision_rate || 0
        const revColor = revRate < 10 ? theme.success : revRate < 20 ? theme.warning : theme.danger
        doc.setTextColor(...hexToRgb(revColor))
        doc.text(`${safeToFixed(revRate, 1)}%`, margin + 75, currentY + 0.5)

        currentY += 5
      })
    }

    currentY += 5

    // ========== PAGE 5: INSIGHTS & RECOMMENDATIONS ==========
    doc.addPage()
    currentY = margin

    doc.setFontSize(16)
    doc.setTextColor(...hexToRgb(theme.text))
    doc.setFont(undefined, 'bold')
    doc.text('INSIGHTS & RECOMMENDATIONS', margin, currentY)
    currentY += 8

    // Generate insights
    const insights: { text: string; type: 'success' | 'warning' | 'info' }[] = []

    if (current.success_rate && current.success_rate > 90) {
      insights.push({
        text: `✓ Excellent success rate of ${current.success_rate}% shows strong quality control.`,
        type: 'success'
      })
    }

    if (funnel && funnel.length > 0) {
      const completionRate = safeToFixed(((funnel[funnel.length - 1]?.task_count || 0) / (funnel[0]?.task_count || 1) * 100), 0)
      if (parseInt(completionRate) < 60) {
        insights.push({
          text: `⚠ Only ${completionRate}% of tasks complete the full pipeline. Investigate middle stages.`,
          type: 'warning'
        })
      }
    }

    const bottlenecks = auditData?.bottlenecks || []
    if (bottlenecks.length > 0) {
      const critical = bottlenecks.filter((b: any) => b.severity === 'CRITICAL')
      if (critical.length > 0) {
        insights.push({
          text: `🚨 CRITICAL: ${critical[0].stage_name} stage taking ${critical[0].duration_hours}h avg. Prioritize optimization.`,
          type: 'warning'
        })
      }
    }

    if (workerTimeMetrics.length > 0) {
      const topWorker = workerTimeMetrics[0]
      insights.push({
        text: `✓ ${topWorker.full_name} leads with ${safeToFixed(topWorker.tasks_per_hour, 2)} tasks/hour efficiency.`,
        type: 'success'
      })
    }

    insights.forEach((insight) => {
      currentY = checkPageBreak(doc, currentY, 8)

      doc.setFontSize(6)
      doc.setTextColor(...hexToRgb(
        insight.type === 'success' ? theme.success : insight.type === 'warning' ? theme.warning : theme.primary
      ))
      doc.setFont(undefined, 'normal')
      wrapText(doc, insight.text, margin + 2, currentY, contentWidth - 4, 3.5)
      currentY += 6
    })

    currentY += 5

    // Footer
    for (let i = 1; i <= doc.internal.pages.length; i++) {
      doc.setPage(i)
      
      const footerY = pageHeight - 7
      doc.setFontSize(5)
      doc.setTextColor(150, 150, 150)
      
      const generatedTime = new Date().toLocaleString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      })
      
      doc.text(`Generated: ${generatedTime}`, margin, footerY)
      doc.text(`Report ID: ${job_id.substring(0, 8)}...`, pageWidth / 2 - 15, footerY)
      doc.text(`Page ${i}/${doc.internal.pages.length}`, pageWidth - margin - 20, footerY)
    }

    // Save
    const buf = doc.output('arraybuffer')
    const companyId = job.company_id || 'general'
    const path = `${companyId}/${job_id}.pdf`

    console.log(`📤 Uploading ${safeToFixed(buf.byteLength / 1024, 2)}KB PDF to ${path}...`)

    const { error: uploadErr } = await sb.storage
      .from('reports')
      .upload(path, buf, {
        contentType: 'application/pdf',
        upsert: true
      })

    if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`)

    // 2. Mark as completed
    await sb.from('reporting_jobs')
      .update({ 
        status: 'completed', 
        file_url: path,
        updated_at: new Date().toISOString() 
      })
      .eq('id', job_id)

    console.log(`✅ V8 PDF complete! (${doc.internal.pages.length} pages)`)

    return new Response(
      JSON.stringify({
        success: true,
        message: 'PDF generated with complete analytics (14 metrics)',
        job_id: job_id,
        file_url: path,
        pages: doc.internal.pages.length,
        metrics_included: {
          phase_1: 7,
          phase_2: 7,
          total: 14
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

  } catch (err: any) {
    console.error(`\n❌ V8 generation failed: ${err.message}`)

    // 3. Mark as failed
    if (jId !== "unknown") {
      await sb.from('reporting_jobs')
        .update({ 
          status: 'failed', 
          error_log: err.message,
          updated_at: new Date().toISOString() 
        })
        .eq('id', jId)
    }

    return new Response(
      JSON.stringify({
        error: err.message,
        job_id: jId
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  }
})
