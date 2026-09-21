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
  /** A failed or incomplete billing read is never a usable entitlement. */
  error: unknown | null;
  ready: boolean;
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
  const [error, setError] = useState<unknown | null>(null);

  useEffect(() => {
    if (!profile?.company_id) {
      setPlanCode('free');
      setPlanName('Free');
      setStatus('active');
      setStorageUsedBytes(0);
      setStorageLimitBytes(null);
      setLimits({});
      setCatalog([]);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    // Do not let a previous company's entitlement remain usable while the
    // replacement company is being read. Capability checks fail closed while
    // this request is loading.
    setLimits({});
    setCatalog([]);

    (async () => {
      try {
        const [{ data: cb, error: billingError }, { data: plans, error: plansError }] = await Promise.all([
        supabase.from('company_billing').select('plan_code, status, storage_used_bytes').maybeSingle(),
        supabase.from('billing_plans').select('code, name, sort_order, limits').eq('is_active', true).order('sort_order'),
        ]);
        if (billingError) throw billingError;
        if (plansError) throw plansError;

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
      } catch (err) {
        if (!cancelled) setError(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [profile?.company_id]);

  const ready = !loading && !error && !!profile?.company_id;
  return { planCode, planName, status, storageUsedBytes, storageLimitBytes, limits, catalog, loading, error, ready };
}
