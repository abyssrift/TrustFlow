import { supabase, supabaseUrl } from '@/lib/supabase';
import { Platform } from 'react-native';
import { connectViaProxy } from './importProxyClient';

const APP_URL = process.env.EXPO_PUBLIC_APP_URL || 'https://app.trustflow.io';
const TRELLO_KEY = process.env.EXPO_PUBLIC_TRELLO_API_KEY || '';

// The OAuth handler is a Supabase Edge Function, not a route on the app host —
// so this must target functions/v1, or the browser lands on the app's 404 page.
export function getOAuthUrl(provider: string): string {
  return `${supabaseUrl}/functions/v1/import-oauth?provider=${provider}&state=`;
}

export async function startOAuthFlow(provider: string, userId: string): Promise<void> {
  if (provider === 'trello') return startTrelloFlow();
  return startJiraFlow(userId);
}

// ── Jira: server-side authorization-code flow via the import-oauth function ──
async function startJiraFlow(userId: string): Promise<void> {
  const url = getOAuthUrl('jira') + encodeURIComponent(userId);
  const successPrefix = `${APP_URL}/imports`;
  if (Platform.OS === 'web') {
    const popup = window.open(url, '_blank', 'width=600,height=700');
    await waitForRedirect(popup, successPrefix); // resolves once the callback lands
  } else {
    const { openAuthSessionAsync } = await import('expo-web-browser');
    await openAuthSessionAsync(url, 'trustflow://import-callback');
  }
}

// ── Trello: OAuth 1.0a token flow — the token comes back in the URL fragment,
// which never reaches our server, so we capture it client-side and store it. ──
async function startTrelloFlow(): Promise<void> {
  if (!TRELLO_KEY) throw new Error('Trello API key not configured (EXPO_PUBLIC_TRELLO_API_KEY).');
  const returnUrl = Platform.OS === 'web' ? `${APP_URL}/imports` : 'trustflow://import-callback';
  const authUrl = 'https://trello.com/1/authorize'
    + `?expiration=never&scope=read&response_type=token&name=TrustFlow`
    + `&key=${TRELLO_KEY}&return_url=${encodeURIComponent(returnUrl)}`;

  let token: string | null = null;
  if (Platform.OS === 'web') {
    token = await captureTrelloTokenWeb(authUrl, returnUrl);
  } else {
    const { openAuthSessionAsync } = await import('expo-web-browser');
    const result = await openAuthSessionAsync(authUrl, returnUrl);
    if (result.type === 'success' && result.url) token = extractToken(result.url);
  }
  if (!token) throw new Error('Trello authorization was cancelled.');
  await connectViaProxy('trello', { token });
}

function extractToken(url: string): string | null {
  return url.match(/[#&]token=([^&]+)/)?.[1] ?? null;
}

// Poll the popup until it redirects back to our (same-origin) return_url, then
// read the token from its fragment. Cross-origin reads throw until then.
function captureTrelloTokenWeb(authUrl: string, returnUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    const popup = window.open(authUrl, '_blank', 'width=700,height=800');
    if (!popup) return resolve(null);
    const timer = setInterval(() => {
      try {
        if (popup.closed) { clearInterval(timer); return resolve(null); }
        if (popup.location.href.startsWith(returnUrl)) {
          const token = extractToken(popup.location.hash);
          clearInterval(timer);
          popup.close();
          resolve(token);
        }
      } catch { /* cross-origin until Trello redirects back — keep polling */ }
    }, 500);
  });
}

// Resolve when the OAuth popup reaches our success URL (or the user closes it).
function waitForRedirect(popup: Window | null, successPrefix: string): Promise<void> {
  return new Promise((resolve) => {
    if (!popup) return resolve();
    const timer = setInterval(() => {
      try {
        if (popup.closed) { clearInterval(timer); return resolve(); }
        if (popup.location.href.startsWith(successPrefix)) {
          clearInterval(timer);
          popup.close();
          resolve();
        }
      } catch { /* cross-origin until the callback redirects back */ }
    }, 500);
  });
}

// Returns the caller's stored connection for a provider (RLS-scoped), or null.
// A non-null result means creds are already stored server-side, so the connect
// form can be skipped and projects fetched directly.
export async function getConnection(provider: string): Promise<{ instance_url: string | null } | null> {
  const { data } = await supabase
    .from('import_connections')
    .select('instance_url')
    .eq('provider', provider)
    .maybeSingle();
  return data ?? null;
}

export async function deleteConnection(provider: string): Promise<void> {
  const { error } = await supabase
    .from('import_connections')
    .delete()
    .eq('provider', provider);
  if (error) throw error;
}
