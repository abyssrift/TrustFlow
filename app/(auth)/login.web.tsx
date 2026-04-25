import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform, ImageBackground } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { getErrorMessage, isValidEmail } from '../../lib/auth-errors';

export default function LoginScreenWeb() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleLogin = async () => {
    if (!email || !password) {
      setError('Please enter both email and password.');
      return;
    }

    if (!isValidEmail(email)) {
      setError('Please enter a valid email address.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) {
        setError(getErrorMessage(signInError));
        setLoading(false);
      }
      // Session change will be handled by AuthContext/RootLayout
    } catch (err) {
      setError('An unexpected error occurred. Please try again.');
      setLoading(false);
    }
  };

  return (
    <View className="flex-1 bg-surface-background flex-row">
      {/* Visual Side (Left) */}
      <View className="hidden lg:flex flex-1 bg-brand-primary items-center justify-center relative overflow-hidden">
        <View className="absolute inset-0 bg-black/20" />
        <View className="z-10 items-center p-12">
          <View className="w-24 h-24 bg-white/10 rounded-[2.5rem] flex-center backdrop-blur-xl border border-white/20 mb-8">
            <FontAwesome name="shield" size={48} color="white" />
          </View>
          <Text className="text-6xl font-black text-white tracking-tighter mb-4">TrustFlow</Text>
          <Text className="text-white/80 text-xl font-medium text-center max-w-md leading-relaxed">
            The next generation of high-fidelity productivity and tactical coordination.
          </Text>

          <View className="mt-16 flex-row gap-8">
            <View className="items-center">
              <Text className="text-white text-3xl font-black">99.9%</Text>
              <Text className="text-white/60 text-[10px] font-black uppercase tracking-widest mt-1">Reliability</Text>
            </View>
            <View className="w-px h-12 bg-white/20" />
            <View className="items-center">
              <Text className="text-white text-3xl font-black">E2EE</Text>
              <Text className="text-white/60 text-[10px] font-black uppercase tracking-widest mt-1">Security</Text>
            </View>
          </View>
        </View>

        {/* Decorative elements */}
        <View className="absolute -bottom-24 -left-24 w-96 h-96 bg-white/5 rounded-full" />
        <View className="absolute -top-24 -right-24 w-64 h-64 bg-white/5 rounded-full" />
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
            <Text className="text-4xl font-black text-typography-main tracking-tighter">Welcome Back</Text>
            <Text className="text-typography-muted mt-2 font-medium">Enter your credentials to access your workspace.</Text>
          </View>

          {error && (
            <View className="mb-6 bg-state-danger/10 border border-state-danger/20 p-4 rounded-xl flex-row items-center">
              <FontAwesome name="exclamation-circle" size={16} className="text-state-danger" />
              <Text className="text-state-danger text-sm font-bold ml-3">{error}</Text>
            </View>
          )}

          <View className="gap-6">
            <View>
              <Text className="text-typography-dim text-[10px] font-black uppercase tracking-[0.2em] mb-3 ml-1">Corporate Email</Text>
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

            <View>
              <View className="flex-row justify-between items-center mb-3 ml-1">
                <Text className="text-typography-dim text-[10px] font-black uppercase tracking-[0.2em]">Password</Text>
                <TouchableOpacity>
                  <Text className="text-brand-primary text-[10px] font-black uppercase tracking-widest">Recovery</Text>
                </TouchableOpacity>
              </View>
              <TextInput
                className="w-full bg-surface-card border border-surface-border rounded-2xl px-6 py-4 text-typography-main font-bold focus:border-brand-primary transition-all"
                placeholder="••••••••"
                placeholderTextColor="rgba(var(--text-muted), 0.5)"
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />
            </View>

            <TouchableOpacity
              className={`w-full rounded-2xl py-5 items-center justify-center mt-4 premium-shadow ${loading ? 'bg-brand-primary/50' : 'bg-brand-primary active:scale-[0.99] transition-transform'}`}
              onPress={handleLogin}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text className="text-white font-black text-sm uppercase tracking-widest">Initialize Session</Text>
              )}
            </TouchableOpacity>
          </View>

          <View className="mt-12 flex-row items-center justify-center pt-8 border-t border-surface-border">
            <Text className="text-typography-muted font-medium">New member?</Text>
            <Link href="/(auth)/sign-up" asChild>
              <TouchableOpacity className="ml-2">
                <Text className="text-brand-primary font-black uppercase tracking-widest text-[10px]">Create Workspace</Text>
              </TouchableOpacity>
            </Link>
          </View>
        </View>
      </View>
    </View>
  );
}
