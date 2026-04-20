import React, { createContext, useContext, useEffect, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

type AuthContextType = {
  session: Session | null;
  user: User | null;
  permissions: string[];
  initialized: boolean;
  hasPermission: (key: string) => boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  permissions: [],
  initialized: false,
  hasPermission: () => false,
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [initialized, setInitialized] = useState<boolean>(false);

  useEffect(() => {
    // 1. Initial Load
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchPermissions();
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
          fetchPermissions();
        } else {
          setPermissions([]);
          setInitialized(true);
        }
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, []);

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

  const hasPermission = (key: string) => {
    // Note: the backend `get_my_permissions` automatically includes all permissions 
    // for owners. But for extra safety on frontend, we just check the array.
    return permissions.includes(key);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        permissions,
        initialized,
        hasPermission,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
