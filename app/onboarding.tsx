import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { useThemeColors } from '@/hooks/useThemeColors';
import WorkspaceReadyStep from '@/components/onboarding/WorkspaceReadyStep';
import OnboardingProgress from '@/components/onboarding/OnboardingProgress';
import OnboardingQuestionStep from '@/components/onboarding/OnboardingQuestionStep';
import { loadOnboardingCatalog, onboardingAnswersForRpc, pruneStaleOnboardingAnswers, type OnboardingAnswers } from '@/lib/onboardingProfile';
import { deriveOnboardingProgress } from '@/lib/onboardingProgress';
import { useOnboardingFlow } from '@/hooks/useOnboardingFlow';

// The wizard asks two questions. Everything else the preset resolver ignores:
// only size_band and operating_models select a preset (resolveOnboardingProfile).
const SETUP_STEPS = ['size_band', 'operating_models'];

// ...but the server still validates gates/files whenever the chosen work types
// call for them (fn_onboarding_normalize_answers), so the answers we stopped
// asking for must keep being sent as defaults.
const SETUP_DEFAULTS = { gates: 'none', timeTracking: 'off', files: 'light', repeatingWork: 'rare' } as const;

export default function OnboardingScreen() {
  const colors = useThemeColors();
  const [mode, setMode] = useState<'selection' | 'join' | 'create' | 'setup' | 'ready'>('selection');
  const [joinCode, setJoinCode] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<Awaited<ReturnType<typeof loadOnboardingCatalog>>>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [companyCreationSucceeded, setCompanyCreationSucceeded] = useState(false);
  const [profileRefreshed, setProfileRefreshed] = useState(false);
  const { refreshProfile, signOut } = useAuth();
  const router = useRouter();
  const onboardingFlow = useOnboardingFlow({ client: supabase, enabled: mode === 'setup' && !!catalog, branch: 'create', manifest: catalog?.manifest });

  React.useEffect(() => {
    let active = true;
    loadOnboardingCatalog(supabase).then((result) => {
      if (!active) return;
      setCatalog(result);
      setCatalogLoading(false);
    });
    return () => { active = false; };
  }, []);

  // Self-healing for invites that land after signup. Guarded twice: `active` for
  // unmount, and `mode` so a slow claim can't yank someone out of a wizard they
  // have already started typing into.
  React.useEffect(() => {
    let active = true;
    const checkLateInvite = async () => {
      try {
        const { data, error: rpcError } = await supabase.rpc('rpc_claim_pending_invitation');
        if (!active || rpcError || !data) return;
        setMode((current) => {
          if (current !== 'selection') return current;
          void refreshProfile().then(() => { if (active) router.replace('/(tabs)'); });
          return current;
        });
      } catch (e) {
        // Silent: the manual selection below is the fallback.
      }
    };
    checkLateInvite();
    return () => { active = false; };
  }, []);

  const handleJoinByCode = async () => {
    if (!joinCode) {
      setError('Please enter a join code.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { error: joinError } = await supabase.rpc('rpc_join_company_by_code', { p_join_code: joinCode });
      if (joinError) throw joinError;
      await refreshProfile();
      router.replace('/(tabs)');
    } catch (err: any) {
      setError(err.message || 'Failed to join company.');
    } finally {
      setLoading(false);
    }
  };

  const handleContinueToSetup = () => {
    if (!companyName.trim()) {
      setError('Please enter a workspace name.');
      return;
    }
    setError(null);
    setMode('setup');
  };

  const valueForQuestion = (key: string) =>
    key === 'size_band' ? onboardingFlow.state.answers.sizeBand : onboardingFlow.state.answers.operatingModels;

  const answerForQuestion = (key: string, value: string | string[]): OnboardingAnswers =>
    key === 'size_band'
      ? { sizeBand: value as OnboardingAnswers['sizeBand'] }
      : { operatingModels: value as OnboardingAnswers['operatingModels'] };

  const progress = deriveOnboardingProgress({
    phase: onboardingFlow.state.phase,
    companyCreationSucceeded,
    profileRefreshed,
    companyBasicsAccepted: companyName.trim().length > 0,
  });
  const progressMilestones = progress.milestones.map((milestone) => ({
    ...milestone,
    label: milestone.id === 'workspace_basics' ? 'Workspace basics' : milestone.id === 'setup_choices' ? 'Setup choices' : 'Workspace ready',
  }));
  const activeMilestoneId = mode === 'ready' ? 'workspace_ready' : mode === 'setup' ? 'setup_choices' : 'workspace_basics';

  const handleQuestionContinue = () => {
    const currentKey = onboardingFlow.state.step;
    const value = valueForQuestion(currentKey);
    if (value === undefined || (Array.isArray(value) && value.length === 0)) {
      setError('Choose an option to continue.');
      return;
    }
    setError(null);
    const currentAnswer = answerForQuestion(currentKey, value);
    const effectiveAnswers = pruneStaleOnboardingAnswers({ ...onboardingFlow.state.answers, ...currentAnswer }, catalog?.manifest);
    onboardingFlow.answer(currentAnswer);
    const next = SETUP_STEPS[SETUP_STEPS.indexOf(currentKey) + 1];
    if (next) {
      onboardingFlow.setStep(next);
      return;
    }
    // The reducer has not applied `currentAnswer` yet, so submit the answers we
    // just computed rather than reading them back out of state.
    void handleCreateCompany(effectiveAnswers);
  };

  const handleCreateCompany = async (answers: OnboardingAnswers) => {
    if (onboardingFlow.state.phase === 'submitting' || !catalog) return;
    setLoading(true);
    setError(null);
    setCompanyCreationSucceeded(false);
    setProfileRefreshed(false);
    onboardingFlow.submit();
    try {
      const { data: result, error: createError } = await supabase.rpc('rpc_create_company_and_link', {
        p_company_name: companyName,
        p_onboarding_answers: onboardingAnswersForRpc({ ...SETUP_DEFAULTS, ...answers }),
        p_idempotency_key: onboardingFlow.state.idempotencyKey,
      });
      if (createError) throw createError;
      setCompanyCreationSucceeded(true);
      await refreshProfile();
      setProfileRefreshed(true);
      onboardingFlow.dispatch({ type: 'success', result: (result && typeof result === 'object' ? result : { companyId: String(result) }) as any });
      setMode('ready');
    } catch (err: any) {
      onboardingFlow.dispatch({ type: 'failure', message: err.message || 'Failed to create workspace.' });
      setError(err.message || 'Failed to create workspace.');
    } finally {
      setLoading(false);
    }
  };

  const renderSelection = () => (
    <View className="gap-4">
      {[
        { mode: 'join' as const, icon: 'users' as const, title: 'Join an existing team', body: "Enter your team's invite code." },
        { mode: 'create' as const, icon: 'plus-circle' as const, title: 'Set up a new workspace', body: 'Start fresh and invite your team.' },
      ].map((choice) => (
        <TouchableOpacity
          key={choice.mode}
          accessibilityRole="button"
          accessibilityLabel={choice.title}
          onPress={() => setMode(choice.mode)}
          className="w-full flex-row items-center rounded-2xl border border-surface-border bg-surface-card p-5 transition-colors hover:border-brand-primary"
        >
          <View className="mr-4 h-12 w-12 items-center justify-center rounded-xl bg-brand-primary-dim">
            <FontAwesome name={choice.icon} size={20} color={colors.primary} />
          </View>
          <View className="flex-1">
            <Text className="text-lg font-bold text-typography-main">{choice.title}</Text>
            <Text className="mt-0.5 text-sm text-typography-muted">{choice.body}</Text>
          </View>
          <FontAwesome name="chevron-right" size={14} color={colors.textDim} />
        </TouchableOpacity>
      ))}
    </View>
  );

  const renderJoin = () => (
    <View>
      <Text className="text-[28px] font-extrabold text-typography-main">Enter your invite code</Text>
      <Text className="mt-2 text-sm text-typography-muted">Ask a teammate for the six-character code.</Text>
      <TextInput
        className="mt-6 w-full rounded-2xl border border-surface-border bg-surface-card px-6 py-5 text-center text-2xl font-bold tracking-[0.5em] text-typography-main focus:border-brand-primary"
        placeholder="XXXXXX"
        placeholderTextColor={colors.textDim}
        autoCapitalize="characters"
        maxLength={6}
        value={joinCode}
        onChangeText={setJoinCode}
      />
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Join workspace"
        className={`mt-6 min-h-[48px] w-full items-center justify-center rounded-2xl ${loading ? 'bg-brand-primary/50' : 'bg-brand-primary'}`}
        onPress={handleJoinByCode}
        disabled={loading}
      >
        <Text className="font-black text-brand-on-primary">{loading ? 'Joining…' : 'Join workspace'}</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => setMode('selection')} className="mt-3 min-h-[44px] items-center justify-center">
        <Text className="font-bold text-typography-muted">Back</Text>
      </TouchableOpacity>
    </View>
  );

  const renderCreate = () => (
    <View>
      <Text className="text-[28px] font-extrabold text-typography-main">What should we call it?</Text>
      <Text className="mt-2 text-sm text-typography-muted">You can rename your workspace at any time.</Text>
      <TextInput
        className="mt-6 w-full rounded-2xl border border-surface-border bg-surface-card px-6 py-5 text-lg font-bold text-typography-main focus:border-brand-primary"
        placeholder="Acme Corp"
        placeholderTextColor={colors.textDim}
        autoCapitalize="words"
        value={companyName}
        onChangeText={setCompanyName}
        onSubmitEditing={handleContinueToSetup}
      />
      <View className="mt-8 flex-row justify-between gap-3">
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => setMode('selection')}
          className="min-h-[48px] items-center justify-center rounded-2xl border border-surface-border px-6"
        >
          <Text className="font-bold text-typography-muted">Back</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Continue to setup"
          className={`min-h-[48px] min-w-[200px] items-center justify-center rounded-2xl px-10 ${companyName.trim() ? 'bg-brand-primary' : 'bg-brand-primary/50'}`}
          onPress={handleContinueToSetup}
          disabled={loading}
        >
          <Text className="font-black text-brand-on-primary">Continue</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderSetup = () => {
    if (catalogLoading) return <ActivityIndicator color={colors.primary} />;
    if (!catalog) return <Text className="text-sm text-state-danger">Setup choices are temporarily unavailable. Please try again.</Text>;
    if (!onboardingFlow.hydrated) {
      return <View className="items-center py-8"><ActivityIndicator color={colors.primary} /></View>;
    }
    const stepKey = SETUP_STEPS.includes(onboardingFlow.state.step) ? onboardingFlow.state.step : SETUP_STEPS[0];
    const question = catalog.manifest.questions.find((item) => item.key === stepKey) ?? catalog.manifest.questions[0];
    return (
      <OnboardingQuestionStep
        question={question}
        value={valueForQuestion(question.key)}
        onChange={(value) => onboardingFlow.answer(answerForQuestion(question.key, value))}
        onContinue={handleQuestionContinue}
        loading={loading}
        onBack={() => {
          const index = SETUP_STEPS.indexOf(question.key);
          if (index <= 0) { setMode('create'); return; }
          onboardingFlow.setStep(SETUP_STEPS[index - 1]);
        }}
      />
    );
  };

  const renderReady = () => (
    <WorkspaceReadyStep
      workspaceName={companyName.trim() || undefined}
      setupSummary={onboardingFlow.state.result?.resolved_profile ? {
        sizeBand: catalog?.presets.find((preset) => preset.selectionKey === onboardingFlow.state.result?.resolved_profile?.size_band)?.label
          ?? onboardingFlow.state.result.resolved_profile.size_band,
        operatingModels: (onboardingFlow.state.result.resolved_profile.operating_models ?? []).map((model) =>
          catalog?.presets.find((preset) => preset.selectionKey === model)?.label ?? model),
      } : undefined}
      onContinue={() => router.replace('/(tabs)')}
    />
  );

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} className="flex-1 bg-surface-background">
      <ScrollView className="flex-1" contentContainerStyle={{ flexGrow: 1, alignItems: 'center', paddingHorizontal: 32, paddingVertical: 48 }}>
        <View className="w-full max-w-[720px]">
          {mode !== 'selection' && mode !== 'join' && (
            <OnboardingProgress milestones={progressMilestones} activeMilestoneId={activeMilestoneId} />
          )}

          {mode === 'selection' && (
            <View className="mb-8 items-center">
              <View className="mb-4 h-16 w-16 items-center justify-center rounded-2xl bg-brand-primary-dim">
                <FontAwesome name="rocket" size={24} color={colors.primary} />
              </View>
              <Text className="text-center text-[28px] font-extrabold tracking-tight text-typography-main">Welcome to TrustFlow</Text>
              <Text className="mt-2 text-center text-sm text-typography-muted">Let's get your workspace set up.</Text>
            </View>
          )}

          {error && (
            <View className="mb-6 rounded-2xl border border-state-danger/20 bg-state-danger/10 p-4">
              <Text className="text-center text-sm font-bold text-state-danger">{error}</Text>
            </View>
          )}

          {mode === 'selection' && renderSelection()}
          {mode === 'join' && renderJoin()}
          {mode === 'create' && renderCreate()}
          {mode === 'setup' && renderSetup()}
          {mode === 'ready' && renderReady()}

          {mode !== 'ready' && (
            <TouchableOpacity onPress={signOut} className="mt-12 min-h-[44px] items-center justify-center">
              <Text className="text-xs text-typography-dim">
                Signed in · <Text className="text-state-danger">Sign out</Text>
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
