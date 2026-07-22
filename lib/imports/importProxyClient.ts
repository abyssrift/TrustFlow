import { supabase } from '@/lib/supabase';

// The caller is identified by their JWT (forwarded automatically by
// functions.invoke), so no user id travels in the body.
export async function fetchViaProxy(
  provider: string,
  resource: 'projects' | 'tasks',
  params?: Record<string, string>
): Promise<any> {
  const { data, error } = await supabase.functions.invoke('import-proxy', {
    body: { provider, resource, params: params ?? {} },
  });
  if (error) throw new Error(`Import proxy error: ${error.message}`);
  return data;
}

// Persist an api-key / token connection (Odoo credentials, Trello token).
export async function connectViaProxy(
  provider: string,
  params: Record<string, string | undefined>
): Promise<void> {
  const { error } = await supabase.functions.invoke('import-proxy', {
    body: { provider, resource: 'connect', params },
  });
  if (error) throw new Error(`Connect failed: ${error.message}`);
}
