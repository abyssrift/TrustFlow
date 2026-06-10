import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Switch,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { FontAwesome } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { useAlert } from '@/contexts/AlertContext';
import { usePushSubscription } from '@/hooks/usePushSubscription';
import { useThemeColors } from '@/hooks/useThemeColors';

type Prefs = {
  email_enabled: boolean;
  push_mobile_enabled: boolean;
  push_web_enabled: boolean;
};

const EVENT_GROUPS = [
  {
    label: 'Tasks',
    icon: 'check-square-o' as const,
    events: [
      { type: 'task.assigned',         label: 'Assigned to you' },
      { type: 'task.mentioned',        label: 'Mentioned in a comment' },
      { type: 'task.commented',        label: 'New comment on watched task' },
      { type: 'task.completed',        label: 'Task completed' },
      { type: 'task.stage_transition', label: 'Task moved to a new stage' },
      { type: 'task.due_soon',         label: 'Task due within 24 hours' },
      { type: 'task.overdue',          label: 'Task past due date' },
    ],
  },
];

export default function NotificationPreferencesWeb() {
  const colors = useThemeColors();
  const router = useRouter();
  const { showAlert } = useAlert();
  const { state: pushState, subscribe, unsubscribe } = usePushSubscription();

  const [prefs, setPrefs] = useState<Prefs>({
    email_enabled: true,
    push_mobile_enabled: true,
    push_web_enabled: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    loadPrefs();
  }, []);

  const loadPrefs = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('notification_preferences')
      .select('email_enabled, push_mobile_enabled, push_web_enabled')
      .maybeSingle();
    if (data) {
      setPrefs({
        email_enabled: data.email_enabled,
        push_mobile_enabled: data.push_mobile_enabled,
        push_web_enabled: data.push_web_enabled,
      });
    }
    setLoading(false);
  };

  const toggle = (key: keyof Prefs) => {
    setPrefs((p) => ({ ...p, [key]: !p[key] }));
    setDirty(true);
  };

  const togglePushWeb = async () => {
    // Visible state is the truth: subscribed AND opted in.
    const currentlyOn = pushState === 'subscribed' && prefs.push_web_enabled;
    const newValue = !currentlyOn;
    if (newValue) {
      const ok = await subscribe();
      if (!ok) return;
    } else {
      await unsubscribe();
    }
    setPrefs((p) => ({ ...p, push_web_enabled: newValue }));
    await supabase.rpc('rpc_upsert_notification_preferences', {
      p_email_enabled: prefs.email_enabled,
      p_push_mobile_enabled: prefs.push_mobile_enabled,
      p_push_web_enabled: newValue,
    });
  };

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.rpc('rpc_upsert_notification_preferences', {
      p_email_enabled: prefs.email_enabled,
      p_push_mobile_enabled: prefs.push_mobile_enabled,
      p_push_web_enabled: prefs.push_web_enabled,
    });
    setSaving(false);
    if (error) {
      showAlert('Error', error.message || 'Failed to save preferences.');
    } else {
      setDirty(false);
      showAlert('Saved', 'Your notification preferences have been updated.');
    }
  };

  if (loading) {
    return (
      <View className="flex-1 bg-surface-background items-center justify-center">
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const pushWebDisabled =
    pushState === 'loading' ||
    pushState === 'unsupported' ||
    pushState === 'denied';

  return (
    <ScrollView className="flex-1 bg-surface-background" showsVerticalScrollIndicator={false}>
      <Stack.Screen options={{ headerShown: false }} />

      <View className="max-w-[800px] mx-auto w-full px-10 py-12">
        {/* Breadcrumb */}
        <View className="flex-row items-center gap-2 mb-10">
          <TouchableOpacity onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)')} className="flex-row items-center gap-2">
            <FontAwesome name="chevron-left" size={11} color={colors.textMuted} />
            <Text className="text-typography-muted font-bold text-sm">Back</Text>
          </TouchableOpacity>
          <Text className="text-typography-muted text-sm">/</Text>
          <Text className="text-typography-main font-bold text-sm">Notification Preferences</Text>
        </View>

        {/* Page header */}
        <View className="mb-10 flex-row items-end justify-between">
          <View>
            <Text className="text-brand-primary font-black uppercase tracking-[0.3em] text-[10px] mb-2">
              Personalization
            </Text>
            <Text className="text-typography-main text-4xl font-black tracking-tighter">
              Notification Preferences
            </Text>
            <Text className="text-typography-muted text-base mt-2 font-medium">
              Choose how and when TrustFlow contacts you.
            </Text>
          </View>

          {dirty && (
            <TouchableOpacity
              onPress={save}
              disabled={saving}
              className="bg-brand-primary px-8 py-4 rounded-2xl items-center premium-shadow active:opacity-80"
            >
              {saving ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text className="text-white font-black uppercase tracking-widest text-[11px]">
                  Save Changes
                </Text>
              )}
            </TouchableOpacity>
          )}
        </View>

        {/* Delivery channels */}
        <View className="bg-surface-card rounded-[32px] border border-surface-border overflow-hidden premium-shadow mb-8">
          <View className="px-8 py-6 border-b border-surface-border">
            <Text className="text-typography-main font-black text-lg tracking-tight">
              Delivery Channels
            </Text>
            <Text className="text-typography-muted text-sm mt-1">
              Choose which channels TrustFlow uses to reach you.
            </Text>
          </View>

          {/* Email */}
          <View className="flex-row items-center px-8 py-6 border-b border-surface-border">
            <View className="bg-brand-primary/10 w-12 h-12 rounded-2xl items-center justify-center mr-5 border border-brand-primary/20">
              <FontAwesome name="envelope-o" size={18} color={colors.primary} />
            </View>
            <View className="flex-1 mr-6">
              <Text className="text-typography-main font-bold text-base">Email</Text>
              <Text className="text-typography-muted text-sm mt-0.5 leading-5">
                Get important updates delivered to your email inbox.
              </Text>
            </View>
            <Switch
              value={prefs.email_enabled}
              onValueChange={() => toggle('email_enabled')}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor="#fff"
            />
          </View>

          {/* Browser push */}
          <View className="flex-row items-center px-8 py-6 border-b border-surface-border">
            <View className="bg-brand-primary/10 w-12 h-12 rounded-2xl items-center justify-center mr-5 border border-brand-primary/20">
              {pushState === 'loading' ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <FontAwesome name="globe" size={18} color={colors.primary} />
              )}
            </View>
            <View className="flex-1 mr-6">
              <View className="flex-row items-center gap-2 flex-wrap">
                <Text className="text-typography-main font-bold text-base">Browser Push</Text>
                {pushState === 'subscribed' && (
                  <View className="bg-state-success/10 px-2.5 py-0.5 rounded-full border border-state-success/20">
                    <Text className="text-state-success text-[10px] font-black uppercase tracking-wider">
                      Active
                    </Text>
                  </View>
                )}
                {pushState === 'denied' && (
                  <View className="bg-state-error/10 px-2.5 py-0.5 rounded-full border border-state-error/20">
                    <Text className="text-state-error text-[10px] font-black uppercase tracking-wider">
                      Blocked
                    </Text>
                  </View>
                )}
                {pushState === 'unsupported' && (
                  <View className="bg-surface-background px-2.5 py-0.5 rounded-full border border-surface-border">
                    <Text className="text-typography-muted text-[10px] font-black uppercase tracking-wider">
                      Unsupported
                    </Text>
                  </View>
                )}
              </View>
              <Text className="text-typography-muted text-sm mt-0.5 leading-5">
                {pushState === 'denied'
                  ? 'Notifications are blocked. Update your browser site settings to enable.'
                  : pushState === 'unsupported'
                  ? 'Your browser does not support push notifications.'
                  : 'Receive push notifications in your web browser.'}
              </Text>
            </View>
            <Switch
              value={prefs.push_web_enabled && pushState === 'subscribed'}
              onValueChange={togglePushWeb}
              disabled={pushWebDisabled}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor="#fff"
            />
          </View>

          {/* Mobile push */}
          <View className="flex-row items-center px-8 py-6">
            <View className="bg-brand-primary/10 w-12 h-12 rounded-2xl items-center justify-center mr-5 border border-brand-primary/20">
              <FontAwesome name="mobile" size={18} color={colors.primary} />
            </View>
            <View className="flex-1 mr-6">
              <Text className="text-typography-main font-bold text-base">Mobile Push</Text>
              <Text className="text-typography-muted text-sm mt-0.5 leading-5">
                Receive push notifications on your iOS or Android device.
              </Text>
            </View>
            <Switch
              value={prefs.push_mobile_enabled}
              onValueChange={() => toggle('push_mobile_enabled')}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor="#fff"
            />
          </View>
        </View>

        {/* Event types (read-only info) */}
        {EVENT_GROUPS.map((group) => (
          <View key={group.label} className="bg-surface-card rounded-[32px] border border-surface-border overflow-hidden premium-shadow mb-8">
            <View className="px-8 py-6 border-b border-surface-border flex-row items-center gap-3">
              <FontAwesome name={group.icon} size={14} color={colors.textMuted} />
              <Text className="text-typography-main font-black text-lg tracking-tight">
                {group.label} Events
              </Text>
              <View className="bg-surface-background px-2.5 py-0.5 rounded-full border border-surface-border ml-1">
                <Text className="text-typography-muted text-[10px] font-bold">
                  {group.events.length} types
                </Text>
              </View>
            </View>

            <View className="px-8 py-3">
              {group.events.map((ev, idx) => (
                <View
                  key={ev.type}
                  className={`flex-row items-center py-4 ${
                    idx < group.events.length - 1 ? 'border-b border-surface-border' : ''
                  }`}
                >
                  <View className="w-1.5 h-1.5 rounded-full bg-brand-primary/40 mr-4" />
                  <Text className="text-typography-muted text-sm flex-1">{ev.label}</Text>
                  <View className="bg-state-success/10 px-3 py-1 rounded-full border border-state-success/20">
                    <Text className="text-state-success text-[10px] font-black uppercase tracking-wider">
                      Active
                    </Text>
                  </View>
                </View>
              ))}
            </View>

            <View className="px-8 py-4 bg-surface-background/50 border-t border-surface-border">
              <Text className="text-typography-muted text-xs">
                Event rules are configured by your workspace admin.
              </Text>
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
