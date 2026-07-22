export type AnalyticsLimits = {
  maxDays: number | null;    // null = unlimited
  throughput: boolean;       // throughput trend chart
  funnel: boolean;           // conversion funnel (rpc_get_organizational_audit)
  personnel: boolean;        // personnel comparison tab
  personnelExport: boolean;  // CSV export from personnel tab
  reports: boolean;          // access to report generation
};

const FREE_DEFAULTS: AnalyticsLimits = {
  maxDays: 30, throughput: false, funnel: false, personnel: false, personnelExport: false, reports: false,
};

/** Plan definitions live in billing_plans.limits (admin-editable — see #58); this
 * just reads the analytics_* keys off whatever `limits` jsonb useBillingPlan() fetched. */
export function getAnalyticsLimits(limits: Record<string, any> | null | undefined): AnalyticsLimits {
  if (!limits) return FREE_DEFAULTS;
  return {
    // null is a meaningful value here (unlimited), so check presence rather than using ??
    maxDays:         'analytics_max_days' in limits ? limits.analytics_max_days : FREE_DEFAULTS.maxDays,
    throughput:      limits.analytics_throughput ?? FREE_DEFAULTS.throughput,
    funnel:          limits.analytics_funnel ?? FREE_DEFAULTS.funnel,
    personnel:       limits.analytics_personnel ?? FREE_DEFAULTS.personnel,
    personnelExport: limits.analytics_personnel_export ?? FREE_DEFAULTS.personnelExport,
    reports:         limits.analytics_reports ?? FREE_DEFAULTS.reports,
  };
}

const ANALYTICS_LIMIT_KEY: Record<keyof AnalyticsLimits, string> = {
  maxDays: 'analytics_max_days', throughput: 'analytics_throughput', funnel: 'analytics_funnel',
  personnel: 'analytics_personnel', personnelExport: 'analytics_personnel_export', reports: 'analytics_reports',
};

export type PlanCatalogEntry = { code: string; name: string; limits: Record<string, any> };

/** Returns the display name of the cheapest plan (by sort_order) that unlocks a
 * given analytics feature, from the live plan catalog (see useBillingPlan().catalog). */
export function requiredPlan(feature: keyof AnalyticsLimits, catalog: PlanCatalogEntry[]): string {
  const key = ANALYTICS_LIMIT_KEY[feature];
  const match = catalog.find(p => !!p.limits?.[key]);
  return match?.name ?? 'Enterprise';
}
