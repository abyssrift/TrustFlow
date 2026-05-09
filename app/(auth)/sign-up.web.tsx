import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, Platform } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { getErrorMessage, isValidEmail, isStrongPassword } from '../../lib/auth-errors';

export default function SignUpScreenWeb() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const [invitation, setInvitation] = useState<{ company_name: string; invited_by_name: string } | null>(null);
  const router = useRouter();

  // Check for invitations in real-time
  React.useEffect(() => {
    const checkInvite = async () => {
      if (isValidEmail(email)) {
        try {
          const { data, error: rpcError } = await supabase.rpc('rpc_get_invitation_by_email', { p_email: email.trim() });
          if (!rpcError && data && data.length > 0) {
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
      const { data, error: signUpError } = await supabase.auth.signUp({
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
          // Success but needs email confirmation
          setIsSuccess(true);
          setLoading(false);
        } else {
          // Automatically signed in
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
      <View className="flex-1 bg-surface-background flex-row">
        <View className="hidden lg:flex flex-1 bg-brand-primary items-center justify-center relative overflow-hidden">
          <View className="absolute inset-0 bg-black/20" />
          <View className="z-10 items-center p-12">
            <View className="w-24 h-24 bg-white/10 rounded-[2.5rem] flex-center backdrop-blur-xl border border-white/20 mb-8">
              <FontAwesome name="envelope-o" size={40} color="white" />
            </View>
            <Text className="text-6xl font-black text-white tracking-tighter mb-4">Check Your Mail</Text>
            <Text className="text-white/80 text-xl font-medium text-center max-w-md leading-relaxed">
              We've sent a confirmation link to <Text className="text-white font-bold">{email}</Text>.
            </Text>
          </View>
        </View>

        <View className="flex-1 items-center justify-center p-8 bg-surface-background">
          <View className="w-full max-w-md items-center text-center">
            <View className="w-20 h-20 bg-state-success/10 rounded-3xl flex-center mb-8">
              <FontAwesome name="check-circle" size={40} className="text-state-success" />
            </View>
            <Text className="text-4xl font-black text-typography-main tracking-tighter mb-4 text-center">Verification Sent</Text>
            <Text className="text-typography-muted font-medium text-center mb-10 leading-relaxed">
              Almost there! Click the link in your email to activate your TrustFlow account. You can then sign in to access your workspace.
            </Text>
            
            <Link href="/(auth)/login" asChild>
              <TouchableOpacity className="w-full bg-brand-primary rounded-2xl py-5 items-center justify-center premium-shadow active:scale-[0.99] transition-transform">
                <Text className="text-white font-black text-sm uppercase tracking-widest">Return to Sign In</Text>
              </TouchableOpacity>
            </Link>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-surface-background flex-row">
      {/* Visual Side (Left) */}
      <View className="hidden lg:flex flex-1 bg-brand-primary items-center justify-center relative overflow-hidden">
        <View className="absolute inset-0 bg-black/20" />
        <View className="z-10 items-center p-12">
          <View className="w-24 h-24 bg-white/10 rounded-[2.5rem] flex-center backdrop-blur-xl border border-white/20 mb-8">
            <FontAwesome name="user-plus" size={40} color="white" />
          </View>
          <Text className="text-6xl font-black text-white tracking-tighter mb-4">Join TrustFlow</Text>
          <Text className="text-white/80 text-xl font-medium text-center max-w-md leading-relaxed">
            Empower your team with a platform built for speed, security, and precision.
          </Text>
        </View>

        <View className="absolute -top-24 -left-24 w-96 h-96 bg-white/5 rounded-full" />
        <View className="absolute -bottom-24 -right-24 w-64 h-64 bg-white/5 rounded-full" />
      </View>

      {/* Form Side (Right) */}
      <View className="flex-1 items-center justify-center p-8 bg-surface-background">
        <View className="w-full max-w-md">
          <View className="lg:hidden items-center mb-8">
            <View className="w-16 h-16 bg-brand-primary rounded-2xl flex-center mb-4">
              <FontAwesome name="shield" size={32} color="white" />
            </View>
            <Text className="text-3xl font-black text-typography-main tracking-tighter">TrustFlow</Text>
          </View>
          <View className="mb-10">
            <Text className="text-4xl font-black text-typography-main tracking-tighter">Create Account</Text>
            <Text className="text-typography-muted font-medium mt-2">Get started with your secure workspace.</Text>
          </View>
          {error && (
            <View className="mb-6 bg-state-danger/10 border border-state-danger/20 p-4 rounded-xl flex-row items-center">
              <FontAwesome name="exclamation-circle" size={16} className="text-state-danger" />
              <Text className="text-state-danger text-sm font-bold ml-3">{error}</Text>
            </View>
          )}

          <View className="gap-5">
            <View>
              <Text className="text-typography-dim text-[10px] font-black uppercase tracking-[0.2em] mb-3 ml-1">Full Name</Text>
              <TextInput
                className="w-full bg-surface-card border border-surface-border rounded-2xl px-6 py-4 text-typography-main font-bold focus:border-brand-primary transition-all"
                placeholder="John Doe"
                placeholderTextColor="rgba(var(--text-muted), 0.5)"
                value={fullName}
                onChangeText={setFullName}
              />
            </View>

            <View>
              <Text className="text-typography-dim text-[10px] font-black uppercase tracking-[0.2em] mb-3 ml-1">Work Email</Text>
              <TextInput
                className="w-full bg-surface-card border border-surface-border rounded-2xl px-6 py-4 text-typography-main font-bold focus:border-brand-primary transition-all"
                placeholder="name@company.com"
                placeholderTextColor="rgba(var(--text-muted), 0.5)"
                keyboardType="email-address"
                autoCapitalize="none"
                value={email}
                onChangeText={setEmail}
              />
            </View>

            {invitation && (
              <View className="bg-brand-primary/10 border border-brand-primary/20 p-5 rounded-2xl">
                <View className="flex-row items-center mb-2">
                  <FontAwesome name="envelope-open" size={14} color="var(--color-primary)" />
                  <Text className="text-brand-primary text-[10px] font-black uppercase tracking-widest ml-2">Invitation Detected</Text>
                </View>
                <Text className="text-typography-main font-bold text-sm">
                  You'll be joining <Text className="text-brand-primary">{invitation.company_name}</Text> invited by {invitation.invited_by_name}.
                </Text>
              </View>
            )}

            <View>
              <Text className="text-typography-dim text-[10px] font-black uppercase tracking-[0.2em] mb-3 ml-1">Secure Password</Text>
              <TextInput
                className="w-full bg-surface-card border border-surface-border rounded-2xl px-6 py-4 text-typography-main font-bold focus:border-brand-primary transition-all"
                placeholder="Min. 8 characters"
                placeholderTextColor="rgba(var(--text-muted), 0.5)"
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />
            </View>

            <TouchableOpacity
              className={`w-full rounded-2xl py-5 items-center justify-center mt-4 premium-shadow ${loading ? 'bg-brand-primary/50' : 'bg-brand-primary active:scale-[0.99] transition-transform'}`}
              onPress={handleSignUp}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text className="text-white font-black text-sm uppercase tracking-widest">
                  {invitation ? 'Join Team' : 'Create Account'}
                </Text>
              )}
            </TouchableOpacity>
          </View>

          <View className="mt-10 flex-row items-center justify-center pt-8 border-t border-surface-border">
            <Text className="text-typography-muted font-medium">Already on the edge?</Text>
            <Link href="/(auth)/login" asChild>
              <TouchableOpacity className="ml-2">
                <Text className="text-brand-primary font-black uppercase tracking-widest text-[10px]">Sign In</Text>
              </TouchableOpacity>
            </Link>
          </View>
        </View>
      </View>
    </View>
  );
}
