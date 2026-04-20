import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please enter both email and password.');
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      Alert.alert('Login Failed', error.message);
    }
    setLoading(false);
  };

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1 bg-surface-background px-8"
    >
      <View className="flex-1 justify-center">
        <View className="items-center mb-12">
          <View className="w-20 h-20 bg-brand-primary rounded-3xl flex-center premium-shadow mb-6">
            <FontAwesome name="shield" size={40} color="white" />
          </View>
          <Text className="text-4xl font-extrabold text-typography-main tracking-tighter text-glow">TrustEdge</Text>
          <Text className="text-typography-muted text-base mt-2 font-medium">Precision Productivity</Text>
        </View>

        <View className="space-y-5">
          <View>
            <Text className="text-typography-dim text-[10px] font-black uppercase tracking-widest mb-2 ml-1">Work Email</Text>
            <TextInput
              className="w-full bg-surface-card border border-surface-border rounded-2xl px-5 py-4 text-typography-main font-medium"
              placeholder="name@company.com"
              placeholderTextColor="#475569"
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
              placeholderTextColor="#475569"
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
              <Text className="text-white font-black text-lg tracking-tight">Sign In</Text>
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
