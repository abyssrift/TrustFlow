import React, { useMemo, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, ScrollView, Platform } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { supabase } from '@/lib/supabase';

type Step = {
  icon: string;
  title: string;
  body: string;
};

/**
 * One-time, dismissible welcome tour shown on a user's first entry into the app
 * (after they belong to a company). Completion is persisted via
 * users.onboarded_at (rpc_complete_onboarding), so it never reappears.
 *
 * Rendered inside an RN <Modal>; per project convention theme-token color
 * CLASSES render black inside a Modal on web, so all colored text/icons use
 * inline styles from useThemeColors instead.
 */
export default function WelcomeTour() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { profile, hasPermission, refreshProfile } = useAuth();
  const [index, setIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [saving, setSaving] = useState(false);

  const isAdmin = hasPermission('role.manage') || hasPermission('company.settings');

  const steps: Step[] = useMemo(() => {
    const base: Step[] = [
      {
        icon: 'rocket',
        title: 'Welcome to TrustFlow',
        body: 'Your workspace for tasks, pipelines and team collaboration. This quick tour shows you around — it only takes a moment.',
      },
      {
        icon: 'user-circle',
        title: 'Set up your profile',
        body: 'Add your name, job title and avatar from the People screen so teammates recognise you and assignments land in the right place.',
      },
      {
        icon: 'tasks',
        title: 'Work your tasks',
        body: 'The Tasks board is organised into pipeline stages. Open a card to track time, comment, and advance work forward (or send it back) as it progresses.',
      },
      {
        icon: 'folder-open',
        title: 'Projects & FileHub',
        body: 'Group work under Projects to watch progress at a glance, and use FileHub to send files to teammates or broadcast them company-wide.',
      },
    ];
    if (isAdmin) {
      base.push({
        icon: 'shield',
        title: 'Configure your workspace',
        body: 'As an admin you can shape pipelines, invite people, and define access with roles — start from a preset template in the Role Registry to move fast.',
      });
    }
    base.push({
      icon: 'check-circle',
      title: "You're all set",
      body: 'That\'s the tour. You can revisit any screen from the navigation at any time. Let\'s get to work.',
    });
    return base;
  }, [isAdmin]);

  const shouldShow = !!profile && !!profile.company_id && !profile.onboarded_at && !dismissed;
  const isLast = index >= steps.length - 1;
  const step = steps[Math.min(index, steps.length - 1)];

  const finish = async () => {
    setSaving(true);
    setDismissed(true); // hide immediately for a snappy feel
    try {
      await supabase.rpc('rpc_complete_onboarding');
      await refreshProfile();
    } catch (e) {
      console.error('[WelcomeTour] failed to mark onboarding complete', e);
    } finally {
      setSaving(false);
    }
  };

  if (!shouldShow) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={finish}>
      <View
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.6)',
          justifyContent: 'center',
          alignItems: 'center',
          padding: 20,
          paddingTop: insets.top + 20,
          paddingBottom: insets.bottom + 20,
        }}
      >
        <View
          style={{
            width: '100%',
            maxWidth: 440,
            backgroundColor: colors.card,
            borderRadius: 28,
            borderWidth: 1,
            borderColor: colors.border,
            overflow: 'hidden',
          }}
        >
          {/* Skip */}
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingTop: 14, paddingHorizontal: 14 }}>
            <TouchableOpacity onPress={finish} disabled={saving} style={{ paddingHorizontal: 12, paddingVertical: 6 }}>
              <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1 }}>
                Skip
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ paddingHorizontal: 28, paddingBottom: 8 }} showsVerticalScrollIndicator={false}>
            {/* Icon */}
            <View style={{ alignItems: 'center', marginTop: 4, marginBottom: 22 }}>
              <View
                style={{
                  width: 84,
                  height: 84,
                  borderRadius: 28,
                  backgroundColor: `${colors.primary}1A`,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <FontAwesome name={step.icon as any} size={36} color={colors.primary} />
              </View>
            </View>

            <Text style={{ color: colors.textMain, fontSize: 24, fontWeight: '900', textAlign: 'center', letterSpacing: -0.5 }}>
              {step.title}
            </Text>
            <Text style={{ color: colors.textMuted, fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 12 }}>
              {step.body}
            </Text>
          </ScrollView>

          {/* Progress dots */}
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 18, marginBottom: 18 }}>
            {steps.map((_, i) => (
              <View
                key={i}
                style={{
                  width: i === index ? 22 : 7,
                  height: 7,
                  borderRadius: 4,
                  backgroundColor: i === index ? colors.primary : colors.border,
                }}
              />
            ))}
          </View>

          {/* Footer buttons */}
          <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 24, paddingBottom: 24, paddingTop: 4 }}>
            {index > 0 && (
              <TouchableOpacity
                onPress={() => setIndex(i => Math.max(0, i - 1))}
                style={{
                  flex: 1,
                  paddingVertical: 16,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: colors.background,
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: colors.textMuted, fontSize: 12, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1 }}>
                  Back
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={() => (isLast ? finish() : setIndex(i => i + 1))}
              disabled={saving}
              style={{
                flex: index > 0 ? 2 : 1,
                paddingVertical: 16,
                borderRadius: 16,
                backgroundColor: colors.primary,
                alignItems: 'center',
              }}
            >
              <Text style={{ color: '#fff', fontSize: 12, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1 }}>
                {isLast ? 'Get Started' : 'Next'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
