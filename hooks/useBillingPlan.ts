import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';

export type BillingPlanState = {
  planCode: string;
  status: string;
  loading: boolean;
};

export function useBillingPlan(): BillingPlanState {
  const { profile } = useAuth();
  const [planCode, setPlanCode] = useState('free');
  const [status, setStatus]     = useState('active');
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    if (!profile?.company_id) { setLoading(false); return; }
    supabase
      .from('company_billing')
      .select('plan_code, status')
      .maybeSingle()
      .then(({ data }) => {
        if (data) { setPlanCode(data.plan_code); setStatus(data.status); }
      })
      .finally(() => setLoading(false));
  }, [profile?.company_id]);

  return { planCode, status, loading };
}
