import React, { createContext, useContext, useEffect, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
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
    // 1. Initial Load
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        Promise.all([fetchPermissions(), fetchRoles(), fetchProfile(session.user.id)]);
      } else {
        setInitialized(true);
      }
    });

    // 2. Listen for Auth State Changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          Promise.all([fetchPermissions(), fetchRoles(), fetchProfile(session.user.id)]);
        } else {
          setProfile(null);
          setPermissions([]);
          setRoleIds([]);
          setInitialized(true);
        }
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const fetchProfile = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();
      
      if (error) {
        if (error.code === 'PGRST116') {
          console.warn('Profile missing for user, attempting repair...');
          const { data: repairData, error: repairError } = await supabase.rpc('rpc_repair_profile');
          if (repairError) {
            console.error('Failed to repair profile:', repairError);
          } else {
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
        console.error('Error fetching profile:', error);
        return;
      }
      setProfile(data);
    } catch (err) {
      console.error('Unexpected error fetching profile:', err);
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
        console.error('Error fetching permissions:', error);
        return;
      }
      const perms = (data as { key: string }[]).map(p => p.key);
      setPermissions(perms);
    } catch (err) {
      console.error('Unexpected error fetching permissions:', err);
    } finally {
      setInitialized(true);
    }
  };

  const fetchRoles = async () => {
    try {
      const { data, error } = await supabase.rpc('get_my_roles');
      if (error) {
        console.error('Error fetching roles:', error);
        return;
      }
      const ids = (data as { id: string }[]).map(r => r.id);
      setRoleIds(ids);
    } catch (err) {
      console.error('Unexpected error fetching roles:', err);
    }
  };

  const hasPermission = (key: string) => permissions.includes(key);

  const hasRole = (roleId: string) => roleIds.includes(roleId);

  const signOut = async () => {
    try {
      console.log('Initiating sign out...');
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.error('Error during Supabase sign out:', error);
      }
      setSession(null);
      setUser(null);
      setProfile(null);
      setPermissions([]);
      setRoleIds([]);
      console.log('Sign out complete, state cleared.');
    } catch (err) {
      console.error('Unexpected error during sign out:', err);
      setSession(null);
      setUser(null);
      setProfile(null);
      setPermissions([]);
      setRoleIds([]);
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
