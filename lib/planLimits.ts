export type AnalyticsLimits = {
  maxDays: number | null;    // null = unlimited
  throughput: boolean;       // throughput trend chart
  funnel: boolean;           // conversion funnel (rpc_get_organizational_audit)
  personnel: boolean;        // personnel comparison tab
  personnelExport: boolean;  // CSV export from personnel tab
  reports: boolean;          // access to report generation
};

const LIMITS: Record<string, AnalyticsLimits> = {
  free:       { maxDays: 30,   throughput: false, funnel: false, personnel: false, personnelExport: false, reports: false },
  pro:        { maxDays: 90,   throughput: true,  funnel: false, personnel: true,  personnelExport: false, reports: true  },
  business:   { maxDays: 365,  throughput: true,  funnel: true,  personnel: true,  personnelExport: true,  reports: true  },
  enterprise: { maxDays: null, throughput: true,  funnel: true,  personnel: true,  personnelExport: true,  reports: true  },
};

const PLAN_ORDER = ['free', 'pro', 'business', 'enterprise'];

export function getAnalyticsLimits(planCode: string): AnalyticsLimits {
  return LIMITS[planCode] ?? LIMITS.free;
}

/** Returns the minimum plan name that unlocks a given feature. */
export function requiredPlan(feature: keyof AnalyticsLimits): string {
  for (const code of PLAN_ORDER) {
    if (LIMITS[code][feature]) return code.charAt(0).toUpperCase() + code.slice(1);
  }
  return 'Enterprise';
}
