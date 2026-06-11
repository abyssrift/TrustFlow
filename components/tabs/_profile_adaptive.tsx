import React, { useEffect, useState } from 'react';
import { ScrollView, View, Text, Pressable, RefreshControl, Alert, ActivityIndicator, Platform } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { useAlert } from '@/contexts/AlertContext';
import { supabase } from '@/lib/supabase';
import ProfileAvatar from '@/components/profile/ProfileAvatar';
import ProfileGeneralForm from '@/components/profile/ProfileGeneralForm';
import SecurityForm from '@/components/profile/SecurityForm';
import { ProfileAnalytics } from '@/components/analytics/ProfileAnalytics';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useTheme, ThemeType } from '@/contexts/ThemeContext';
import { useThemeColors } from '@/hooks/useThemeColors';

const THEME_OPTIONS: { id: ThemeType; label: string; icon: string }[] = [
  { id: 'indigo', label: 'Indigo', icon: 'moon-o' },
  { id: 'emerald', label: 'Emerald', icon: 'leaf' },
  { id: 'amber', label: 'Amber', icon: 'sun-o' },
  { id: 'amethyst', label: 'Amethyst', icon: 'diamond' },
  { id: 'light', label: 'Light', icon: 'certificate' },
  { id: 'dark', label: 'Dark', icon: 'circle-o' },
];

