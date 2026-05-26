// Floating banner shown after login if web push isn't active.
// Visible on every fresh session until the user enables push or has explicitly
// opted out in their preferences.
import React, { useEffect, useState } from 'react';
import { Text, TouchableOpacity, View, ActivityIndicator } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { usePushSubscription } from '@/hooks/usePushSubscription';
import { useThemeColors } from '@/hooks/useThemeColors';

export default function WebPushPrompt() {
  const { user, initialized } = useAuth();
  const { state, subscribe } = usePushSubscription();
  const colors = useThemeColors();

  const [optedIn, setOptedIn] = useState<boolean | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [enabling, setEnabling] = useState(false);

  // Load preference whenever the user changes.
  useEffect(() => {
    if (!initialized || !user) {
      setOptedIn(null);
      return;
    }
    (async () => {
      const { data } = await supabase
        .from('notification_preferences')
        .select('push_web_enabled')
        .eq('user_id', user.id)
        .maybeSingle();
      setOptedIn(data?.push_web_enabled !== false);
    })();
  }, [user?.id, initialized]);

  if (!user || optedIn === false) return null;
  if (dismissed) return null;
  if (state !== 'unsubscribed' && state !== 'denied') return null;

  const isDenied = state === 'denied';

  const onEnable = async () => {
    if (isDenied) return; // browser blocks programmatic re-prompt
    setEnabling(true);
    await subscribe();
    setEnabling(false);
  };

  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', right: 24, bottom: 24, zIndex: 9999, maxWidth: 380 }}
    >
      <View className="bg-surface-card border border-surface-border rounded-2xl shadow-2xl overflow-hidden">
        <View className="p-5">
          <View className="flex-row items-start gap-3 mb-3">
            <View className={`w-10 h-10 rounded-xl items-center justify-center ${isDenied ? 'bg-state-danger/10' : 'bg-brand-primary/10'}`}>
              <FontAwesome
                name={isDenied ? 'bell-slash' : 'bell'}
                size={16}
                color={isDenied ? colors.danger : colors.primary}
              />
            </View>
            <View className="flex-1">
              <Text className="text-typography-main font-black text-sm">
                {isDenied ? 'Notifications blocked' : 'Enable browser notifications'}
              </Text>
              <Text className="text-typography-muted text-xs leading-5 mt-1">
                {isDenied
                  ? 'Your browser is blocking notifications from TrustFlow. Click the lock icon in the address bar and allow notifications, then reload.'
                  : 'Get notified instantly when tasks are assigned, comments mention you, or deadlines approach.'}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => setDismissed(true)}
              className="w-7 h-7 rounded-full bg-surface-background items-center justify-center border border-surface-border"
            >
              <FontAwesome name="times" size={11} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          {!isDenied && (
            <TouchableOpacity
              onPress={onEnable}
              disabled={enabling}
              className="bg-brand-primary py-3 rounded-xl items-center flex-row justify-center gap-2"
            >
              {enabling ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <FontAwesome name="bell" size={12} color="white" />
                  <Text className="text-white font-black uppercase tracking-widest text-[11px]">
                    Enable Notifications
                  </Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}
