import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import type { PlanCatalogEntry } from '@/lib/planLimits';

export type BillingPlanState = {
  planCode: string;
  planName: string;
  status: string;
  storageUsedBytes: number;
  storageLimitBytes: number | null; // null = unlimited
  /** Raw limits jsonb for the caller's own plan — pass to getAnalyticsLimits(). */
  limits: Record<string, any>;
  /** Every active plan (code/name/limits), sorted by sort_order — pass to requiredPlan(). */
  catalog: PlanCatalogEntry[];
  loading: boolean;
};

export function useBillingPlan(): BillingPlanState {
  const { profile } = useAuth();
  const [planCode, setPlanCode] = useState('free');
  const [planName, setPlanName] = useState('Free');
  const [status, setStatus]     = useState('active');
  const [storageUsedBytes, setStorageUsedBytes] = useState(0);
  const [storageLimitBytes, setStorageLimitBytes] = useState<number | null>(null);
  const [limits, setLimits] = useState<Record<string, any>>({});
  const [catalog, setCatalog] = useState<PlanCatalogEntry[]>([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    if (!profile?.company_id) { setLoading(false); return; }
    let cancelled = false;

    (async () => {
      const [{ data: cb }, { data: plans }] = await Promise.all([
        supabase.from('company_billing').select('plan_code, status, storage_used_bytes').maybeSingle(),
        supabase.from('billing_plans').select('code, name, sort_order, limits').eq('is_active', true).order('sort_order'),
      ]);

      if (cancelled) return;
      const code = cb?.plan_code ?? 'free';
      const plan = plans?.find(p => p.code === code);
      const planLimits = (plan?.limits as Record<string, any>) ?? {};
      const maxStorage = planLimits.max_storage_bytes;

      setPlanCode(code);
      setPlanName(plan?.name ?? 'Free');
      setStatus(cb?.status ?? 'active');
      setStorageUsedBytes(cb?.storage_used_bytes ?? 0);
      setStorageLimitBytes(maxStorage == null ? null : Number(maxStorage));
      setLimits(planLimits);
      setCatalog((plans ?? []).map(p => ({ code: p.code, name: p.name, limits: (p.limits as Record<string, any>) ?? {} })));
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [profile?.company_id]);

  return { planCode, planName, status, storageUsedBytes, storageLimitBytes, limits, catalog, loading };
}
