// Web-only — runs on every fresh session and attempts to register a push
// subscription if the user wants web push but doesn't have an active one.
//
// The browser prompts for permission the first time per origin; on subsequent
// loads with permission already granted the call is silent. If the user has
// blocked notifications in the browser, the WebPushPrompt banner takes over.
import { useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { usePushSubscription } from '@/hooks/usePushSubscription';

export function usePushAutoSubscribe() {
  const { user, initialized } = useAuth();
  const { state, subscribe } = usePushSubscription();
  const attemptedForUser = useRef<string | null>(null);

  useEffect(() => {
    if (!initialized || !user) return;
    if (state === 'loading' || state === 'unsupported') return;
    if (state === 'subscribed') return;
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'denied') return;
    if (attemptedForUser.current === user.id) return;

    attemptedForUser.current = user.id;

    (async () => {
      const { data } = await supabase
        .from('notification_preferences')
        .select('push_web_enabled')
        .eq('user_id', user.id)
        .maybeSingle();

      // Respect explicit opt-out.
      if (data && data.push_web_enabled === false) return;

      await subscribe();
    })();
  }, [user?.id, initialized, state, subscribe]);
}
