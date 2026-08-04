import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jsPDF } from "https://esm.sh/jspdf@2.5.1?target=deno";
// ── Helpers ────────────────────────────────────────────────────────────────────
const hexToRgb = (hex)=>{
  const c = hex.replace('#', '');
  if (c.length === 3) return [
    parseInt(c[0] + c[0], 16),
    parseInt(c[1] + c[1], 16),
    parseInt(c[2] + c[2], 16)
  ];
  return [
    parseInt(c.slice(0, 2), 16),
    parseInt(c.slice(2, 4), 16),
    parseInt(c.slice(4, 6), 16)
  ];
};
const sf = (val, d = 0)=>{
  if (val === null || val === undefined || isNaN(Number(val))) return '0';
  return Number(val).toFixed(d);
};
const fmtSec = (s)=>{
  if (!s || s <= 0) return '0m';
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};
const fmtDate = (d)=>d ? new Date(d).toLocaleDateString() : '—';
// ── PDF constants & primitives ─────────────────────────────────────────────────
const T = {
  primary: '#6366f1',
  success: '#10b981',
  danger: '#ef4444',
  warning: '#f59e0b',
  text: '#1e293b',
  muted: '#64748b'
};
const M = 10 // margin
;
const PW = 210 // page width (A4)
;
const banner = (doc, title, sub)=>{
  doc.setFillColor(...hexToRgb(T.primary));
  doc.rect(0, 0, PW, 30, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.setFont(undefined, 'bold');
  doc.text(title, M, 12);
  doc.setFontSize(6.5);
  doc.setFont(undefined, 'normal');
  doc.text(sub, M, 20);
  doc.text(`Generated: ${new Date().toLocaleString()}`, M, 26);
  return 36;
};
const secTitle = (doc, text, y)=>{
  doc.setFontSize(9);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(...hexToRgb(T.primary));
  doc.text(text, M, y);
  doc.setDrawColor(...hexToRgb(T.primary));
  doc.setLineWidth(0.25);
  doc.line(M, y + 1.5, PW - M, y + 1.5);
  return y + 7;
};
const subHead = (doc, text, y)=>{
  doc.setFontSize(7);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(...hexToRgb(T.text));
  doc.text(text, M, y);
  return y + 5;
};
const emptyNote = (doc, y, msg)=>{
  doc.setFontSize(6);
  doc.setFont(undefined, 'italic');
  doc.setTextColor(...hexToRgb(T.muted));
  doc.text(msg, M + 2, y);
  return y + 8;
};
const chk = (doc, y, need = 20)=>{
  if (y + need > doc.internal.pageSize.getHeight() - 12) {
    doc.addPage();
    return 15;
  }
  return y;
};
const kpi = (doc, label, value, note, noteCol, x, y, w)=>{
  doc.setFillColor(240, 243, 250);
  doc.rect(x, y, w, 22, 'F');
  doc.setDrawColor(...hexToRgb(T.primary));
  doc.setLineWidth(0.15);
  doc.rect(x, y, w, 22);
  doc.setFontSize(5.5);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(...hexToRgb(T.primary));
  doc.text(label, x + 2, y + 4);
  doc.setFontSize(13);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(...hexToRgb(T.text));
  doc.text(value, x + 2, y + 14);
  if (note) {
    doc.setFontSize(5.5);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(...hexToRgb(noteCol));
    doc.text(note, x + 2, y + 20);
  }
};
// rows: array of { cells: string[], colors?: (string|null)[] }
const table = (doc, headers, colW, rows, y)=>{
  const totalW = PW - 2 * M;
  doc.setFillColor(...hexToRgb(T.primary));
  doc.rect(M, y - 3.5, totalW, 5, 'F');
  doc.setFontSize(5.5);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(255, 255, 255);
  let x = M + 1;
  headers.forEach((h, i)=>{
    doc.text(h, x, y + 0.5);
    x += colW[i];
  });
  y += 5;
  rows.forEach((row, ri)=>{
    y = chk(doc, y, 6);
    doc.setFillColor(...ri % 2 === 0 ? [
      250,
      251,
      254
    ] : [
      244,
      246,
      251
    ]);
    doc.rect(M, y - 3.5, totalW, 5, 'F');
    doc.setFontSize(5);
    doc.setFont(undefined, 'normal');
    let cx = M + 1;
    row.cells.forEach((cell, ci)=>{
      const col = row.colors?.[ci];
      doc.setTextColor(...hexToRgb(col || T.text));
      doc.text(String(cell).substring(0, 35), cx, y + 0.5);
      cx += colW[ci];
    });
    y += 5;
  });
  return y + 3;
};
const addFooters = (doc, jobId)=>{
  const total = doc.internal.pages.length;
  for(let i = 1; i <= total; i++){
    doc.setPage(i);
    const ph = doc.internal.pageSize.getHeight();
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.1);
    doc.line(M, ph - 8, PW - M, ph - 8);
    doc.setFontSize(5);
    doc.setTextColor(150, 150, 150);
    doc.text(`Generated: ${new Date().toLocaleString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    })}`, M, ph - 5);
    doc.text(`Report ID: ${jobId.substring(0, 8)}...`, PW / 2 - 15, ph - 5);
    doc.text(`Page ${i}/${total}`, PW - M - 15, ph - 5);
  }
};
// ══════════════════════════════════════════════════════════════════════════════
// GENERATORS
// ══════════════════════════════════════════════════════════════════════════════
async function generateGeneral(doc, sb, job, p) {
  const days = p.days || 30;
  const { data: a, error } = await sb.rpc('rpc_get_organizational_audit', {
    p_pipeline_id: p.pipeline_id || null,
    p_days: days,
    p_team_id: p.team_id || null,
    p_worker_id: p.worker_id || null,
    p_priority: p.priority || null,
    p_project_id: p.project_id || null,
    p_date_start: p.date_start || null,
    p_date_end: p.date_end || null,
    p_auth_user_id: job.requested_by || null,
    p_include_time_metrics: true,
    p_include_advanced: true
  });
  if (error) throw new Error(`Audit RPC failed: ${error.message}`);
  const cur = a?.current || {};
  const cmp = a?.comparison || {};
  const wtm = a?.worker_time_metrics || [];
  const funnel = a?.funnel || [];
  const stageDur = a?.stage_durations || [];
  const convRates = a?.conversion_rates || [];
  const actTrend = a?.activity_trend || [];
  const btl = a?.bottlenecks || [];
  const company = a?.summary?.company_name || 'Organization';
  const period = a?.summary?.report_period;
  const pText = period ? `${fmtDate(period.start)} — ${fmtDate(period.end)}` : `Last ${days} days`;
  const delta = (cur, prev)=>{
    if (!prev) return {
      t: 'NEW',
      c: T.muted
    };
    const pct = Math.round((cur - prev) / prev * 100);
    return {
      t: `${pct > 0 ? '+' : ''}${pct}%`,
      c: pct > 0 ? T.danger : T.success
    };
  };
  // Page 1 — KPIs
  let y = banner(doc, 'PERFORMANCE AUDIT', `${company} | ${pText}`);
  // Filters
  const filters = [];
  if (p.date_start || p.date_end) filters.push(`Period: ${fmtDate(p.date_start)} to ${fmtDate(p.date_end)}`);
  if (p.pipeline_id) filters.push('Pipeline filter active');
  if (p.team_id) filters.push('Team filter active');
  if (p.worker_id) filters.push('Worker filter active');
  if (p.priority) filters.push(`Priority: ${p.priority}`);
  if (filters.length) {
    doc.setFontSize(6);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(...hexToRgb(T.primary));
    doc.text('APPLIED FILTERS', M, y);
    y += 3;
    doc.setFont(undefined, 'normal');
    doc.setTextColor(...hexToRgb(T.muted));
    filters.forEach((f)=>{
      doc.text(`• ${f}`, M + 2, y);
      y += 2.5;
    });
    y += 2;
  }
  doc.setFontSize(8);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(...hexToRgb(T.text));
  doc.text('KEY PERFORMANCE INDICATORS', M, y);
  y += 4;
  const kw = (PW - 2 * M - 4) / 3;
  const td = delta(cur.throughput || 0, cmp.throughput || 0);
  const ltd = delta(cur.avg_lead_time_business || 0, cmp.avg_lead_time_business || 0);
  kpi(doc, 'THROUGHPUT', String(cur.throughput || 0), `vs. prev: ${td.t}`, td.c, M, y, kw);
  kpi(doc, 'LEAD TIME', `${Math.round(cur.avg_lead_time_business || 0)}m`, `vs. prev: ${ltd.t}`, ltd.c, M + kw + 2, y, kw);
  kpi(doc, 'SUCCESS RATE', `${Math.round(cur.success_rate || 0)}%`, 'vs. prev: STABLE', T.success, M + 2 * (kw + 2), y, kw);
  y += 28;
  if (wtm.length > 0) {
    const top = wtm[0];
    const hw = (PW - 2 * M - 2) / 2;
    kpi(doc, 'TOTAL HOURS', `${top.total_hours || 0}h`, '', T.muted, M, y, hw);
    kpi(doc, 'AVG PER TASK', `${top.avg_hours_per_task || 0}h`, '', T.muted, M + hw + 2, y, hw);
    y += 26;
  }
  y = chk(doc, y, 30);
  y = secTitle(doc, 'PIPELINE FUNNEL ANALYSIS', y);
  if (funnel.length > 0) {
    const maxV = Math.max(...funnel.map((f)=>f.task_count || 0), 1);
    funnel.forEach((stage)=>{
      y = chk(doc, y, 6);
      const pct = (stage.task_count || 0) / maxV * 100;
      const bw = PW - M - 50;
      doc.setFontSize(6.5);
      doc.setFont(undefined, 'bold');
      doc.setTextColor(...hexToRgb(T.text));
      doc.text(String(stage.stage_name || 'Unknown').substring(0, 20), M, y + 2);
      doc.setFillColor(230, 235, 245);
      doc.rect(M + 35, y - 0.5, bw, 3.5, 'F');
      doc.setFillColor(...hexToRgb(T.primary));
      doc.rect(M + 35, y - 0.5, pct / 100 * bw, 3.5, 'F');
      doc.setFontSize(5);
      doc.setTextColor(...hexToRgb(T.muted));
      doc.text(`${stage.task_count || 0} (${sf(pct, 0)}%)`, M + 37 + pct / 100 * bw, y + 2);
      y += 5;
    });
  } else {
    y = emptyNote(doc, y, 'No pipeline stage data available for this period.');
  }
  // Page 2 — Operational Analysis
  doc.addPage();
  y = 15;
  y = secTitle(doc, 'OPERATIONAL ANALYSIS', y);
  y = subHead(doc, 'Stage Duration Analysis', y);
  if (stageDur.length > 0) {
    y = table(doc, [
      'Stage',
      'Avg (h)',
      'Min (h)',
      'Max (h)',
      'Tasks'
    ], [
      60,
      25,
      25,
      25,
      25
    ], stageDur.map((s)=>({
        cells: [
          String(s.stage_name || '-').substring(0, 28),
          sf(s.avg_duration_hours, 1),
          sf(s.min_duration, 1),
          sf(s.max_duration, 1),
          String(s.task_count || 0)
        ]
      })), y);
  } else {
    y = emptyNote(doc, y, 'No stage duration data available for this period.');
  }
  y = chk(doc, y, 25);
  y = subHead(doc, 'Stage Conversion Rates', y);
  if (convRates.length > 0) {
    convRates.slice(0, 8).forEach((rate)=>{
      y = chk(doc, y, 6);
      const pct = rate.conversion_percentage || 0;
      const col = pct >= 80 ? T.success : pct >= 60 ? T.warning : T.danger;
      doc.setFontSize(5.5);
      doc.setFont(undefined, 'normal');
      doc.setTextColor(...hexToRgb(T.text));
      doc.text(`${rate.from_stage} → ${rate.to_stage}:`, M, y + 1);
      doc.setTextColor(...hexToRgb(col));
      doc.setFont(undefined, 'bold');
      doc.text(`${sf(pct, 1)}%`, M + 52, y + 1);
      y += 5;
    });
  } else {
    y = emptyNote(doc, y, 'No conversion rate data available.');
  }
  y = chk(doc, y, 30);
  y = subHead(doc, 'Activity Trend (Last 14 Days)', y);
  if (actTrend.length > 0) {
    const maxM = Math.max(...actTrend.map((a)=>a.movement_count || 0), 1);
    const spW = (PW - 2 * M) / Math.min(actTrend.length, 14);
    let sx = M;
    actTrend.slice(-14).forEach((day, idx)=>{
      const bh = (day.movement_count || 0) / maxM * 15;
      doc.setFillColor(...hexToRgb(T.primary));
      doc.rect(sx, y + 15 - bh, spW - 0.3, bh, 'F');
      if (idx % 2 === 0) {
        doc.setFontSize(4);
        doc.setTextColor(...hexToRgb(T.muted));
        doc.text(new Date(day.date).toLocaleDateString('en-US', {
          month: 'numeric',
          day: 'numeric'
        }), sx, y + 18);
      }
      sx += spW;
    });
    y += 22;
  } else {
    y = emptyNote(doc, y, 'No activity trend data available.');
  }
  // Page 3 — Time & Efficiency
  doc.addPage();
  y = 15;
  y = secTitle(doc, 'TIME & EFFICIENCY ANALYSIS', y);
  if (cur.avg_lead_time_minutes) {
    const avgWorkH = wtm.length > 0 ? wtm.reduce((s, w)=>s + (w.total_hours || 0), 0) / wtm.length : cur.avg_lead_time_minutes / 60;
    const leadH = cur.avg_lead_time_minutes / 60;
    const effPct = leadH > 0 ? avgWorkH / leadH * 100 : 0;
    const effCol = effPct > 70 ? T.success : effPct > 50 ? T.warning : T.danger;
    y = subHead(doc, 'Work Time vs Lead Time', y);
    doc.setFontSize(6);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(...hexToRgb(T.text));
    doc.text(`Average Lead Time: ${sf(cur.avg_lead_time_minutes, 1)}m`, M, y);
    y += 4;
    doc.text(`Actual Work Time (Avg): ${sf(avgWorkH, 1)}h`, M, y);
    y += 4;
    doc.setTextColor(...hexToRgb(effCol));
    doc.setFont(undefined, 'bold');
    doc.text(`Efficiency: ${sf(effPct, 1)}%`, M, y);
    y += 10;
  }
  if (wtm.length > 0) {
    y = chk(doc, y, 30);
    y = subHead(doc, 'Productivity Rankings (Tasks/Hour)', y);
    const maxTPH = Math.max(...wtm.map((w)=>w.tasks_per_hour || 0), 1);
    wtm.slice(0, 8).forEach((worker, idx)=>{
      y = chk(doc, y, 6);
      const tph = worker.tasks_per_hour || 0;
      doc.setFontSize(5.5);
      doc.setFont(undefined, 'bold');
      doc.setTextColor(...hexToRgb(T.text));
      doc.text(`${idx + 1}. ${worker.full_name}`, M, y + 1);
      doc.setFontSize(5);
      doc.setFont(undefined, 'normal');
      doc.setTextColor(...hexToRgb(T.muted));
      doc.text(`${sf(tph, 2)} tasks/h (${worker.total_hours || 0}h)`, M + 45, y + 1);
      doc.setFillColor(230, 235, 245);
      doc.rect(M + 80, y - 0.5, 25, 3, 'F');
      doc.setFillColor(...hexToRgb(T.primary));
      doc.rect(M + 80, y - 0.5, Math.min(tph / maxTPH * 25, 25), 3, 'F');
      y += 5;
    });
  }
  // Page 4 — Team & Quality
  doc.addPage();
  y = 15;
  y = secTitle(doc, 'TEAM PERFORMANCE & QUALITY', y);
  if (wtm.length > 0) {
    y = subHead(doc, 'Worker Time & Productivity Metrics', y);
    y = table(doc, [
      'Worker',
      'Hours',
      'Tasks',
      'Tasks/Hr',
      'Revision %'
    ], [
      55,
      22,
      18,
      22,
      33
    ], wtm.slice(0, 10).map((w)=>{
      const rev = w.revision_rate || 0;
      return {
        cells: [
          String(w.full_name || '-').substring(0, 25),
          `${w.total_hours || 0}h`,
          String(w.task_count || 0),
          sf(w.tasks_per_hour, 2),
          `${sf(rev, 1)}%`
        ],
        colors: [
          null,
          null,
          null,
          null,
          rev < 10 ? T.success : rev < 20 ? T.warning : T.danger
        ]
      };
    }), y);
  }
  // Page 5 — Insights
  doc.addPage();
  y = 15;
  y = secTitle(doc, 'INSIGHTS & RECOMMENDATIONS', y);
  const insights = [];
  if ((cur.success_rate || 0) >= 80) insights.push({
    text: `Strong success rate of ${cur.success_rate}% demonstrates solid quality control.`,
    col: T.success
  });
  if ((cur.success_rate || 0) > 0 && (cur.success_rate || 0) < 50) insights.push({
    text: `Success rate of ${cur.success_rate}% is below 50%. Investigate root causes of task failure.`,
    col: T.warning
  });
  if (funnel.length > 1) {
    const cr = Math.round((funnel[funnel.length - 1]?.task_count || 0) / (funnel[0]?.task_count || 1) * 100);
    if (cr < 60) insights.push({
      text: `Only ${cr}% of tasks complete the full pipeline. Review mid-funnel drop-off stages.`,
      col: T.warning
    });
  }
  const crit = btl.filter((b)=>b.severity === 'CRITICAL');
  if (crit.length > 0) insights.push({
    text: `CRITICAL bottleneck: ${crit[0].stage_name} averages ${crit[0].duration_hours}h. Prioritize optimization.`,
    col: T.danger
  });
  const topWorker = wtm.length > 0 ? wtm[0] : null;
  if (topWorker && (topWorker.tasks_per_hour || 0) > 0) insights.push({
    text: `Top performer: ${topWorker.full_name} at ${sf(topWorker.tasks_per_hour, 2)} tasks/hour.`,
    col: T.success
  });
  if (insights.length === 0) insights.push({
    text: 'Insufficient data for automated insights. Expand the date range for more meaningful analysis.',
    col: T.primary
  });
  insights.forEach((ins)=>{
    y = chk(doc, y, 10);
    doc.setFontSize(6);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(...hexToRgb(ins.col));
    const wrapped = doc.splitTextToSize(ins.text, PW - 2 * M - 4);
    doc.text(wrapped, M + 2, y);
    y += wrapped.length * 3.5 + 4;
  });
}
// ── Worker Comparison ──────────────────────────────────────────────────────────
async function generateWorkerComparison(doc, sb, _job, p) {
  const from = p.date_start || new Date(Date.now() - (p.days || 30) * 86400000).toISOString();
  const to = p.date_end || new Date().toISOString();
  const { data: workers, error } = await sb.rpc('rpc_compare_personnel', {
    p_user_ids: [
      p.worker_a_id,
      p.worker_b_id
    ],
    p_from: from,
    p_to: to,
    p_salaries: {}
  });
  if (error) throw new Error(`Worker comparison failed: ${error.message}`);
  let y = banner(doc, 'PERSONNEL BENCHMARKING', `${fmtDate(from)} — ${fmtDate(to)}`);
  y = secTitle(doc, 'HEAD-TO-HEAD COMPARISON', y);
  if (!workers || workers.length < 2) {
    emptyNote(doc, y, 'Insufficient data. Ensure both workers have activity in the selected period.');
    return;
  }
  const [wA, wB] = workers;
  const cw = (PW - 2 * M - 2) / 3;
  doc.setFontSize(7);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(...hexToRgb(T.primary));
  doc.text('Metric', M, y);
  doc.text(String(wA.full_name || 'Worker A').substring(0, 22), M + cw, y);
  doc.text(String(wB.full_name || 'Worker B').substring(0, 22), M + 2 * cw, y);
  y += 6;
  const row = (label, vA, vB, winA)=>{
    doc.setFontSize(6);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(...hexToRgb(T.muted));
    doc.text(label, M, y + 1);
    doc.setTextColor(...hexToRgb(winA ? T.success : T.text));
    doc.setFont(undefined, winA ? 'bold' : 'normal');
    doc.text(vA, M + cw, y + 1);
    doc.setTextColor(...hexToRgb(!winA ? T.success : T.text));
    doc.setFont(undefined, !winA ? 'bold' : 'normal');
    doc.text(vB, M + 2 * cw, y + 1);
    y += 5;
  };
  row('Weight Points', String(wA.weight_points || 0), String(wB.weight_points || 0), (wA.weight_points || 0) >= (wB.weight_points || 0));
  row('Tasks Completed', String(wA.completed_tasks || 0), String(wB.completed_tasks || 0), (wA.completed_tasks || 0) >= (wB.completed_tasks || 0));
  row('Tasks Failed', String(wA.failed_tasks || 0), String(wB.failed_tasks || 0), (wA.failed_tasks || 0) <= (wB.failed_tasks || 0));
  row('Active Hours', `${sf(wA.active_hours, 1)}h`, `${sf(wB.active_hours, 1)}h`, (wA.active_hours || 0) >= (wB.active_hours || 0));
  row('On-Time Rate', `${sf(wA.on_time_rate, 1)}%`, `${sf(wB.on_time_rate, 1)}%`, (wA.on_time_rate || 0) >= (wB.on_time_rate || 0));
  row('Timer Efficiency', `${sf(wA.timer_efficiency, 1)}%`, `${sf(wB.timer_efficiency, 1)}%`, (wA.timer_efficiency || 0) >= (wB.timer_efficiency || 0));
  row('Points/Hour', sf(wA.points_per_hour, 2), sf(wB.points_per_hour, 2), (wA.points_per_hour || 0) >= (wB.points_per_hour || 0));
  row('Revisions', String(wA.revision_count || 0), String(wB.revision_count || 0), (wA.revision_count || 0) <= (wB.revision_count || 0));
}
// ── Team Comparison ────────────────────────────────────────────────────────────
async function generateTeamComparison(doc, sb, _job, p) {
  const from = p.date_start || new Date(Date.now() - (p.days || 30) * 86400000).toISOString();
  const to = p.date_end || new Date().toISOString();
  const { data: teamsData } = await sb.from('teams').select('id, name').in('id', [
    p.team_a_id,
    p.team_b_id
  ]);
  const teamA = teamsData?.find((t)=>t.id === p.team_a_id);
  const teamB = teamsData?.find((t)=>t.id === p.team_b_id);
  const teamStats = async (teamId)=>{
    const { data: members } = await sb.from('team_members').select('user_id').eq('team_id', teamId);
    const uids = (members || []).map((m)=>m.user_id);
    if (uids.length === 0) return {
      count: 0,
      completed: 0,
      failed: 0,
      pts: 0,
      hours: 0
    };
    const { data: parts } = await sb.from('task_participants').select('task_id').in('user_id', uids);
    const taskIds = [
      ...new Set((parts || []).map((p)=>p.task_id))
    ];
    if (taskIds.length === 0) return {
      count: uids.length,
      completed: 0,
      failed: 0,
      pts: 0,
      hours: 0
    };
    const { data: tasks } = await sb.from('tasks').select('weight, completed_at, failed_at').in('id', taskIds);
    const { data: sessions } = await sb.from('task_work_sessions').select('started_at, last_heartbeat_at').in('user_id', uids).gte('started_at', from).lte('started_at', to);
    const inRange = (t)=>t >= from && t <= to;
    const comp = (tasks || []).filter((t)=>t.completed_at && inRange(t.completed_at));
    const fail = (tasks || []).filter((t)=>t.failed_at && inRange(t.failed_at));
    const hrs = (sessions || []).reduce((s, ws)=>s + (new Date(ws.last_heartbeat_at).getTime() - new Date(ws.started_at).getTime()) / 3600000, 0);
    return {
      count: uids.length,
      completed: comp.length,
      failed: fail.length,
      pts: comp.reduce((s, t)=>s + (t.weight || 0), 0),
      hours: hrs
    };
  };
  const [sA, sB] = await Promise.all([
    teamStats(p.team_a_id),
    teamStats(p.team_b_id)
  ]);
  let y = banner(doc, 'STRUCTURAL MATRIX ANALYSIS', `${fmtDate(from)} — ${fmtDate(to)}`);
  y = secTitle(doc, 'TEAM HEAD-TO-HEAD', y);
  const cw = (PW - 2 * M - 2) / 3;
  doc.setFontSize(7);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(...hexToRgb(T.primary));
  doc.text('Metric', M, y);
  doc.text(String(teamA?.name || 'Team A').substring(0, 22), M + cw, y);
  doc.text(String(teamB?.name || 'Team B').substring(0, 22), M + 2 * cw, y);
  y += 6;
  const row = (label, vA, vB, winA)=>{
    doc.setFontSize(6);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(...hexToRgb(T.muted));
    doc.text(label, M, y + 1);
    doc.setTextColor(...hexToRgb(winA ? T.success : T.text));
    doc.setFont(undefined, winA ? 'bold' : 'normal');
    doc.text(vA, M + cw, y + 1);
    doc.setTextColor(...hexToRgb(!winA ? T.success : T.text));
    doc.setFont(undefined, !winA ? 'bold' : 'normal');
    doc.text(vB, M + 2 * cw, y + 1);
    y += 5;
  };
  row('Members', String(sA.count), String(sB.count), false);
  row('Tasks Completed', String(sA.completed), String(sB.completed), sA.completed >= sB.completed);
  row('Tasks Failed', String(sA.failed), String(sB.failed), sA.failed <= sB.failed);
  row('Weight Points', String(sA.pts), String(sB.pts), sA.pts >= sB.pts);
  row('Active Hours', `${sf(sA.hours, 1)}h`, `${sf(sB.hours, 1)}h`, sA.hours >= sB.hours);
  const arA = sA.completed + sA.failed > 0 ? Math.round(sA.completed / (sA.completed + sA.failed) * 100) : 0;
  const arB = sB.completed + sB.failed > 0 ? Math.round(sB.completed / (sB.completed + sB.failed) * 100) : 0;
  row('Success Rate', `${arA}%`, `${arB}%`, arA >= arB);
}
// ── User Performance Series ────────────────────────────────────────────────────
async function generateUserPerformanceSeries(doc, sb, _job, p) {
  const { data: rows, error } = await sb.rpc('rpc_get_user_performance_series', {
    p_user_id: p.user_id,
    p_period_type: p.period_type || 'month',
    p_n_periods: p.n_periods || 12
  });
  if (error) throw new Error(`Performance series failed: ${error.message}`);
  const { data: u } = await sb.from('users').select('full_name').eq('id', p.user_id).single();
  const name = u?.full_name || 'Worker';
  let y = banner(doc, 'WORKER PERFORMANCE TIMELINE', `${name} | ${p.n_periods || 12} ${p.period_type || 'month'}(s)`);
  y = secTitle(doc, `PERIOD BREAKDOWN — ${name.toUpperCase()}`, y);
  if (!rows || rows.length === 0) {
    emptyNote(doc, y, 'No data for this worker in the specified range.');
    return;
  }
  y = table(doc, [
    'Period',
    'Points',
    'Done',
    'Failed',
    'OnTime',
    'Revisions',
    'Hours',
    'Est.h'
  ], [
    30,
    16,
    14,
    16,
    16,
    20,
    18,
    20
  ], rows.map((r)=>({
      cells: [
        r.period_label || '—',
        String(r.weight_points || 0),
        String(r.completed_tasks || 0),
        String(r.failed_tasks || 0),
        String(r.on_time_tasks || 0),
        String(r.revision_count || 0),
        sf((r.active_seconds || 0) / 3600, 1) + 'h',
        sf((r.estimated_seconds || 0) / 3600, 1) + 'h'
      ],
      colors: [
        null,
        null,
        null,
        T.danger,
        null,
        T.warning,
        null,
        null
      ]
    })), y);
  y = chk(doc, y, 20);
  y = subHead(doc, 'Totals', y);
  const totalPts = rows.reduce((s, r)=>s + (r.weight_points || 0), 0);
  const totalComp = rows.reduce((s, r)=>s + (r.completed_tasks || 0), 0);
  const totalFail = rows.reduce((s, r)=>s + (r.failed_tasks || 0), 0);
  const totalHrs = rows.reduce((s, r)=>s + (r.active_seconds || 0), 0) / 3600;
  doc.setFontSize(6);
  doc.setFont(undefined, 'normal');
  doc.setTextColor(...hexToRgb(T.text));
  doc.text(`Total points: ${totalPts}  |  Completed: ${totalComp}  |  Failed: ${totalFail}  |  Hours: ${sf(totalHrs, 1)}h`, M, y);
  y += 4;
  if (totalComp + totalFail > 0) {
    const sr = Math.round(totalComp / (totalComp + totalFail) * 100);
    const col = sr >= 80 ? T.success : sr >= 60 ? T.warning : T.danger;
    doc.setTextColor(...hexToRgb(col));
    doc.setFont(undefined, 'bold');
    doc.text(`Overall success rate: ${sr}%`, M, y);
  }
}
// ── User Performance Summary ───────────────────────────────────────────────────
async function generateUserPerformanceSummary(doc, sb, _job, p) {
  const { data: summary, error } = await sb.rpc('rpc_get_user_performance_summary', {
    p_user_id: p.user_id,
    p_from: p.date_start,
    p_to: p.date_end
  });
  if (error) throw new Error(`Performance summary failed: ${error.message}`);
  const { data: u } = await sb.from('users').select('full_name').eq('id', p.user_id).single();
  const name = u?.full_name || 'Worker';
  let y = banner(doc, 'WORKER PERFORMANCE SUMMARY', `${name} | ${fmtDate(p.date_start)} — ${fmtDate(p.date_end)}`);
  y = secTitle(doc, `AGGREGATE METRICS — ${name.toUpperCase()}`, y);
  if (!summary) {
    emptyNote(doc, y, 'No data found for this worker in the specified period.');
    return;
  }
  const kw = (PW - 2 * M - 6) / 4;
  kpi(doc, 'WEIGHT POINTS', String(summary.weight_points || 0), '', T.muted, M, y, kw);
  kpi(doc, 'COMPLETED', String(summary.completed_tasks || 0), '', T.muted, M + kw + 2, y, kw);
  kpi(doc, 'FAILED', String(summary.failed_tasks || 0), '', T.muted, M + 2 * (kw + 2), y, kw);
  kpi(doc, 'ON-TIME', String(summary.on_time_tasks || 0), '', T.muted, M + 3 * (kw + 2), y, kw);
  y += 28;
  const activeH = (summary.active_seconds || 0) / 3600;
  const estH = (summary.estimated_seconds || 0) / 3600;
  const hw = (PW - 2 * M - 2) / 2;
  kpi(doc, 'ACTIVE HOURS', `${sf(activeH, 2)}h`, '', T.muted, M, y, hw);
  kpi(doc, 'ESTIMATED HOURS', `${sf(estH, 2)}h`, '', T.muted, M + hw + 2, y, hw);
  y += 28;
  y = secTitle(doc, 'DERIVED METRICS', y);
  const effCol = (summary.timer_efficiency || 0) > 100 ? T.warning : T.success;
  const otCol = (summary.on_time_rate || 0) >= 80 ? T.success : (summary.on_time_rate || 0) >= 60 ? T.warning : T.danger;
  kpi(doc, 'TIMER EFFICIENCY', `${sf(summary.timer_efficiency, 1)}%`, '', effCol, M, y, hw);
  kpi(doc, 'ON-TIME RATE', `${sf(summary.on_time_rate, 1)}%`, '', otCol, M + hw + 2, y, hw);
  y += 28;
  if ((summary.revision_count || 0) > 0) {
    doc.setFontSize(6);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(...hexToRgb(T.warning));
    doc.text(`Revisions: ${summary.revision_count} stage revisits recorded in this period.`, M, y);
  }
}
// ── Pipeline Stage Dwell ───────────────────────────────────────────────────────
async function generatePipelineStageDwell(doc, sb, _job, p) {
  const { data: rows, error } = await sb.rpc('rpc_get_pipeline_stage_dwell', {
    p_pipeline_id: p.pipeline_id,
    p_from: p.date_start,
    p_to: p.date_end
  });
  if (error) throw new Error(`Stage dwell failed: ${error.message}`);
  const { data: pipe } = await sb.from('pipelines').select('name').eq('id', p.pipeline_id).single();
  const pipeName = pipe?.name || 'Pipeline';
  let y = banner(doc, 'STAGE DWELL ANALYSIS', `${pipeName} | ${fmtDate(p.date_start)} — ${fmtDate(p.date_end)}`);
  y = secTitle(doc, 'DWELL TIMES BY STAGE', y);
  if (!rows || rows.length === 0) {
    emptyNote(doc, y, 'No transition data found for this pipeline in the selected period.');
    return;
  }
  y = table(doc, [
    'Stage',
    'Avg',
    'Median',
    'P75',
    'Samples',
    'Reversals',
    'Bottleneck'
  ], [
    42,
    22,
    22,
    22,
    20,
    22,
    20
  ], rows.map((s)=>({
      cells: [
        String(s.stage_name || '—').substring(0, 20),
        fmtSec(s.avg_seconds || 0),
        fmtSec(s.median_seconds || 0),
        fmtSec(s.p75_seconds || 0),
        String(s.sample_count || 0),
        String(s.reversal_count || 0),
        s.is_bottleneck ? 'YES' : 'No'
      ],
      colors: [
        null,
        null,
        null,
        null,
        null,
        (s.reversal_count || 0) > 0 ? T.warning : null,
        s.is_bottleneck ? T.danger : T.success
      ]
    })), y);
  const bottlenecks = rows.filter((s)=>s.is_bottleneck);
  const highReversals = rows.filter((s)=>(s.reversal_count || 0) > 3);
  if (bottlenecks.length > 0) {
    y = chk(doc, y, 15);
    doc.setFontSize(7);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(...hexToRgb(T.danger));
    doc.text('BOTTLENECK STAGES:', M, y);
    y += 4;
    bottlenecks.forEach((s)=>{
      doc.setFontSize(6);
      doc.setFont(undefined, 'normal');
      doc.text(`• ${s.stage_name}: avg ${fmtSec(s.avg_seconds)} dwell time`, M + 2, y);
      y += 4;
    });
  }
  if (highReversals.length > 0) {
    y = chk(doc, y, 10);
    doc.setFontSize(6);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(...hexToRgb(T.warning));
    doc.text(`High reversal activity in ${highReversals.length} stage(s). Review approval criteria.`, M, y);
  }
}
// ── Pipeline Throughput ────────────────────────────────────────────────────────
async function generatePipelineThroughput(doc, sb, _job, p) {
  const { data: rows, error } = await sb.rpc('rpc_get_pipeline_throughput', {
    p_pipeline_id: p.pipeline_id,
    p_period_type: p.period_type || 'month',
    p_n_periods: p.n_periods || 12
  });
  if (error) throw new Error(`Throughput failed: ${error.message}`);
  const { data: pipe } = await sb.from('pipelines').select('name').eq('id', p.pipeline_id).single();
  const pipeName = pipe?.name || 'Pipeline';
  let y = banner(doc, 'PIPELINE THROUGHPUT REPORT', `${pipeName} | ${p.n_periods || 12} ${p.period_type || 'month'}(s)`);
  y = secTitle(doc, 'PERIOD THROUGHPUT ANALYSIS', y);
  if (!rows || rows.length === 0) {
    emptyNote(doc, y, 'No throughput data found for this pipeline.');
    return;
  }
  y = table(doc, [
    'Period',
    'Succeeded',
    'Failed',
    'Success Rate'
  ], [
    50,
    30,
    25,
    55
  ], rows.map((r)=>{
    const sr = r.success_rate || 0;
    return {
      cells: [
        r.period_label || '—',
        String(r.tasks_succeeded || 0),
        String(r.tasks_failed || 0),
        `${sf(sr, 1)}%`
      ],
      colors: [
        null,
        T.success,
        T.danger,
        sr >= 80 ? T.success : sr >= 60 ? T.warning : T.danger
      ]
    };
  }), y);
  const valid = rows.filter((r)=>(r.tasks_succeeded || 0) + (r.tasks_failed || 0) > 0);
  if (valid.length >= 2) {
    y = chk(doc, y, 15);
    const trend = (valid[0].success_rate || 0) - (valid[valid.length - 1].success_rate || 0);
    const col = trend >= 0 ? T.success : T.danger;
    doc.setFontSize(6);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(...hexToRgb(col));
    doc.text(`Success rate ${trend >= 0 ? 'improved' : 'declined'} ${sf(Math.abs(trend), 1)}% over the reporting window.`, M, y);
  }
}
// ── Personnel Comparison ───────────────────────────────────────────────────────
async function generatePersonnelComparison(doc, sb, _job, p) {
  const { data: rows, error } = await sb.rpc('rpc_compare_personnel', {
    p_user_ids: p.user_ids,
    p_from: p.date_start,
    p_to: p.date_end,
    p_salaries: p.salaries || {}
  });
  if (error) throw new Error(`Personnel comparison failed: ${error.message}`);
  let y = banner(doc, 'MULTI-PERSONNEL COMPARISON', `${fmtDate(p.date_start)} — ${fmtDate(p.date_end)}`);
  y = secTitle(doc, 'PERSONNEL METRICS', y);
  if (!rows || rows.length === 0) {
    emptyNote(doc, y, 'No data for the selected workers in this period.');
    return;
  }
  const maxPts = Math.max(...rows.map((w)=>w.weight_points || 0), 1);
  y = table(doc, [
    'Worker',
    'Points',
    'Done',
    'Failed',
    'Hrs',
    'OnTime%',
    'Eff%',
    'Pts/Hr',
    'Rev'
  ], [
    30,
    15,
    14,
    16,
    13,
    17,
    14,
    15,
    16
  ], rows.map((w)=>{
    const otC = (w.on_time_rate || 0) >= 80 ? T.success : (w.on_time_rate || 0) >= 60 ? T.warning : T.danger;
    const effC = (w.timer_efficiency || 0) >= 80 ? T.success : (w.timer_efficiency || 0) >= 60 ? T.warning : T.danger;
    return {
      cells: [
        String(w.full_name || '-').substring(0, 16),
        String(w.weight_points || 0),
        String(w.completed_tasks || 0),
        String(w.failed_tasks || 0),
        sf(w.active_hours, 1),
        `${sf(w.on_time_rate, 1)}%`,
        `${sf(w.timer_efficiency, 1)}%`,
        sf(w.points_per_hour, 1),
        String(w.revision_count || 0)
      ],
      colors: [
        (w.weight_points || 0) === maxPts ? T.success : null,
        null,
        null,
        null,
        null,
        otC,
        effC,
        null,
        null
      ]
    };
  }), y);
  if (p.salaries && Object.keys(p.salaries).length > 0) {
    const costRows = rows.filter((w)=>w.total_cost_usd !== null);
    if (costRows.length > 0) {
      y = chk(doc, y, 20);
      y = subHead(doc, 'Cost Analysis', y);
      y = table(doc, [
        'Worker',
        'Daily Rate',
        'Total Cost',
        'Cost/Point'
      ], [
        50,
        35,
        35,
        40
      ], costRows.map((w)=>({
          cells: [
            String(w.full_name || '-').substring(0, 25),
            `$${sf(w.daily_rate_usd, 2)}`,
            `$${sf(w.total_cost_usd, 2)}`,
            `$${sf(w.cost_per_point, 2)}`
          ]
        })), y);
    }
  }
}
// ── Targets Status ─────────────────────────────────────────────────────────────
async function generateTargetsStatus(doc, sb, job, _p) {
  // Query tables directly — rpc_get_targets_status uses auth.uid() which is unavailable in service-role context
  const { data: targets, error } = await sb.from('pipeline_stage_targets').select('id, stage_id, target_type, target_quantity, target_deadline, created_at, pipeline_stages(name, pipelines(name))').eq('company_id', job.company_id);
  if (error) throw new Error(`Targets fetch failed: ${error.message}`);
  const now = new Date().toISOString();
  const enriched = await Promise.all((targets || []).map(async (t)=>{
    const { count } = await sb.from('pipeline_stage_history').select('id', {
      count: 'exact',
      head: true
    }).eq('to_stage_id', t.stage_id).eq('company_id', job.company_id).gte('transitioned_at', t.created_at);
    const current = count || 0;
    const status = current >= t.target_quantity ? 'hit' : t.target_deadline && now > t.target_deadline ? 'expired' : 'active';
    return {
      pipeline: t.pipeline_stages?.pipelines?.name || '—',
      stage: t.pipeline_stages?.name || '—',
      type: t.target_type || '—',
      target: t.target_quantity,
      current,
      deadline: t.target_deadline,
      status
    };
  }));
  let y = banner(doc, 'OBJECTIVES & SLA REPORT', `Company-wide | As of ${new Date().toLocaleDateString()}`);
  y = secTitle(doc, 'ALL PERFORMANCE TARGETS', y);
  if (enriched.length === 0) {
    emptyNote(doc, y, 'No performance targets configured. Set targets from Pipeline Settings.');
    return;
  }
  const renderGroup = (items, label, col)=>{
    if (items.length === 0) return;
    doc.setFontSize(7);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(...hexToRgb(col));
    doc.text(`${label} (${items.length})`, M, y);
    y += 4;
    y = table(doc, [
      'Pipeline',
      'Stage',
      'Type',
      'Target',
      'Current',
      'Deadline'
    ], [
      38,
      35,
      20,
      18,
      18,
      31
    ], items.map((t)=>({
        cells: [
          t.pipeline,
          t.stage,
          t.type,
          String(t.target),
          String(t.current),
          fmtDate(t.deadline)
        ],
        colors: [
          null,
          null,
          null,
          null,
          t.current >= t.target ? T.success : T.muted,
          null
        ]
      })), y);
    y += 3;
  };
  renderGroup(enriched.filter((t)=>t.status === 'hit'), 'HIT', T.success);
  renderGroup(enriched.filter((t)=>t.status === 'active'), 'ACTIVE', T.primary);
  renderGroup(enriched.filter((t)=>t.status === 'expired'), 'EXPIRED', T.danger);
}
// ── Personal Pulse ─────────────────────────────────────────────────────────────
async function generatePersonalPulse(doc, sb, job, _p) {
  // Query tables directly — rpc_get_personal_pulse uses auth.uid() which is unavailable in service-role context
  const userId = job.requested_by;
  const todayStr = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const monthStr = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const ago30 = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data: u } = await sb.from('users').select('full_name').eq('id', userId).single();
  const name = u?.full_name || 'User';
  const { data: parts } = await sb.from('task_participants').select('task_id').eq('user_id', userId);
  const taskIds = (parts || []).map((p)=>p.task_id);
  let dailyPts = 0, monthlyPts = 0;
  if (taskIds.length > 0) {
    const { data: monthTasks } = await sb.from('tasks').select('weight, completed_at').in('id', taskIds).gte('completed_at', monthStr);
    monthlyPts = (monthTasks || []).reduce((s, t)=>s + (t.weight || 0), 0);
    dailyPts = (monthTasks || []).filter((t)=>t.completed_at >= todayStr).reduce((s, t)=>s + (t.weight || 0), 0);
  }
  const { data: sessions } = await sb.from('task_work_sessions').select('started_at, last_heartbeat_at, status').eq('user_id', userId).gte('started_at', todayStr);
  const activeSecondsToday = (sessions || []).reduce((s, ws)=>s + (new Date(ws.last_heartbeat_at).getTime() - new Date(ws.started_at).getTime()) / 1000, 0);
  const isWorking = (sessions || []).some((ws)=>ws.status === 'active');
  const { count: histCount } = await sb.from('pipeline_stage_history').select('id', {
    count: 'exact',
    head: true
  }).eq('transitioned_by', userId).gte('transitioned_at', ago30);
  const flapRate = taskIds.length > 0 ? (histCount || 0) / taskIds.length : 0;
  let y = banner(doc, 'PERSONAL ACTIVITY SNAPSHOT', `${name} | ${new Date().toLocaleDateString()}`);
  y = secTitle(doc, 'TODAY AT A GLANCE', y);
  const kw = (PW - 2 * M - 4) / 3;
  kpi(doc, 'DAILY POINTS', String(dailyPts), isWorking ? 'Currently active' : 'Not clocked in', isWorking ? T.success : T.muted, M, y, kw);
  kpi(doc, 'MONTHLY POINTS', String(monthlyPts), 'This calendar month', T.muted, M + kw + 2, y, kw);
  kpi(doc, 'SESSION TIME', fmtSec(activeSecondsToday), 'Active today', T.muted, M + 2 * (kw + 2), y, kw);
  y += 28;
  y = secTitle(doc, '30-DAY METRICS', y);
  const flapCol = flapRate > 2 ? T.danger : flapRate > 1.5 ? T.warning : T.success;
  kpi(doc, 'FLAP RATE', sf(flapRate, 2), 'Stage revisit ratio', flapCol, M, y, kw);
  kpi(doc, 'STATUS', isWorking ? 'ACTIVE' : 'OFFLINE', '', isWorking ? T.success : T.muted, M + kw + 2, y, kw);
  y += 28;
  doc.setFontSize(6);
  doc.setFont(undefined, 'italic');
  doc.setTextColor(...hexToRgb(T.muted));
  doc.text('Snapshot captured at moment of report generation. Points reset with calendar boundaries.', M, y);
}
// ══════════════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ══════════════════════════════════════════════════════════════════════════════
serve(async (req)=>{
  const sb = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
  let jId = 'unknown';
  try {
    const { job_id } = await req.json();
    jId = job_id;
    await sb.from('reporting_jobs').update({
      status: 'processing',
      updated_at: new Date().toISOString()
    }).eq('id', job_id);
    const { data: job, error: jobErr } = await sb.from('reporting_jobs').select('*').eq('id', job_id).single();
    if (jobErr) throw new Error(`Job fetch failed: ${jobErr.message}`);
    if (!job) throw new Error('Job not found');
    const p = job.parameters || {};
    const doc = new jsPDF();
    switch(job.report_type){
      case 'general':
      case 'workflow_analysis':
        await generateGeneral(doc, sb, job, p);
        break;
      case 'worker_comparison':
        await generateWorkerComparison(doc, sb, job, p);
        break;
      case 'team_comparison':
        await generateTeamComparison(doc, sb, job, p);
        break;
      case 'user_performance_series':
        await generateUserPerformanceSeries(doc, sb, job, p);
        break;
      case 'user_performance_summary':
        await generateUserPerformanceSummary(doc, sb, job, p);
        break;
      case 'pipeline_stage_dwell':
        await generatePipelineStageDwell(doc, sb, job, p);
        break;
      case 'pipeline_throughput':
        await generatePipelineThroughput(doc, sb, job, p);
        break;
      case 'personnel_comparison':
        await generatePersonnelComparison(doc, sb, job, p);
        break;
      case 'targets_status':
        await generateTargetsStatus(doc, sb, job, p);
        break;
      case 'personal_pulse':
        await generatePersonalPulse(doc, sb, job, p);
        break;
      default:
        await generateGeneral(doc, sb, job, p);
    }
    addFooters(doc, job_id);
    const buf = doc.output('arraybuffer');
    const path = `${job.company_id}/${job_id}.pdf`;
    const { error: uploadErr } = await sb.storage.from('reports').upload(path, buf, {
      contentType: 'application/pdf',
      upsert: true
    });
    if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`);
    await sb.from('reporting_jobs').update({
      status: 'completed',
      file_url: path,
      updated_at: new Date().toISOString()
    }).eq('id', job_id);
    return new Response(JSON.stringify({
      success: true,
      job_id,
      pages: doc.internal.pages.length
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  } catch (err) {
    console.error(`PDF generation failed: ${err.message}`);
    if (jId !== 'unknown') {
      await sb.from('reporting_jobs').update({
        status: 'failed',
        error_log: err.message,
        updated_at: new Date().toISOString()
      }).eq('id', jId);
    }
    return new Response(JSON.stringify({
      error: err.message,
      job_id: jId
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
});
