import { supabase } from '@/lib/supabase';
import type { AuthPayload } from './types';

export async function fetchViaProxy(
  provider: string,
  resource: 'projects' | 'tasks',
  auth: AuthPayload,
  params?: Record<string, string>
): Promise<any> {
  const { data, error } = await supabase.functions.invoke('import-proxy', {
    body: {
      provider,
      resource,
      params: { ...params, ...auth },
      userId: auth.tokens ? undefined : undefined,
    },
  });

  if (error) throw new Error(`Import proxy error: ${error.message}`);
  return data;
}
