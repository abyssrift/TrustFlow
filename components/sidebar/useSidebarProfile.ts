import { supabase } from '@/lib/supabase';
import { useEffect, useMemo, useState } from 'react';
import { displayNameFromSession } from './helpers';

export function useSidebarProfile(session: any) {
  const [profileAvatarUrl, setProfileAvatarUrl] = useState<string | null>(null);
  const [profileName, setProfileName] = useState('Profile');

  useEffect(() => {
    const fetchProfile = async () => {
      const fallbackName = displayNameFromSession(session);
      setProfileName(fallbackName);
      setProfileAvatarUrl(session?.user?.user_metadata?.avatar_url || null);

      if (!session?.user?.id) return;

      const { data, error } = await supabase
        .from('users')
        .select('avatar_url, full_name, display_name')
        .eq('id', session.user.id)
        .maybeSingle();
      if (error) return;

      setProfileAvatarUrl(data?.avatar_url || session?.user?.user_metadata?.avatar_url || null);
      setProfileName(data?.display_name || data?.full_name || fallbackName);
    };

    fetchProfile();
  }, [session]);

  const profileLabel = useMemo(() => profileName || displayNameFromSession(session), [profileName, session]);

  return { profileAvatarUrl, profileLabel };
}
