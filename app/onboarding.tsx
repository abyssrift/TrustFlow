import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
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
        // Silent fail
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
    <View className="space-y-4">
      <TouchableOpacity
        onPress={() => setMode('join')}
        className="w-full bg-surface-card border border-surface-border rounded-2xl p-5 flex-row items-center"
      >
        <View className="w-12 h-12 bg-brand-primary/10 rounded-xl items-center justify-center mr-4">
          <FontAwesome name="users" size={20} color="#6366f1" />
        </View>
        <View className="flex-1">
          <Text className="text-lg font-bold text-typography-main">Join a Team</Text>
          <Text className="text-typography-muted text-xs mt-1">If your team is already on TrustFlow.</Text>
        </View>
        <FontAwesome name="chevron-right" size={14} color="#475569" />
      </TouchableOpacity>

      <TouchableOpacity
        onPress={() => setMode('create')}
        className="w-full bg-surface-card border border-surface-border rounded-2xl p-5 flex-row items-center"
      >
        <View className="w-12 h-12 bg-brand-primary/10 rounded-xl items-center justify-center mr-4">
          <FontAwesome name="plus-circle" size={20} color="#6366f1" />
        </View>
        <View className="flex-1">
          <Text className="text-lg font-bold text-typography-main">Set Up Workspace</Text>
          <Text className="text-typography-muted text-xs mt-1">Create a new secure organization.</Text>
        </View>
        <FontAwesome name="chevron-right" size={14} color="#475569" />
      </TouchableOpacity>
    </View>
  );

  const renderJoin = () => (
    <View className="space-y-6">
      <View>
        <Text className="text-typography-dim text-[10px] font-black uppercase tracking-widest mb-2 ml-1">Invitation Code</Text>
        <TextInput
          className="w-full bg-surface-card border border-surface-border rounded-2xl px-5 py-4 text-typography-main font-bold text-xl text-center"
          placeholder="XXXXXX"
          placeholderTextColor="#475569"
          autoCapitalize="characters"
          maxLength={6}
          value={joinCode}
          onChangeText={setJoinCode}
        />
      </View>

      <TouchableOpacity
        className={`w-full rounded-2xl py-4 items-center justify-center ${loading ? 'bg-brand-primary/50' : 'bg-brand-primary'}`}
        onPress={handleJoinByCode}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text className="text-white font-black text-lg">Join Workspace</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity onPress={() => setMode('selection')} className="items-center py-2">
        <Text className="text-typography-muted font-bold">Go Back</Text>
      </TouchableOpacity>
    </View>
  );

  const renderCreate = () => (
    <View className="space-y-6">
      <View>
        <Text className="text-typography-dim text-[10px] font-black uppercase tracking-widest mb-2 ml-1">Company Name</Text>
        <TextInput
          className="w-full bg-surface-card border border-surface-border rounded-2xl px-5 py-4 text-typography-main font-bold"
          placeholder="Acme Corp"
          placeholderTextColor="#475569"
          autoCapitalize="words"
          value={companyName}
          onChangeText={setCompanyName}
        />
      </View>

      <TouchableOpacity
        className={`w-full rounded-2xl py-4 items-center justify-center ${loading ? 'bg-brand-primary/50' : 'bg-brand-primary'}`}
        onPress={handleCreateCompany}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text className="text-white font-black text-lg">Create Workspace</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity onPress={() => setMode('selection')} className="items-center py-2">
        <Text className="text-typography-muted font-bold">Go Back</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1 bg-surface-background"
    >
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 32, paddingVertical: 80 }}
      >
        <View className="mb-10 items-center">
          <View className="w-16 h-16 bg-brand-primary/10 rounded-2xl items-center justify-center mb-4">
            <FontAwesome name="rocket" size={24} color="#6366f1" />
          </View>
          <Text className="text-3xl font-black text-typography-main tracking-tighter text-center">
            Welcome
          </Text>
          <Text className="text-typography-muted text-sm font-medium mt-1 text-center">
            Let's get your workspace set up.
          </Text>
        </View>

        {error && (
          <View className="bg-state-danger/10 border border-state-danger/20 rounded-xl p-3 mb-6">
            <Text className="text-state-danger text-xs font-bold text-center">{error}</Text>
          </View>
        )}

        {mode === 'selection' && renderSelection()}
        {mode === 'join' && renderJoin()}
        {mode === 'create' && renderCreate()}

        <TouchableOpacity onPress={signOut} className="mt-12 items-center">
          <Text className="text-typography-muted text-xs">
            Signed in? <Text className="text-state-danger">Sign Out</Text>
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
