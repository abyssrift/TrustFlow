import { supabase } from '@/lib/supabase';
import { Platform } from 'react-native';

const APP_URL = process.env.EXPO_PUBLIC_APP_URL || 'https://app.trustflow.io';

export function getOAuthUrl(provider: string): string {
  const baseUrl = `${APP_URL}/api/import-oauth`;
  return `${baseUrl}?provider=${provider}&state=`;
}

export async function startOAuthFlow(provider: string, userId: string): Promise<void> {
  const oauthUrl = getOAuthUrl(provider) + encodeURIComponent(userId);
  const redirectUri = 'trustflow://import-callback';

  if (Platform.OS === 'web') {
    window.open(oauthUrl, '_blank', 'width=600,height=700');
  } else {
    const { openAuthSessionAsync } = await import('expo-web-browser');
    await openAuthSessionAsync(oauthUrl, redirectUri);
  }
}

export async function deleteConnection(provider: string): Promise<void> {
  const { error } = await supabase
    .from('import_connections')
    .delete()
    .eq('provider', provider);

  if (error) throw error;
}
