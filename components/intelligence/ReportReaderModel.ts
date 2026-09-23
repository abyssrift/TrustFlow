export type ReportReaderRecord = {
  id: string;
  report_type?: string | null;
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  completed_at?: string | null;
  file_url?: string | null;
  parameters?: Record<string, any> | null;
  snapshot?: Record<string, any> | null;
  manifest?: Record<string, any> | null;
  report_data?: Record<string, any> | null;
  result?: Record<string, any> | null;
  error_message?: string | null;
  error?: string | null;
};

export function displayReportValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'N/A';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return String(value);
}

function firstValue(record: Record<string, any> | null | undefined, keys: string[]) {
  for (const key of keys) {
    const value = record?.[key];
    if (value !== null && value !== undefined && value !== '') return value;
  }
  return null;
}

function asList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(item => typeof item === 'string' ? item : item?.text || item?.title || item?.label || '').filter(Boolean);
}

export function getReportReaderModel(report: ReportReaderRecord) {
  const snapshot = report.snapshot || report.report_data || report.result || {};
  const manifest = report.manifest || snapshot.manifest || {};
  const parameters = report.parameters || {};
  const period = firstValue(manifest, ['period', 'period_label']) || firstValue(snapshot, ['period', 'period_label']) ||
    (parameters.date_start || parameters.date_end
      ? `${displayReportValue(parameters.date_start)} → ${displayReportValue(parameters.date_end)}`
      : parameters.days ? `${parameters.days} day window` : 'Period not specified');
  const scope = firstValue(manifest, ['scope', 'scope_label']) || firstValue(snapshot, ['scope', 'scope_label']) ||
    parameters.scope || parameters.pipeline_name || parameters.team_name || 'Company scope';
  const freshness = firstValue(manifest, ['freshness', 'as_of', 'generated_at']) || report.completed_at || report.updated_at || report.created_at;
  const methodology = firstValue(manifest, ['methodology', 'methodology_label']) || firstValue(snapshot, ['methodology', 'methodology_label']);
  const findings = asList(firstValue(snapshot, ['findings', 'insights', 'narrative']));
  const actions = asList(firstValue(snapshot, ['actions', 'recommended_actions', 'next_steps']));
  const leaders = asList(firstValue(snapshot, ['leaders', 'leader', 'top_performers']));
  const metrics = Array.isArray(snapshot.metrics) ? snapshot.metrics : [];
  const noLeader = leaders.length === 0 || (metrics.length > 0 && metrics.every((metric: any) => Number(metric.value ?? metric.points) === 0));
  const freshnessLabel = freshness ? new Date(freshness).toLocaleString() : 'N/A';
  return {
    title: firstValue(manifest, ['title', 'name']) || `${(report.report_type || 'Report').replace(/_/g, ' ')}`,
    period: displayReportValue(period),
    scope: displayReportValue(scope),
    freshness: freshness && freshnessLabel !== 'Invalid Date' ? freshnessLabel : 'N/A',
    methodology: methodology ? String(methodology) : 'Methodology details were not included in this snapshot.',
    findings,
    actions,
    leaders,
    metrics,
    noLeader,
    requiredSourceError: firstValue(manifest, ['required_source_error', 'source_error']) || firstValue(snapshot, ['required_source_error', 'source_error']),
  };
}
