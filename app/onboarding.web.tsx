import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import FontAwesome from '@expo/vector-icons/FontAwesome';

export default function OnboardingScreen() {
  const [mode, setMode] = useState<'selection' | 'join' | 'create'>('selection');
  const [joinCode, setJoinCode] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { refreshProfile, signOut } = useAuth();
  const router = useRouter();

  // Auto-check for invitations on mount (Self-healing for late invites)
  React.useEffect(() => {
    const checkLateInvite = async () => {
      try {
        const { data, error: rpcError } = await supabase.rpc('rpc_claim_pending_invitation');
        if (!rpcError && data) {
          // Successfully joined a late invite!
          await refreshProfile();
          router.replace('/(tabs)');
        }
      } catch (e) {
        // Silent fail, just let them use the manual selection
      }
    };
    checkLateInvite();
  }, []);

  const handleJoinByCode = async () => {
    if (!joinCode) {
      setError('Please enter a join code.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { error: joinError } = await supabase.rpc('rpc_join_company_by_code', {
        p_join_code: joinCode,
      });

      if (joinError) throw joinError;

      await refreshProfile();
      router.replace('/(tabs)');
    } catch (err: any) {
      setError(err.message || 'Failed to join company.');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateCompany = async () => {
    if (!companyName) {
      setError('Please enter a company name.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { data: companyId, error: createError } = await supabase.rpc('rpc_create_company_and_link', {
        p_company_name: companyName,
      });

      if (createError) throw createError;

      await refreshProfile();
      router.replace('/(tabs)');
    } catch (err: any) {
      setError(err.message || 'Failed to create company.');
    } finally {
      setLoading(false);
    }
  };

  const renderSelection = () => (
    <View className="space-y-6">
      <TouchableOpacity
        onPress={() => setMode('join')}
        className="w-full bg-surface-card border border-surface-border rounded-2xl p-6 flex-row items-center premium-shadow hover:border-brand-primary transition-all"
      >
        <View className="w-14 h-14 bg-brand-primary/10 rounded-xl items-center justify-center mr-5">
          <FontAwesome name="users" size={24} color="#6366f1" />
        </View>
        <View className="flex-1">
          <Text className="text-xl font-bold text-typography-main">Join an Existing Team</Text>
          <Text className="text-typography-muted text-sm mt-1">If your company is already using TrustFlow, enter your team's join code.</Text>
        </View>
        <FontAwesome name="chevron-right" size={16} color="#475569" />
      </TouchableOpacity>

      <TouchableOpacity
        onPress={() => setMode('create')}
        className="w-full bg-surface-card border border-surface-border rounded-2xl p-6 flex-row items-center premium-shadow hover:border-brand-primary transition-all"
      >
        <View className="w-14 h-14 bg-brand-primary/10 rounded-xl items-center justify-center mr-5">
          <FontAwesome name="plus-circle" size={24} color="#6366f1" />
        </View>
        <View className="flex-1">
          <Text className="text-xl font-bold text-typography-main">Set Up a New Workspace</Text>
          <Text className="text-typography-muted text-sm mt-1">Start fresh and invite your team to a new secure organization.</Text>
        </View>
        <FontAwesome name="chevron-right" size={16} color="#475569" />
      </TouchableOpacity>
    </View>
  );

  const renderJoin = () => (
    <View className="space-y-6">
      <View>
        <Text className="text-typography-dim text-[10px] font-black uppercase tracking-widest mb-3 ml-1">Invitation Code</Text>
        <TextInput
          className="w-full bg-surface-card border border-surface-border rounded-2xl px-6 py-5 text-typography-main font-bold text-2xl tracking-[0.5em] text-center focus:border-brand-primary transition-all"
          placeholder="XXXXXX"
          placeholderTextColor="rgba(var(--text-muted), 0.3)"
          autoCapitalize="characters"
          maxLength={6}
          value={joinCode}
          onChangeText={setJoinCode}
        />
      </View>

      <TouchableOpacity
        className={`w-full rounded-2xl py-5 items-center justify-center premium-shadow ${loading ? 'bg-brand-primary/50' : 'bg-brand-primary'}`}
        onPress={handleJoinByCode}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text className="text-white font-black text-lg tracking-tight">Join Workspace</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity onPress={() => setMode('selection')} className="items-center">
        <Text className="text-typography-muted font-bold">Go Back</Text>
      </TouchableOpacity>
    </View>
  );

  const renderCreate = () => (
    <View className="space-y-6">
      <View>
        <Text className="text-typography-dim text-[10px] font-black uppercase tracking-widest mb-3 ml-1">Company Name</Text>
        <TextInput
          className="w-full bg-surface-card border border-surface-border rounded-2xl px-6 py-5 text-typography-main font-bold text-lg focus:border-brand-primary transition-all"
          placeholder="e.g. Acme Corp"
          placeholderTextColor="rgba(var(--text-muted), 0.3)"
          autoCapitalize="words"
          value={companyName}
          onChangeText={setCompanyName}
        />
      </View>

      <TouchableOpacity
        className={`w-full rounded-2xl py-5 items-center justify-center premium-shadow ${loading ? 'bg-brand-primary/50' : 'bg-brand-primary'}`}
        onPress={handleCreateCompany}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text className="text-white font-black text-lg tracking-tight">Create Workspace</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity onPress={() => setMode('selection')} className="items-center">
        <Text className="text-typography-muted font-bold">Go Back</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View className="flex-1 bg-surface-background">
      <View className="flex-1 max-w-2xl mx-auto w-full justify-center px-8 py-20">
        <View className="mb-12 items-center">
          <View className="w-20 h-20 bg-brand-primary/10 rounded-3xl items-center justify-center mb-6">
            <FontAwesome name="rocket" size={32} color="#6366f1" />
          </View>
          <Text className="text-4xl font-black text-typography-main tracking-tighter text-center">
            Welcome to TrustFlow
          </Text>
          <Text className="text-typography-muted text-lg font-medium mt-2 text-center">
            Let's get your workspace set up.
          </Text>
        </View>

        {error && (
          <View className="bg-state-danger/10 border border-state-danger/20 rounded-2xl p-4 mb-8">
            <Text className="text-state-danger text-sm font-bold text-center">{error}</Text>
          </View>
        )}

        {mode === 'selection' && renderSelection()}
        {mode === 'join' && renderJoin()}
        {mode === 'create' && renderCreate()}

        <View className="mt-20 items-center">
          <TouchableOpacity onPress={signOut}>
            <Text className="text-typography-muted font-medium">
              Signed in as <Text className="text-typography-main font-bold">Account Settings</Text> • <Text className="text-state-danger">Sign Out</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}
