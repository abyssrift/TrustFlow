import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator } from 'react-native';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeColors } from '@/hooks/useThemeColors';

export default function SecurityForm() {
  const colors = useThemeColors();
  const { user } = useAuth();
  const [email, setEmail] = useState(user?.email || '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  const handleUpdateEmail = async () => {
    if (!email || email === user?.email) return;
    try {
      setLoading(true);
      const { error } = await supabase.auth.updateUser({ email });
      if (error) throw error;
      setMessage({ type: 'success', text: 'Confirmation email sent to both old and new addresses.' });
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message });
    } finally {
      setLoading(false);
    }
  };

  const handleUpdatePassword = async () => {
    if (!password) return;
    if (password !== confirmPassword) {
      setMessage({ type: 'error', text: 'Passwords do not match.' });
      return;
    }
    try {
      setLoading(true);
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setMessage({ type: 'success', text: 'Password updated successfully!' });
      setPassword('');
      setConfirmPassword('');
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <View className="gap-8">
      {/* Email Section */}
      <View className="gap-4">
        <View>
          <Text className="text-[10px] font-black uppercase tracking-[0.2em] text-typography-dim">Email Address</Text>
          <Text className="mt-1 text-[10px] text-typography-muted italic">Updating email requires dual-confirmation.</Text>
        </View>
        <TextInput
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          className="h-12 rounded-lg border border-surface-border bg-surface-background px-4 text-sm font-bold text-typography-main focus:border-brand-primary"
          placeholder="New email address"
          placeholderTextColor={colors.textDim}
        />
        <Pressable
          onPress={handleUpdateEmail}
          disabled={loading || email === user?.email}
          className={`h-11 items-center justify-center rounded-xl border border-brand-primary/30 bg-brand-primary/5 active:bg-brand-primary/10 transition-colors ${loading || email === user?.email ? 'opacity-50' : ''}`}
        >
          <Text className="text-xs font-black uppercase tracking-widest text-brand-primary">Update Email</Text>
        </Pressable>
      </View>

      <View className="h-[1px] bg-surface-border/50" />

      {/* Password Section */}
      <View className="gap-4">
        <Text className="text-[10px] font-black uppercase tracking-[0.2em] text-typography-dim">Security Password</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          className="h-12 rounded-lg border border-surface-border bg-surface-background px-4 text-sm font-bold text-typography-main focus:border-brand-primary"
          placeholder="New password (min 6 chars)"
          placeholderTextColor={colors.textDim}
        />
        <TextInput
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry
          className="h-12 rounded-lg border border-surface-border bg-surface-background px-4 text-sm font-bold text-typography-main focus:border-brand-primary"
          placeholder="Confirm new password"
          placeholderTextColor={colors.textDim}
        />
        <Pressable
          onPress={handleUpdatePassword}
          disabled={loading || !password}
          className={`h-11 items-center justify-center rounded-xl border border-brand-primary/30 bg-brand-primary/5 active:bg-brand-primary/10 transition-colors ${loading || !password ? 'opacity-50' : ''}`}
        >
          <Text className="text-xs font-black uppercase tracking-widest text-brand-primary">Update Password</Text>
        </Pressable>
      </View>

      {message && (
        <View className={`rounded-xl p-4 ${message.type === 'success' ? 'bg-state-success/10 border border-state-success/30' : 'bg-state-danger/10 border border-state-danger/30'}`}>
          <Text className={`text-xs font-bold ${message.type === 'success' ? 'text-state-success' : 'text-state-danger'}`}>
            {message.text}
          </Text>
        </View>
      )}
    </View>
  );
}
