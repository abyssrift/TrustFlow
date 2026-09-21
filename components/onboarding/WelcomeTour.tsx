import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSegments } from 'expo-router';
import Popup from '@/components/common/Popup';
import { useAuth } from '@/contexts/AuthContext';
import { useContextualGuide } from '@/contexts/ContextualGuideContext';
import { supabase } from '@/lib/supabase';

/** First-run introduction to the persistent guide checklist. */
export default function WelcomeTour() {
  const { profile, refreshProfile } = useAuth();
  const { openChecklist } = useContextualGuide();
  const segments = useSegments();
  const [dismissed, setDismissed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  const shouldShow = !!profile?.company_id && !profile.onboarded_at && !dismissed &&
    segments[0] !== '(auth)' && segments[0] !== 'onboarding' && segments[0] !== 'share';

  const finish = async (continueToChecklist: boolean) => {
    setSaving(true);
    setError(false);
    let completed = false;
    try {
      const { error: completionError } = await supabase.rpc('rpc_complete_onboarding');
      if (completionError) throw completionError;
      completed = true;
      setDismissed(true);
      await refreshProfile();
    } catch {
      if (!completed) setError(true);
    } finally {
      setSaving(false);
    }
    if (completed && continueToChecklist) openChecklist();
  };

  if (!shouldShow) return null;

  return <Popup
    visible
    onClose={() => { void finish(false); }}
    presentation="auto"
    dismissible={!saving}
    maxWidth={520}
    title="Your To Do checklist"
  >
    <View className="gap-4 p-5">
      <Text className="text-base leading-6 text-typography-muted">
        Find short, practical guides for the parts of TrustFlow available to you. You can open this checklist any time from To Do.
      </Text>
      {error && <Text accessibilityRole="alert" className="text-sm font-semibold text-state-danger">We couldn’t finish setup. Please try again.</Text>}
      <View className="flex-row justify-end gap-3">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss checklist introduction"
          disabled={saving}
          onPress={() => { void finish(false); }}
          className="min-h-[44px] min-w-[88px] items-center justify-center rounded-xl border border-surface-border px-4"
        >
          <Text className="font-semibold text-typography-main">Dismiss</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open To Do checklist"
          disabled={saving}
          onPress={() => { void finish(true); }}
          className="min-h-[44px] min-w-[88px] items-center justify-center rounded-xl bg-brand-primary px-4 hover:bg-brand-primary-hover active:bg-brand-primary-active"
        >
          <Text className="font-semibold text-surface-background">Continue</Text>
        </Pressable>
      </View>
    </View>
  </Popup>;
}
