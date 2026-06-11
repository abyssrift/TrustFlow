import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Switch,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { FontAwesome } from '@expo/vector-icons';
import { cssInterop } from 'react-native-css-interop';
import { BackButton } from '@/components/common/BackButton';
import { supabase } from '@/lib/supabase';
import { useAlert } from '@/contexts/AlertContext';
import { useThemeColors } from '@/hooks/useThemeColors';

cssInterop(FontAwesome, {
  className: {
    target: 'style',
    nativeStyleToProp: { color: true, size: true },
  },
} as any);

type Prefs = {
  email_enabled: boolean;
  push_mobile_enabled: boolean;
  push_web_enabled: boolean;
};

type ChannelRow = {
  key: keyof Prefs;
  label: string;
  description: string;
  icon: React.ComponentProps<typeof FontAwesome>['name'];
  platformOnly?: 'native' | 'web';
};

const CHANNELS: ChannelRow[] = [
  {
    key: 'push_mobile_enabled',
    label: 'Mobile Push',
    description: 'Receive push notifications on your iOS or Android device.',
    icon: 'mobile',
    platformOnly: 'native',
  },
  {
    key: 'push_web_enabled',
    label: 'Browser Push',
    description: 'Receive push notifications in your web browser.',
    icon: 'globe',
    platformOnly: 'web',
  },
  {
    key: 'email_enabled',
    label: 'Email',
    description: 'Get important updates delivered to your email inbox.',
    icon: 'envelope-o',
  },
];

// Groups of notification types for display (read-only — admins control the rules)
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

export default function NotificationPreferencesScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const { showAlert } = useAlert();
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
      .single();
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
      <SafeAreaView className="flex-1 bg-surface-background items-center justify-center">
        <ActivityIndicator size="large" color="#6366f1" />
      </SafeAreaView>
    );
  }

  const visibleChannels = CHANNELS.filter((c) => {
    if (c.platformOnly === 'native' && Platform.OS === 'web') return false;
    if (c.platformOnly === 'web' && Platform.OS !== 'web') return false;
    return true;
  });

  return (
    <SafeAreaView className="flex-1 bg-surface-background">
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View className="bg-surface-card px-4 pt-6 pb-6 border-b border-surface-border rounded-b-3xl">
        <View className="flex-row items-center justify-between mb-6">
          <BackButton />
          <View className="bg-brand-primary/10 px-3 py-1.5 rounded-full border border-brand-primary/20">
            <Text className="text-brand-primary text-[9px] font-black uppercase tracking-widest">
              Signal Config
            </Text>
          </View>
        </View>

        <View className="px-2">
          <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.25em] mb-1">
            Personalization
          </Text>
          <Text className="text-typography-main text-3xl font-black tracking-tight">
            Notification Preferences
          </Text>
          <Text className="text-typography-muted text-sm mt-2 leading-5">
            Choose how and when TrustFlow contacts you.
          </Text>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 48 }}
      >
        {/* Delivery Channels */}
        <View className="px-4 mt-6 mb-2">
          <Text className="text-[10px] font-black uppercase tracking-[0.2em] text-typography-muted">
            Delivery Channels
          </Text>
        </View>

        <View className="mx-4 bg-surface-card rounded-2xl border border-surface-border overflow-hidden">
          {visibleChannels.map((ch, idx) => (
            <View
              key={ch.key}
              className={`flex-row items-center px-4 py-4 ${
                idx < visibleChannels.length - 1 ? 'border-b border-surface-border' : ''
              }`}
            >
              <View className="bg-brand-primary/10 w-9 h-9 rounded-xl items-center justify-center mr-3">
                <FontAwesome
                  name={ch.icon}
                  size={15}
                  className="text-brand-primary"
                />
              </View>
              <View className="flex-1 mr-3">
                <Text className="text-typography-main font-bold text-sm">{ch.label}</Text>
                <Text className="text-typography-muted text-xs mt-0.5 leading-4">
                  {ch.description}
                </Text>
              </View>
              <Switch
                value={prefs[ch.key]}
                onValueChange={() => toggle(ch.key)}
                trackColor={{
                  false: colors.border,
                  true: colors.primary,
                }}
                thumbColor="#fff"
              />
            </View>
          ))}
        </View>

        {/* What triggers notifications (read-only info) */}
        {EVENT_GROUPS.map((group) => (
          <View key={group.label}>
            <View className="px-4 mt-6 mb-2 flex-row items-center gap-2">
              <FontAwesome
                name={group.icon}
                size={11}
                className="text-typography-muted"
              />
              <Text className="text-[10px] font-black uppercase tracking-[0.2em] text-typography-muted">
                {group.label} Events
              </Text>
            </View>

            <View className="mx-4 bg-surface-card rounded-2xl border border-surface-border overflow-hidden">
              {group.events.map((ev, idx) => (
                <View
                  key={ev.type}
                  className={`flex-row items-center px-4 py-3.5 ${
                    idx < group.events.length - 1
                      ? 'border-b border-surface-border'
                      : ''
                  }`}
                >
                  <View className="w-1.5 h-1.5 rounded-full bg-brand-primary/50 mr-3" />
                  <Text className="text-typography-muted text-sm flex-1">{ev.label}</Text>
                  <View className="bg-[var(--color-success)]/10 px-2 py-0.5 rounded-full border-[var(--color-success)]/20">
                    <Text className="text-state-success text-[9px] font-black uppercase tracking-wider">
                      Active
                    </Text>
                  </View>
                </View>
              ))}
            </View>

            <Text className="text-typography-muted text-[11px] mx-4 mt-2 leading-4">
              Event rules are configured by your workspace admin.
            </Text>
          </View>
        ))}

        {/* Save */}
        {dirty && (
          <View className="mx-4 mt-8">
            <TouchableOpacity
              onPress={save}
              disabled={saving}
              className="bg-brand-primary py-4 rounded-2xl items-center active:opacity-80"
            >
              {saving ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text className="text-white font-black uppercase tracking-widest text-[11px]">
                  Save Preferences
                </Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
