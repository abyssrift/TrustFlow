import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator } from 'react-native';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeColors } from '@/hooks/useThemeColors';

interface ProfileGeneralFormProps {
  initialData: {
    full_name: string;
    display_name: string;
    job_title: string;
    department: string;
    company_name?: string;
  };
  onSuccess: () => void;
}

export default function ProfileGeneralForm({ initialData, onSuccess }: ProfileGeneralFormProps) {
  const colors = useThemeColors();
  const { user } = useAuth();
  const [formData, setFormData] = useState(initialData);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  const handleUpdate = async () => {
    try {
      setLoading(true);
      setMessage(null);

      const { error } = await supabase
        .from('users')
        .update({
          full_name: formData.full_name,
          display_name: formData.display_name,
          job_title: formData.job_title,
          department: formData.department,
          updated_at: new Date().toISOString(),
        })
        .eq('id', user?.id);

      if (error) throw error;

      setMessage({ type: 'success', text: 'Profile updated successfully!' });
      onSuccess();
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <View className="gap-6">
      <View className="gap-2">
        <Text className="text-[10px] font-black uppercase tracking-[0.2em] text-typography-dim">Full Name</Text>
        <TextInput
          value={formData.full_name}
          onChangeText={(text) => setFormData(prev => ({ ...prev, full_name: text }))}
          className="h-12 rounded-lg border border-surface-border bg-surface-background px-4 text-sm font-bold text-typography-main focus:border-brand-primary"
          placeholder="Enter your full name"
          placeholderTextColor={colors.textDim}
        />
      </View>

      <View className="gap-2">
        <Text className="text-[10px] font-black uppercase tracking-[0.2em] text-typography-dim">Display Name</Text>
        <TextInput
          value={formData.display_name}
          onChangeText={(text) => setFormData(prev => ({ ...prev, display_name: text }))}
          className="h-12 rounded-lg border border-surface-border bg-surface-background px-4 text-sm font-bold text-typography-main focus:border-brand-primary"
          placeholder="How should we call you?"
          placeholderTextColor={colors.textDim}
        />
      </View>

      <View className="flex-row gap-4">
        <View className="flex-1 gap-2">
          <Text className="text-[10px] font-black uppercase tracking-[0.2em] text-typography-dim">Job Title</Text>
          <TextInput
            value={formData.job_title}
            onChangeText={(text) => setFormData(prev => ({ ...prev, job_title: text }))}
            className="h-12 rounded-lg border border-surface-border bg-surface-background px-4 text-sm font-bold text-typography-main focus:border-brand-primary"
            placeholder="e.g. Senior Analyst"
            placeholderTextColor="#71717A"
          />
        </View>
        <View className="flex-1 gap-2">
          <Text className="text-[10px] font-black uppercase tracking-[0.2em] text-typography-dim">Department</Text>
          <TextInput
            value={formData.department}
            onChangeText={(text) => setFormData(prev => ({ ...prev, department: text }))}
            className="h-12 rounded-lg border border-surface-border bg-surface-background px-4 text-sm font-bold text-typography-main focus:border-brand-primary"
            placeholder="e.g. Operations"
            placeholderTextColor={colors.textDim}
          />
        </View>
      </View>

      <View className="gap-2">
        <Text className="text-[10px] font-black uppercase tracking-[0.2em] text-typography-dim">Corporate Entity</Text>
        <View className="h-12 justify-center rounded-lg border border-surface-border bg-surface-overlay/30 px-4">
          <Text className="text-sm font-bold text-typography-muted">{formData.company_name || 'N/A'}</Text>
        </View>
        <Text className="text-[10px] italic text-typography-dim">Contact your administrator to change corporate affiliation.</Text>
      </View>

      {message && (
        <View className={`rounded-xl p-4 ${message.type === 'success' ? 'bg-state-success/10 border border-state-success/30' : 'bg-state-danger/10 border border-state-danger/30'}`}>
          <Text className={`text-xs font-bold ${message.type === 'success' ? 'text-state-success' : 'text-state-danger'}`}>
            {message.text}
          </Text>
        </View>
      )}

      <Pressable
        onPress={handleUpdate}
        disabled={loading}
        className={`h-12 items-center justify-center rounded-xl bg-brand-primary shadow-lg active:scale-[0.98] transition-all ${loading ? 'opacity-70' : ''}`}
      >
        {loading ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text className="text-sm font-black uppercase tracking-widest text-white">Save Changes</Text>
        )}
      </Pressable>
    </View>
  );
}
