import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

export const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
export const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

// SSR-safe storage selection
const authStorage = Platform.OS === 'web' && typeof window === 'undefined'
  ? undefined
  : AsyncStorage;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: authStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Global callback for auth errors (called from AuthContext when 401 detected)
let authErrorCallback: (() => void) | null = null;

export const setAuthErrorCallback = (callback: () => void) => {
  authErrorCallback = callback;
};

export const triggerAuthError = () => {
  if (authErrorCallback) {
    authErrorCallback();
  }
};

// Check if an error is an auth error (401, invalid token, etc.)
export const isAuthError = (error: any): boolean => {
  if (!error) return false;
  const status = error?.status || error?.statusCode;
  const message = error?.message || '';

  return status === 401 ||
         message.includes('Invalid JWT') ||
         message.includes('JWT expired') ||
         message.includes('invalid_grant') ||
         message.includes('session_not_found');
};

// Tells Supabase Auth to continuously refresh the session automatically
// if the app is in the foreground. When this is added, you will continue
// to receive `onAuthStateChange` events with the `TOKEN_REFRESHED` or
// `SIGNED_OUT` event if the user's session is terminated. This should
// only be registered once.
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});
