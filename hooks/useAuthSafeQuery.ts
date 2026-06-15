import { supabase, isAuthError, triggerAuthError } from '@/lib/supabase';

/**
 * Wraps a Supabase query and automatically handles 401/auth errors
 * by triggering a sign-out
 */
export const useAuthSafeQuery = () => {
  const executeQuery = async <T,>(
    queryFn: () => Promise<{ data: T | null; error: any }>,
    errorContext?: string
  ): Promise<{ data: T | null; error: any }> => {
    try {
      const result = await queryFn();

      // Check for auth errors
      if (result.error && isAuthError(result.error)) {
        console.error(`[AuthSafeQuery] Auth error in ${errorContext || 'query'}:`, result.error);
        triggerAuthError();
        return { data: null, error: result.error };
      }

      return result;
    } catch (err: any) {
      if (isAuthError(err)) {
        console.error(`[AuthSafeQuery] Auth error in ${errorContext || 'query'}:`, err);
        triggerAuthError();
        return { data: null, error: err };
      }
      throw err;
    }
  };

  return { executeQuery };
};
