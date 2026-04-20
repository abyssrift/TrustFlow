import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';

export default function SignUpScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSignUp = async () => {
    if (!email || !password || !fullName || !companyName) {
      Alert.alert('Error', 'Please fill in all fields.');
      return;
    }

    setLoading(true);
    
    const { error, data } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          company_name: companyName,
        },
      },
    });

    if (error) {
      Alert.alert('Registration Failed', error.message);
    } else {
      if (data?.session) {
        // Redirection handled by AuthContext listener
      } else {
        Alert.alert('Success', 'Please check your email for the confirmation link.');
        router.replace('/(auth)/login');
      }
    }
    
    setLoading(false);
  };

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
          <Text className="text-3xl font-black text-typography-main tracking-tighter text-glow">Join TrustEdge</Text>
          <Text className="text-typography-muted text-sm font-medium mt-1">Scale your company's efficiency</Text>
        </View>

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
            <Text className="text-typography-dim text-[10px] font-black uppercase tracking-widest mb-2 ml-1">Company Name</Text>
            <TextInput
              className="w-full bg-surface-card border border-surface-border rounded-2xl px-5 py-4 text-typography-main font-medium"
              placeholder="Acme Corp"
              placeholderTextColor="#475569"
              autoCapitalize="words"
              value={companyName}
              onChangeText={setCompanyName}
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
              <Text className="text-white font-black text-lg tracking-tight">Create Account</Text>
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
