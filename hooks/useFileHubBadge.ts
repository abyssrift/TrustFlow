import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { useCallback, useEffect, useState } from 'react';

export function useFileHubBadge() {
  const { user } = useAuth();
  const [inboxUnread, setInboxUnread] = useState(0);

  const fetchCount = useCallback(async () => {
    if (!user?.id) return;
    const { data } = await supabase.rpc('rpc_filehub_unread_count');
    setInboxUnread(typeof data === 'number' ? data : 0);
  }, [user?.id]);

  useEffect(() => {
    fetchCount();
    if (!user?.id) return;

    const channel = supabase
      .channel(`filehub_badge:${user.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'filehub_recipients', filter: `user_id=eq.${user.id}` },
        () => { setInboxUnread((prev) => prev + 1); }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'filehub_recipients', filter: `user_id=eq.${user.id}` },
        () => { fetchCount(); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user?.id, fetchCount]);

  return { inboxUnread };
}
