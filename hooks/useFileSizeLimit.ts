import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';

// ponytail: fetched once per mount; re-fetches when company changes
export function useFileSizeLimit() {
  const { profile } = useAuth();
  const [maxBytes, setMaxBytes] = useState<number | null | undefined>(undefined); // undefined = loading

  useEffect(() => {
    if (!profile?.company_id) { setMaxBytes(null); return; }
    supabase.rpc('rpc_my_plan_limits')
      .then(({ data }) => {
        const v = (data as any)?.max_file_bytes ?? null;
        setMaxBytes(typeof v === 'number' ? v : null);
      });
  }, [profile?.company_id]);

  return maxBytes; // null = unlimited, number = cap in bytes, undefined = still loading
}
