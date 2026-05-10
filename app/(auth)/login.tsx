import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Link } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { getErrorMessage, isValidEmail } from '../../lib/auth-errors';
import { supabase } from '../../lib/supabase';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      console.debug('[Login] attempting signInWithPassword', { email: email?.trim() });
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      console.debug('[Login] signIn response', { data, signInError });

      if (signInError) {
        setError(getErrorMessage(signInError));
        return;
      }

      if (!data?.session) {
        setError('Please check your email to verify your account before logging in.');
        return;
      }

      // Session change will be handled by AuthContext/RootLayout
    } catch (err) {
      console.error('[Login] unexpected error', err);
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1 bg-surface-background px-8"
    >
      <View className="flex-1 justify-center max-w-[480px] w-full self-center">
        <View className="items-center mb-12">
          <View className="w-20 h-20 bg-brand-primary rounded-3xl flex-center premium-shadow mb-6">
            <FontAwesome name="shield" size={40} color="white" />
          </View>
          <Text className="text-4xl font-extrabold text-typography-main tracking-tighter text-glow">TrustFlow</Text>
          <Text className="text-typography-muted text-base mt-2 font-medium">Precision Productivity</Text>
        </View>

        {error && (
          <View className="mb-6 bg-state-danger/10 border border-state-danger/20 p-4 rounded-xl flex-row items-center">
            <FontAwesome name="exclamation-circle" size={16} className="text-state-danger" />
            <Text className="text-state-danger text-xs font-bold ml-3 flex-1">{error}</Text>
          </View>
        )}

        <View className="space-y-5">
          <View>
            <Text className="text-typography-dim text-[10px] font-black uppercase tracking-widest mb-2 ml-1">Work Email</Text>
            <TextInput
              className="w-full bg-surface-card border border-surface-border rounded-2xl px-5 py-4 text-typography-main font-medium"
              placeholder="name@company.com"
              placeholderTextColor="var(--color-text-dim)"
              keyboardType="email-address"
              autoCapitalize="none"
              value={email}
              onChangeText={setEmail}
            />
          </View>

          <View>
            <View className="flex-row justify-between items-center mb-2 ml-1">
              <Text className="text-typography-dim text-[10px] font-black uppercase tracking-widest">Password</Text>
              <TouchableOpacity>
                <Text className="text-brand-primary text-[10px] font-bold">Forgot?</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              className="w-full bg-surface-card border border-surface-border rounded-2xl px-5 py-4 text-typography-main font-medium"
              placeholder="••••••••"
              placeholderTextColor="var(--color-text-dim)"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />
          </View>

          <TouchableOpacity
            className={`w-full rounded-2xl py-5 items-center justify-center mt-8 premium-shadow ${loading ? 'bg-brand-primary/50' : 'bg-brand-primary'}`}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text className="text-typography-main font-bold text-lg">Sign In</Text>
            )}
          </TouchableOpacity>
        </View>

        <View className="mt-12 items-center">
          <Text className="text-typography-muted font-medium">
            New to the edge?{' '}
            <Link href="/(auth)/sign-up" asChild>
              <Text className="text-brand-primary font-black">Create Account</Text>
            </Link>
          </Text>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
