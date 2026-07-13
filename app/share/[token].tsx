import { supabaseUrl } from '@/lib/supabase';
import { formatFileSize, getFileIcon } from '@/lib/taskFileHelpers';
import { useThemeColors } from '@/hooks/useThemeColors';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Stack, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Text, TouchableOpacity, View } from 'react-native';

type ResolvedShare = {
  name: string;
  mime_type: string | null;
  size_bytes: number;
  signed_url: string;
  expires_at: string;
};

type ResolveError = 'not_found' | 'expired' | 'revoked' | 'missing_token' | 'storage_error' | 'network';

function ErrorState({ error }: { error: ResolveError }) {
  const colors = useThemeColors();
  const copy: Record<ResolveError, { title: string; body: string }> = {
    not_found: { title: 'Link Not Found', body: 'This share link doesn’t exist, or the file behind it was removed.' },
    expired: { title: 'Link Expired', body: 'This share link’s expiry date has passed. Ask the sender for a new one.' },
    revoked: { title: 'Link Revoked', body: 'The sender has turned off this share link.' },
    missing_token: { title: 'Invalid Link', body: 'This link is malformed.' },
    storage_error: { title: 'Something Went Wrong', body: 'The file couldn’t be retrieved. Try again in a moment.' },
    network: { title: 'Something Went Wrong', body: 'Couldn’t reach the server. Check your connection and try again.' },
  };
  const { title, body } = copy[error];
  return (
    <View className="bg-surface-card p-10 rounded-[2.5rem] border border-surface-border items-center w-full max-w-sm">
      <View className="w-14 h-14 bg-state-danger/10 rounded-full border border-state-danger/20 items-center justify-center mb-4">
        <FontAwesome name="link" size={22} color={colors.danger} />
      </View>
      <Text className="text-typography-main text-xl font-black mb-2 text-center">{title}</Text>
      <Text className="text-typography-muted text-sm text-center leading-relaxed">{body}</Text>
    </View>
  );
}

function SharePageContent({ token }: { token: string }) {
  const colors = useThemeColors();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ResolveError | null>(null);
  const [file, setFile] = useState<ResolvedShare | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`${supabaseUrl}/functions/v1/filehub-share-resolve?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) { setError((body?.error as ResolveError) ?? 'network'); return; }
        setFile(body as ResolvedShare);
      })
      .catch(() => { if (!cancelled) setError('network'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token]);

  const icon = file ? getFileIcon(file.mime_type, colors) : null;

  return (
    <View className="flex-1 bg-surface-background items-center justify-center px-6">
      {loading ? (
        <ActivityIndicator size="large" color={colors.primary} />
      ) : error ? (
        <ErrorState error={error} />
      ) : file ? (
        <View className="bg-surface-card p-10 rounded-[2.5rem] border border-surface-border items-center w-full max-w-sm">
          <View className="w-16 h-16 bg-surface-background rounded-2xl border border-surface-border items-center justify-center mb-5">
            <FontAwesome name={icon!.name as any} size={26} color={icon!.color} />
          </View>
          <Text className="text-typography-main text-lg font-black mb-1.5 text-center" numberOfLines={2}>{file.name}</Text>
          <Text className="text-typography-muted text-xs mb-6">{formatFileSize(file.size_bytes)}</Text>
          <TouchableOpacity
            onPress={() => Linking.openURL(file.signed_url)}
            className="flex-row items-center justify-center bg-brand-primary rounded-2xl py-4 px-8 gap-2 w-full"
          >
            <FontAwesome name="download" size={14} color="#fff" />
            <Text className="text-white font-black text-base">Download</Text>
          </TouchableOpacity>
          <Text className="text-typography-dim text-[10px] mt-4 text-center">
            Shared via TrustFlow File Hub
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export default function SharePage() {
  const { token } = useLocalSearchParams<{ token: string }>();
  return (
    <>
      <Stack.Screen options={{ headerShown: false, title: 'Shared File' }} />
      {token ? <SharePageContent token={token} /> : null}
    </>
  );
}
