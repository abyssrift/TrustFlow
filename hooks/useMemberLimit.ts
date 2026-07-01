import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';

export type MemberLimit = {
  current: number;
  limit: number | null; // null = unlimited
  allowed: boolean;
};

export function useMemberLimit() {
  const { profile } = useAuth();
  const [data, setData] = useState<MemberLimit | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile?.company_id) { setLoading(false); return; }
    supabase.rpc('rpc_check_plan_limit', { p_resource: 'members' })
      .then(({ data: res }) => { if (res) setData(res as MemberLimit); })
      .finally(() => setLoading(false));
  }, [profile?.company_id]);

  const atLimit = !loading && data != null && data.limit != null && data.current >= data.limit;
  const remaining = data?.limit == null ? null : Math.max(0, data.limit - data.current);

  return { data, loading, atLimit, remaining };
}
