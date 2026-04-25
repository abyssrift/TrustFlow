import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { getErrorMessage, isValidEmail, isStrongPassword } from '../../lib/auth-errors';

export default function SignUpScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const [invitation, setInvitation] = useState<{ company_name: string; invited_by_name: string } | null>(null);
  const router = useRouter();

  React.useEffect(() => {
    const checkInvite = async () => {
      if (isValidEmail(email)) {
        try {
          const { data, error } = await supabase.rpc('rpc_get_invitation_by_email', { p_email: email.trim() });
          if (!error && data && data.length > 0) {
            setInvitation(data[0]);
          } else {
            setInvitation(null);
          }
        } catch (e) {
          setInvitation(null);
        }
      } else {
        setInvitation(null);
      }
    };

    const debounceTimer = setTimeout(checkInvite, 500);
    return () => clearTimeout(debounceTimer);
  }, [email]);

  const handleSignUp = async () => {
    // 1. Basic Validation
    if (!email || !password || !fullName) {
      setError('Please fill in all fields.');
      return;
    }

    if (!isValidEmail(email)) {
      setError('Please enter a valid work email.');
      return;
    }

    if (!isStrongPassword(password)) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { error: signUpError, data } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            full_name: fullName.trim(),
          },
        },
      });

      if (signUpError) {
        setError(getErrorMessage(signUpError));
        setLoading(false);
      } else {
        if (!data?.session) {
          setIsSuccess(true);
          setLoading(false);
        } else {
          router.replace('/onboarding');
        }
      }
    } catch (err) {
      setError('An unexpected error occurred. Please try again.');
      setLoading(false);
    }
  };

  if (isSuccess) {
    return (
      <View className="flex-1 bg-surface-background items-center justify-center p-8">
        <View className="w-20 h-20 bg-state-success/10 rounded-3xl flex-center mb-8">
          <FontAwesome name="check-circle" size={40} className="text-state-success" />
        </View>
        <Text className="text-3xl font-black text-typography-main tracking-tighter mb-4 text-center">Verify Email</Text>
        <Text className="text-typography-muted font-medium text-center mb-10 leading-relaxed">
          We've sent a link to <Text className="text-typography-main font-bold">{email}</Text>. Please confirm your account to continue.
        </Text>
        
        <Link href="/(auth)/login" asChild>
          <TouchableOpacity className="w-full bg-brand-primary rounded-2xl py-5 items-center justify-center premium-shadow active:scale-[0.98]">
            <Text className="text-white font-black text-lg">Return to Login</Text>
          </TouchableOpacity>
        </Link>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1 bg-surface-background"
    >
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 32, paddingVertical: 60 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="mb-10 items-center">
          <View className="w-16 h-16 bg-brand-primary/20 rounded-2xl flex-center mb-4">
            <FontAwesome name="user-plus" size={24} color="#6366f1" />
          </View>
          <Text className="text-3xl font-black text-typography-main tracking-tighter text-glow">Join TrustFlow</Text>
          <Text className="text-typography-muted text-sm font-medium mt-1">Get started with your secure workspace</Text>
        </View>

        {error && (
          <View className="mb-6 bg-state-danger/10 border border-state-danger/20 p-4 rounded-xl flex-row items-center">
            <FontAwesome name="exclamation-circle" size={16} className="text-state-danger" />
            <Text className="text-state-danger text-xs font-bold ml-3 flex-1">{error}</Text>
          </View>
        )}

        <View className="space-y-5">
          <View>
            <Text className="text-typography-dim text-[10px] font-black uppercase tracking-widest mb-2 ml-1">Full Name</Text>
            <TextInput
              className="w-full bg-surface-card border border-surface-border rounded-2xl px-5 py-4 text-typography-main font-medium"
              placeholder="Jane Doe"
              placeholderTextColor="#475569"
              autoCapitalize="words"
              value={fullName}
              onChangeText={setFullName}
            />
          </View>

          <View>
            <Text className="text-typography-dim text-[10px] font-black uppercase tracking-widest mb-2 ml-1">Work Email</Text>
            <TextInput
              className="w-full bg-surface-card border border-surface-border rounded-2xl px-5 py-4 text-typography-main font-medium"
              placeholder="jane@acme.com"
              placeholderTextColor="#475569"
              keyboardType="email-address"
              autoCapitalize="none"
              value={email}
              onChangeText={setEmail}
            />
          </View>

          {invitation && (
            <View className="bg-brand-primary/10 border border-brand-primary/20 p-4 rounded-xl">
              <View className="flex-row items-center mb-1">
                <FontAwesome name="envelope-open-o" size={14} color="#6366f1" />
                <Text className="text-brand-primary text-[10px] font-black uppercase tracking-widest ml-2">Invitation Detected</Text>
              </View>
              <Text className="text-typography-main font-bold">
                You'll be joining <Text className="text-brand-primary">{invitation.company_name}</Text> invited by <Text className="text-brand-primary">{invitation.invited_by_name}</Text>.
              </Text>
            </View>
          )}

          <View>
            <Text className="text-typography-dim text-[10px] font-black uppercase tracking-widest mb-2 ml-1">Password</Text>
            <TextInput
              className="w-full bg-surface-card border border-surface-border rounded-2xl px-5 py-4 text-typography-main font-medium"
              placeholder="••••••••"
              placeholderTextColor="#475569"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />
          </View>

          <TouchableOpacity
            className={`w-full rounded-2xl py-5 items-center justify-center mt-8 premium-shadow ${loading ? 'bg-brand-primary/50' : 'bg-brand-primary'}`}
            onPress={handleSignUp}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text className="text-white font-black text-lg tracking-tight">
                {invitation ? 'Join Team' : 'Create Account'}
              </Text>
            )}
          </TouchableOpacity>
        </View>

        <View className="mt-10 items-center mb-8">
          <Text className="text-typography-muted font-medium">
            Already have an account?{' '}
            <Link href="/(auth)/login" asChild>
              <Text className="text-brand-primary font-black">Sign In</Text>
            </Link>
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
