import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { companyInitials } from '@/lib/companyBranding';
import { supabase } from '@/lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as ImagePicker from 'expo-image-picker';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';

interface CompanyData {
  name: string;
  description: string | null;
  logo_url: string | null;
  website: string | null;
}

interface SelectedImage {
  uri: string;
  name: string;
  size: number;
}

export default function CompanyEditSettings() {
  const { profile, hasPermission } = useAuth();
  const { successToast, errorToast } = useToast();
  const colors = useThemeColors();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 1024;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedLogo, setSelectedLogo] = useState<SelectedImage | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
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

  const pickAndUploadLogo = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (result.canceled) return;

      const asset = result.assets[0];
      setSelectedLogo({
        uri: asset.uri,
        name: asset.fileName || 'logo.jpg',
        size: asset.fileSize || 0,
      });

      // Upload to storage
      setUploadingLogo(true);
      try {
        if (!profile?.company_id) {
          errorToast('No company found');
          return;
        }

        const fileExt = asset.fileName?.split('.').pop() || 'jpg';
        const storagePath = `${profile.company_id}/logo.${fileExt}`;

        const response = await fetch(asset.uri);
        if (!response.ok) {
          throw new Error(`Failed to fetch image: ${response.statusText}`);
        }
        const blob = await response.blob();

        const { error: uploadError } = await supabase.storage
          .from('company-logos')
          .upload(storagePath, blob, { upsert: true, contentType: `image/${fileExt}` });

        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage.from('company-logos').getPublicUrl(storagePath);
        const logoUrl = urlData?.publicUrl ? `${urlData.publicUrl}?v=${Date.now()}` : null;

        if (logoUrl) {
          setFormData({ ...formData, logo_url: logoUrl });
          successToast('Logo selected!');
        }
      } catch (err: any) {
        console.error('Upload error:', err);
        errorToast(err.message || 'Failed to upload logo');
        setSelectedLogo(null);
      } finally {
        setUploadingLogo(false);
      }
    } catch (err: any) {
      console.error('Image picker error:', err);
      errorToast('Failed to pick image');
    }
  };

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
    <View className="bg-surface-card rounded-2xl border border-surface-border overflow-hidden">
      <View className="p-5 border-b border-surface-border bg-surface-background">
        <View className={isDesktop ? 'flex-row items-center justify-between gap-6' : 'gap-4'}>
          <View className="flex-row items-center flex-1 gap-4">
            <View className="w-16 h-16 rounded-2xl overflow-hidden bg-brand-primary/10 border border-brand-primary/20 items-center justify-center">
              {formData.logo_url ? (
                <Image source={{ uri: formData.logo_url }} className="w-full h-full" resizeMode="cover" />
              ) : (
                <Text className="text-brand-primary font-black text-xl">{companyInitials(formData.name)}</Text>
              )}
            </View>
            <View className="flex-1">
              <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-1">Workspace profile</Text>
              <Text className="text-typography-main font-black text-xl" numberOfLines={1}>{formData.name || 'Your company'}</Text>
              <Text className="text-typography-muted text-xs mt-1" numberOfLines={2}>
                {formData.description || 'Add a short description to introduce your workspace.'}
              </Text>
            </View>
          </View>
          <View className={`self-start rounded-xl px-3 py-2 ${hasChanges ? 'bg-state-warning/10 border border-state-warning/30' : 'bg-state-success/10 border border-state-success/30'}`}>
            <Text className={`text-[10px] font-black uppercase tracking-wide ${hasChanges ? 'text-state-warning' : 'text-state-success'}`}>
              {hasChanges ? 'Unsaved changes' : 'Profile up to date'}
            </Text>
          </View>
        </View>
      </View>

      <View className="p-5">
        <View className="mb-5">
          <Text className="text-typography-main font-black text-base">Company details</Text>
          <Text className="text-typography-muted text-xs mt-1">These details appear wherever your workspace is identified.</Text>
        </View>

        {/* Two-column layout on desktop, stacked on mobile */}
        <View className={isDesktop ? 'flex-row gap-6' : 'gap-5'}>
          <View className={isDesktop ? 'flex-1' : 'w-full'}>
          <View className="mb-5">
            <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-2">Company name</Text>
            <TextInput
              value={formData.name}
              onChangeText={(text) => setFormData({ ...formData, name: text })}
              placeholder="Your company name"
              placeholderTextColor={colors.textMuted}
              className="min-h-11 border border-surface-border rounded-xl px-4 py-3 bg-surface-background text-typography-main"
              editable={!saving}
            />
          </View>

          <View className="mb-5">
            <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-2">Website</Text>
            <TextInput
              value={formData.website || ''}
              onChangeText={(text) => setFormData({ ...formData, website: text || null })}
              placeholder="https://example.com"
              placeholderTextColor={colors.textMuted}
              className="min-h-11 border border-surface-border rounded-xl px-4 py-3 bg-surface-background text-typography-main"
              keyboardType="url"
              editable={!saving}
            />
          </View>
        </View>

        <View className={isDesktop ? 'flex-1' : 'w-full'}>
          <View className="mb-5">
            <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-2">Description</Text>
            <TextInput
              value={formData.description || ''}
              onChangeText={(text) => setFormData({ ...formData, description: text || null })}
              placeholder="Brief description of your company"
              placeholderTextColor={colors.textMuted}
              className="min-h-28 border border-surface-border rounded-xl px-4 py-3 bg-surface-background text-typography-main"
              numberOfLines={4}
              multiline
              editable={!saving}
            />
          </View>

          <View>
            <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-2">Brand mark</Text>

            {/* Logo Preview */}
            {formData.logo_url && (
              <View className="mb-3 bg-surface-background rounded-xl p-3 border border-surface-border items-center justify-center h-24">
                <Image
                  source={{ uri: formData.logo_url }}
                  className="w-16 h-16 rounded-xl"
                  resizeMode="contain"
                />
              </View>
            )}

            {/* Upload Button */}
            <TouchableOpacity
              onPress={pickAndUploadLogo}
              disabled={uploadingLogo || saving}
              className={`min-h-20 border border-dashed rounded-xl p-4 items-center justify-center ${
                uploadingLogo ? 'border-brand-primary bg-brand-primary/5' : 'border-surface-border hover:border-brand-primary active:bg-brand-primary/5'
              }`}
            >
              {uploadingLogo ? (
                <>
                  <ActivityIndicator color={colors.primary} />
                  <Text className="text-typography-muted text-xs mt-2">Uploading...</Text>
                </>
              ) : (
                <>
                  <FontAwesome name="image" size={16} className="text-typography-muted mb-2" />
                  <Text className="text-typography-main font-bold text-sm text-center">
                    Choose company logo
                  </Text>
                  <Text className="text-typography-muted text-xs text-center mt-1">
                    JPG, PNG, or GIF
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
        </View>

      <TouchableOpacity
        onPress={handleSave}
        disabled={!hasChanges || saving}
        className={`min-h-11 rounded-xl px-4 py-3 flex-row items-center justify-center mt-6 ${
          hasChanges && !saving ? 'bg-brand-primary hover:bg-brand-primary-hover active:bg-brand-primary-active' : 'bg-surface-overlay'
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

      <Text className="text-typography-dim text-xs mt-3 text-center">
        Changes are saved only when you select Save changes.
      </Text>
      </View>
    </View>
  );
}
