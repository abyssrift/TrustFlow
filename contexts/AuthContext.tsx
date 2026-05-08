import React, { createContext, useContext, useEffect, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import { supabase } from '../lib/supabase';

type AuthContextType = {
  session: Session | null;
  user: User | null;
  profile: any | null;
  permissions: string[];
  /** UUIDs of the roles assigned to the current user */
  roleIds: string[];
  initialized: boolean;
  hasPermission: (key: string) => boolean;
  /** Returns true if the user holds the given role UUID */
  hasRole: (roleId: string) => boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  profile: null,
  permissions: [],
  roleIds: [],
  initialized: false,
  hasPermission: () => false,
  hasRole: () => false,
  signOut: async () => {},
  refreshProfile: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<any | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [initialized, setInitialized] = useState<boolean>(false);

  useEffect(() => {
    let mounted = true;

    const initializeAuth = async () => {
      try {
        if (Platform.OS !== 'web') {
          console.log('[AuthContext] [Native] Initializing session check...');
        }
        
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (error) {
          console.error('[AuthContext] Session error:', error);
          if (mounted) setInitialized(true);
          return;
        }

        if (mounted) {
          setSession(session);
          setUser(session?.user ?? null);
          
          // CRITICAL: We set initialized=true immediately so the RootLayout can redirect.
          // Background data can load while the user is being navigated.
          setInitialized(true);

          if (session?.user) {
            console.log('[AuthContext] [Native] Session found, loading metadata in background');
            Promise.all([
              fetchPermissions(),
              fetchRoles(),
              fetchProfile(session.user.id)
            ]);
          }
        }
      } catch (err) {
        console.error('[AuthContext] Initialization crash:', err);
        if (mounted) setInitialized(true);
      }
    };

    initializeAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (Platform.OS !== 'web') {
          console.log('[AuthContext] [Native] onAuthStateChange:', event, !!session);
        }
        
        if (mounted) {
          setSession(session);
          setUser(session?.user ?? null);
          
          if (session?.user) {
            // Trigger background fetches
            Promise.all([
              fetchPermissions(),
              fetchRoles(),
              fetchProfile(session.user.id)
            ]);
          } else {
            setProfile(null);
            setPermissions([]);
            setRoleIds([]);
          }
          
          // Ensure initialized is true after any auth state change
          setInitialized(true);
        }
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const fetchProfile = async (userId: string) => {
    try {
      if (Platform.OS !== 'web') console.log('[AuthContext] [Native] Fetching profile...');
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();
      
      if (error) {
        if (error.code === 'PGRST116') {
          console.warn('[AuthContext] Profile missing, repairing...');
          const { error: repairError } = await supabase.rpc('rpc_repair_profile');
          if (!repairError) {
            const { data: retryData } = await supabase
              .from('users')
              .select('*')
              .eq('id', userId)
              .single();
            if (retryData) {
              setProfile(retryData);
              return;
            }
          }
        }
        console.error('[AuthContext] Profile error:', error);
        return;
      }
      setProfile(data);
    } catch (err) {
      console.error('[AuthContext] Unexpected profile error:', err);
    }
  };

  const refreshProfile = async () => {
    if (user) {
      await fetchProfile(user.id);
    }
  };

  const fetchPermissions = async () => {
    try {
      const { data, error } = await supabase.rpc('get_my_permissions');
      if (error) {
        console.error('[AuthContext] Permissions error:', error);
        return;
      }
      const perms = (data as { key: string }[]).map(p => p.key);
      setPermissions(perms);
    } catch (err) {
      console.error('[AuthContext] Unexpected permissions error:', err);
    }
  };

  const fetchRoles = async () => {
    try {
      const { data, error } = await supabase.rpc('get_my_roles');
      if (error) {
        console.error('[AuthContext] Roles error:', error);
        return;
      }
      const ids = (data as { id: string }[]).map(r => r.id);
      setRoleIds(ids);
    } catch (err) {
      console.error('[AuthContext] Unexpected roles error:', err);
    }
  };

  const hasPermission = (key: string) => permissions.includes(key);

  const hasRole = (roleId: string) => roleIds.includes(roleId);

  const signOut = async () => {
    try {
      if (Platform.OS !== 'web') console.log('[AuthContext] [Native] Sign out initiated');
      await supabase.auth.signOut();
      setSession(null);
      setUser(null);
      setProfile(null);
      setPermissions([]);
      setRoleIds([]);
      setInitialized(true);
    } catch (err) {
      console.error('[AuthContext] Sign out error:', err);
      setSession(null);
      setUser(null);
      setProfile(null);
      setPermissions([]);
      setRoleIds([]);
      setInitialized(true);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        profile,
        permissions,
        roleIds,
        initialized,
        hasPermission,
        hasRole,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