export default function ProfilePage() {
  const colors = useThemeColors();
  const router = useRouter();
  const { showConfirm, showAlert } = useAlert();
  const { user, signOut, refreshProfile, hasPermission } = useAuth();
  const { theme: activeTheme, setTheme } = useTheme();
  const [profileData, setProfileData] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchProfile = async () => {
    if (!user?.id) return;
    const { data, error } = await supabase
      .from('users')
      .select('*, companies(name)')
      .eq('id', user.id)
      .single();
    
    if (!error && data) {
      setProfileData({
        ...data,
        company_name: data.companies?.name
      });
    }
  };

  useEffect(() => {
    fetchProfile();
  }, [user?.id]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchProfile();
    setRefreshing(false);
  };

  const handleLeaveWorkspace = async () => {
    showConfirm(
      'Leave Workspace',
      'Are you sure you want to leave this workspace? You will lose access to all data within this company.',
      async () => {
        try {
          const { error } = await supabase.rpc('rpc_leave_company');
          if (error) throw error;
          await refreshProfile();
        } catch (err: any) {
          showAlert('Error', err.message || 'Failed to leave workspace');
        }
      },
      undefined,
      'Leave',
      'Cancel'
    );
  };

  const handleDisbandWorkspace = async () => {
    showConfirm(
      'Disband Workspace',
      'WARNING: This will permanently delete this workspace and all associated data for ALL members. This action cannot be undone. Are you absolutely sure?',
      async () => {
        try {
          const { error } = await supabase.rpc('rpc_delete_company');
          if (error) throw error;
          await refreshProfile();
        } catch (err: any) {
          showAlert('Error', err.message || 'Failed to disband workspace');
        }
      },
      undefined,
      'Disband',
      'Cancel'
    );
  };

  if (!profileData) {
    return (
      <View className="flex-1 bg-surface-background items-center justify-center">
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-surface-background"
      contentContainerStyle={{ padding: 20, paddingTop: Platform.OS !== 'web' ? 58 : 20, paddingBottom: 100 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      <Stack.Screen options={{ title: 'My Profile', headerLargeTitle: true }} />

      {/* Header Section */}
      <View className="items-center mb-8">
        <ProfileAvatar 
          url={profileData.avatar_url} 
          name={profileData.display_name || profileData.full_name || 'User'} 
          onUpload={(url) => {
            setProfileData((prev: any) => ({ ...prev, avatar_url: url }));
          }}
        />
        <Text className="mt-4 text-2xl font-black text-typography-main">
          {profileData.display_name || profileData.full_name || 'Set your name'}
        </Text>
        <Text className="text-sm font-bold text-brand-primary uppercase tracking-widest">
          {profileData.job_title || (profileData.is_owner ? 'Workspace Owner' : 'New Member')}
        </Text>
      </View>

      {/* Analytics Section */}
      {user?.id && (
        <View className="mb-10">
          <Text className="mb-4 text-[10px] font-black uppercase tracking-[0.3em] text-typography-dim">Performance Intelligence</Text>
          <ProfileAnalytics userId={user.id} />
        </View>
      )}

      {/* Forms Section */}
      <View className="gap-10">
        <View>
          <Text className="mb-4 text-[10px] font-black uppercase tracking-[0.3em] text-typography-dim">General Information</Text>
          <View className="rounded-2xl border border-surface-border bg-surface-card p-6 premium-shadow">
            <ProfileGeneralForm 
              initialData={{
                full_name: profileData.full_name || '',
                display_name: profileData.display_name || '',
                job_title: profileData.job_title || '',
                department: profileData.department || '',
                company_name: profileData.company_name
              }}
              onSuccess={fetchProfile}
            />
          </View>
        </View>

        <View>
          <Text className="mb-4 text-[10px] font-black uppercase tracking-[0.3em] text-typography-dim">Security & Access</Text>
          <View className="rounded-2xl border border-surface-border bg-surface-card p-6 premium-shadow">
            <SecurityForm />
          </View>
        </View>

        <View>
          <Text className="mb-4 text-[10px] font-black uppercase tracking-[0.3em] text-typography-dim">Appearance & Theme</Text>
          <View className="rounded-2xl border border-surface-border bg-surface-card p-4 premium-shadow">
            <View className="flex-row flex-wrap gap-3">
              {THEME_OPTIONS.map((option) => (
                <Pressable
                  key={option.id}
                  onPress={() => setTheme(option.id)}
                  className={`h-20 w-[30%] items-center justify-center rounded-xl border transition-all ${
                    activeTheme === option.id
                      ? 'border-brand-primary bg-brand-primary/10'
                      : 'border-surface-border bg-surface-background/50'
                  }`}
                >
                  <FontAwesome
                    name={option.icon as any}
                    size={20}
                    color={activeTheme === option.id ? colors.primary : colors.textDim}
                  />
                  <Text className={`mt-2 text-[10px] font-black uppercase tracking-widest ${
                    activeTheme === option.id ? 'text-brand-primary' : 'text-typography-muted'
                  }`}>
                    {option.label}
                  </Text>
                  {activeTheme === option.id && (
                    <View className="absolute top-1 right-1">
                      <FontAwesome name="check-circle" size={10} color={colors.primary} />
                    </View>
                  )}
                </Pressable>
              ))}
            </View>
          </View>
        </View>


        <View>
          <Text className="mb-4 text-[10px] font-black uppercase tracking-[0.3em] text-typography-dim">Notifications</Text>
          <View className="rounded-2xl border border-surface-border bg-surface-card overflow-hidden">
            <Pressable
              onPress={() => router.push('/notifications/preferences' as any)}
              className={`h-14 flex-row items-center px-5 active:bg-surface-overlay ${hasPermission('manage_notifications') || hasPermission('role.manage') ? 'border-b border-surface-border' : ''}`}
            >
              <FontAwesome name="bell" size={16} color={colors.primary} style={{ marginRight: 12 }} />
              <Text className="flex-1 text-sm font-bold text-typography-main">Notification Preferences</Text>
              <FontAwesome name="chevron-right" size={12} color={colors.textMuted} />
            </Pressable>
            {(hasPermission('manage_notifications') || hasPermission('role.manage')) && (
              <Pressable
                onPress={() => router.push('/admin/notifications' as any)}
                className="h-14 flex-row items-center px-5 active:bg-surface-overlay"
              >
                <FontAwesome name="gear" size={16} color={colors.primary} style={{ marginRight: 12 }} />
                <Text className="flex-1 text-sm font-bold text-typography-main">Workspace Notification Rules</Text>
                <FontAwesome name="chevron-right" size={12} color={colors.textMuted} />
              </Pressable>
            )}
          </View>
        </View>

        {profileData.company_id && (
          <View className="gap-2">
            {profileData.is_owner && (
              <Pressable
                onPress={handleDisbandWorkspace}
                className="h-14 flex-row items-center justify-center rounded-2xl border border-state-danger bg-state-danger/10 active:bg-state-danger/20 mb-2"
              >
                <FontAwesome name="trash" size={18} color="#ef4444" style={{ marginRight: 12 }} />
                <Text className="text-sm font-black uppercase tracking-widest text-state-danger">Disband Workspace</Text>
              </Pressable>
            )}

            <Pressable
              onPress={handleLeaveWorkspace}
              className="h-14 flex-row items-center justify-center rounded-2xl border border-state-danger/30 bg-state-danger/5 active:bg-state-danger/10 mb-4"
            >
              <FontAwesome name="minus-circle" size={18} color="#ef4444" style={{ marginRight: 12 }} />
              <Text className="text-sm font-black uppercase tracking-widest text-state-danger">Leave Current Workspace</Text>
            </Pressable>
          </View>
        )}

        <Pressable
          onPress={() => signOut()}
          className="h-14 flex-row items-center justify-center rounded-2xl border border-typography-dim/30 bg-surface-overlay active:bg-surface-border"
        >
          <FontAwesome name="sign-out" size={18} color={colors.textMain} style={{ marginRight: 12 }} />
          <Text className="text-sm font-black uppercase tracking-widest text-typography-main">Sign Out of Account</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
