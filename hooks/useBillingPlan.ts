import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';

export type BillingPlanState = {
  planCode: string;
  planName: string;
  status: string;
  storageUsedBytes: number;
  storageLimitBytes: number | null; // null = unlimited
  loading: boolean;
};

export function useBillingPlan(): BillingPlanState {
  const { profile } = useAuth();
  const [planCode, setPlanCode] = useState('free');
  const [planName, setPlanName] = useState('Free');
  const [status, setStatus]     = useState('active');
  const [storageUsedBytes, setStorageUsedBytes] = useState(0);
  const [storageLimitBytes, setStorageLimitBytes] = useState<number | null>(null);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    if (!profile?.company_id) { setLoading(false); return; }
    let cancelled = false;

    (async () => {
      const { data: cb } = await supabase
        .from('company_billing')
        .select('plan_code, status, storage_used_bytes')
        .maybeSingle();

      const code = cb?.plan_code ?? 'free';
      const { data: plan } = await supabase
        .from('billing_plans')
        .select('name, limits')
        .eq('code', code)
        .maybeSingle();

      if (cancelled) return;
      const maxStorage = (plan?.limits as any)?.max_storage_bytes;
      setPlanCode(code);
      setPlanName(plan?.name ?? 'Free');
      setStatus(cb?.status ?? 'active');
      setStorageUsedBytes(cb?.storage_used_bytes ?? 0);
      setStorageLimitBytes(maxStorage == null ? null : Number(maxStorage));
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [profile?.company_id]);

  return { planCode, planName, status, storageUsedBytes, storageLimitBytes, loading };
}
