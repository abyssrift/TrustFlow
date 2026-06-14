import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { supabase } from '@/lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';

interface CompanyData {
  name: string;
  description: string | null;
  logo_url: string | null;
  website: string | null;
}

export default function CompanyEditSettings() {
  const { profile, hasPermission } = useAuth();
  const { successToast, errorToast } = useToast();
  const colors = useThemeColors();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 1024;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [company, setCompany] = useState<CompanyData>({
    name: '',
    description: null,
    logo_url: null,
    website: null,
  });
  const [formData, setFormData] = useState<CompanyData>(company);
  const canEditCompany = hasPermission('company.edit');

  // Fetch current company data
  useEffect(() => {
    const fetchCompanyData = async () => {
      try {
        setLoading(true);
        if (!profile?.company_id) {
          errorToast('No company found');
          return;
        }

        const { data, error } = await supabase
          .from('companies')
          .select('name, description, logo_url, website')
          .eq('id', profile.company_id)
          .single();

        if (error) throw error;
        if (data) {
          setCompany(data);
          setFormData(data);
        }
      } catch (err: any) {
        console.error('Error fetching company data:', err);
        errorToast('Failed to load company settings');
      } finally {
        setLoading(false);
      }
    };

    fetchCompanyData();
  }, [profile?.company_id]);

  const handleSave = async () => {
    if (!profile?.company_id) {
      errorToast('No company found');
      return;
    }

    try {
      setSaving(true);
      const { data, error } = await supabase.rpc('rpc_update_company', {
        p_name: formData.name || null,
        p_description: formData.description || null,
        p_logo_url: formData.logo_url || null,
        p_website: formData.website || null,
      });

      if (error) {
        throw error;
      }

      if (data?.error) {
        errorToast(data.error);
        return;
      }

      setCompany(formData);
      successToast('Company settings updated!');
    } catch (err: any) {
      console.error('Save error:', err);
      errorToast(err.message || 'Failed to save company settings');
    } finally {
      setSaving(false);
    }
  };

  const hasChanges = JSON.stringify(company) !== JSON.stringify(formData);

  if (!canEditCompany) {
    return (
      <View className="bg-surface-card rounded-2xl p-6 border border-surface-border/50 items-center justify-center py-12">
        <FontAwesome name="lock" size={32} className="text-typography-dim mb-3" />
        <Text className="text-typography-dim text-sm text-center">
          You don't have permission to edit company settings. Contact your administrator.
        </Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View className="bg-surface-card rounded-2xl p-6 border border-surface-border items-center justify-center py-8">
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View className="bg-surface-card rounded-2xl p-6 border border-surface-border">
      <View className="flex-row items-center mb-6">
        <FontAwesome name="building" size={18} className="text-brand-primary mr-3" />
        <Text className="text-typography-main font-black text-lg">Company Profile</Text>
      </View>

      {/* Two-column layout on desktop, stacked on mobile */}
      <View className={isDesktop ? 'flex-row gap-6' : 'flex-col gap-4'}>
        {/* Left column: Name and Website */}
        <View className={isDesktop ? 'flex-1' : 'w-full'}>
          {/* Company Name */}
          <View className="mb-5">
            <Text className="text-typography-muted text-xs font-bold uppercase mb-2">Company Name</Text>
            <TextInput
              value={formData.name}
              onChangeText={(text) => setFormData({ ...formData, name: text })}
              placeholder="Your company name"
              placeholderTextColor={colors.textMuted}
              className="border border-surface-border rounded-xl px-4 py-3 bg-surface-background text-typography-main"
              style={{ color: colors.textMain }}
              editable={!saving}
            />
          </View>

          {/* Website */}
          <View className="mb-5">
            <Text className="text-typography-muted text-xs font-bold uppercase mb-2">Website</Text>
            <TextInput
              value={formData.website || ''}
              onChangeText={(text) => setFormData({ ...formData, website: text || null })}
              placeholder="https://example.com"
              placeholderTextColor={colors.textMuted}
              className="border border-surface-border rounded-xl px-4 py-3 bg-surface-background text-typography-main"
              style={{ color: colors.textMain }}
              keyboardType="url"
              editable={!saving}
            />
          </View>
        </View>

        {/* Right column: Description and Logo */}
        <View className={isDesktop ? 'flex-1' : 'w-full'}>
          {/* Description */}
          <View className="mb-5">
            <Text className="text-typography-muted text-xs font-bold uppercase mb-2">Description</Text>
            <TextInput
              value={formData.description || ''}
              onChangeText={(text) => setFormData({ ...formData, description: text || null })}
              placeholder="Brief description of your company"
              placeholderTextColor={colors.textMuted}
              className="border border-surface-border rounded-xl px-4 py-3 bg-surface-background text-typography-main"
              style={{ color: colors.textMain }}
              numberOfLines={4}
              multiline
              editable={!saving}
            />
          </View>

          {/* Logo URL */}
          <View className="mb-5">
            <Text className="text-typography-muted text-xs font-bold uppercase mb-2">Logo URL</Text>
            <TextInput
              value={formData.logo_url || ''}
              onChangeText={(text) => setFormData({ ...formData, logo_url: text || null })}
              placeholder="https://cdn.example.com/logo.png"
              placeholderTextColor={colors.textMuted}
              className="border border-surface-border rounded-xl px-4 py-3 bg-surface-background text-typography-main"
              style={{ color: colors.textMain }}
              keyboardType="url"
              editable={!saving}
            />
          </View>
        </View>
      </View>

      {/* Save button */}
      <TouchableOpacity
        onPress={handleSave}
        disabled={!hasChanges || saving}
        className={`rounded-lg py-3 flex-row items-center justify-center mt-6 ${
          hasChanges && !saving ? 'bg-brand-primary' : 'bg-surface-overlay opacity-50'
        }`}
      >
        {saving ? (
          <Text className="text-typography-main font-black text-xs uppercase">Saving...</Text>
        ) : (
          <>
            <FontAwesome name="save" size={12} className="text-typography-main mr-2" />
            <Text className="text-typography-main font-black text-xs uppercase">
              {hasChanges ? 'Save Changes' : 'No Changes'}
            </Text>
          </>
        )}
      </TouchableOpacity>

      <Text className="text-typography-dim text-xs mt-4 text-center">
        Update your company's public profile information.
      </Text>
    </View>
  );
}
