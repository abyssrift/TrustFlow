import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { Stack } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { useAlert } from '@/contexts/AlertContext';
import { supabase } from '@/lib/supabase';
import ProfileAvatar from '@/components/profile/ProfileAvatar';
import ProfileGeneralForm from '@/components/profile/ProfileGeneralForm';
import SecurityForm from '@/components/profile/SecurityForm';
import { ProfileAnalytics } from '@/components/analytics/ProfileAnalytics';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useTheme, ThemeType, DensityType, RoundnessType } from '@/contexts/ThemeContext';
import { RecentActivitySidebar } from '@/components/intelligence/RecentActivitySidebar';

const THEME_OPTIONS: { id: ThemeType; label: string; icon: string }[] = [
  { id: 'indigo', label: 'Indigo Night', icon: 'moon-o' },
  { id: 'emerald', label: 'Emerald Matrix', icon: 'leaf' },
  { id: 'amber', label: 'Amber Signal', icon: 'sun-o' },
  { id: 'amethyst', label: 'Amethyst Grid', icon: 'diamond' },
  { id: 'light', label: 'Light Mode', icon: 'certificate' },
  { id: 'dark', label: 'Dark Mode', icon: 'circle-o' },
];

type TabType = 'general' | 'security' | 'stats' | 'appearance';

export default function ProfilePageWeb() {
  const { user, signOut, refreshProfile } = useAuth();
  const { theme: activeTheme, setTheme, density, setDensity, roundness, setRoundness } = useTheme();
  const [activeTab, setActiveTab] = useState<TabType>('general');
  const [profileData, setProfileData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async () => {
    if (!user?.id) return;
    try {
      setLoading(true);
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
    } finally {
      setLoading(false);
    }
  };

  const { showConfirm, showAlert } = useAlert();

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
      }
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
      }
    );
  };

  useEffect(() => {
    fetchProfile();
  }, [user?.id]);

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-[var(--color-surface-background)]">
        <ActivityIndicator size="large" color="var(--color-brand-primary)" />
      </View>
    );
  }

  if (!profileData) return null;

  return (
    <View className="flex-1 bg-surface-background flex-row">
      <Stack.Screen options={{ title: 'Settings & Profile' }} />
      
      {/* Internal Sidebar */}
      <View className="w-80 border-r border-surface-border p-8 gap-8">
        <View className="items-center mb-4">
          <ProfileAvatar 
            url={profileData.avatar_url} 
            name={profileData.display_name || profileData.full_name || 'User'} 
            onUpload={(url) => {
              setProfileData((prev: any) => ({ ...prev, avatar_url: url }));
            }}
            size={100}
          />
          <Text className="mt-4 text-xl font-black text-typography-main text-center">
            {profileData.display_name || profileData.full_name || 'Set Name'}
          </Text>
          <Text className="text-[10px] font-bold text-brand-primary uppercase tracking-[0.2em] mt-1">
            {profileData.job_title || (profileData.is_owner ? 'Workspace Owner' : 'Workspace Member')}
          </Text>
        </View>

        <View className="gap-2">
          <TabButton 
            active={activeTab === 'general'} 
            onPress={() => setActiveTab('general')} 
            icon="user" 
            label="General Info" 
            description="Profile basics and metadata"
          />
          <TabButton 
            active={activeTab === 'stats'} 
            onPress={() => setActiveTab('stats')} 
            icon="line-chart" 
            label="Performance" 
            description="Your stats and analytics"
          />
          <TabButton 
            active={activeTab === 'security'} 
            onPress={() => setActiveTab('security')} 
            icon="lock" 
            label="Security" 
            description="Password and email settings"
          />
          <TabButton 
            active={activeTab === 'appearance'} 
            onPress={() => setActiveTab('appearance')} 
            icon="paint-brush" 
            label="Appearance" 
            description="Themes and interface settings"
          />
        </View>

        <View className="mt-auto gap-3">
          {profileData.company_id && (
            <View className="gap-2">
              {profileData.is_owner && (
                <Pressable
                  onPress={handleDisbandWorkspace}
                  className="h-12 flex-row items-center rounded-xl border border-state-danger bg-state-danger/10 px-4 hover:bg-state-danger/20 transition-colors"
                >
                  <FontAwesome name="trash" size={14} color="#ef4444" style={{ marginRight: 12 }} />
                  <Text className="text-xs font-black uppercase tracking-widest text-state-danger">Disband Workspace</Text>
                </Pressable>
              )}
              
              <Pressable
                onPress={handleLeaveWorkspace}
                className="h-12 flex-row items-center rounded-xl border border-state-danger/20 bg-state-danger/5 px-4 hover:bg-state-danger/10 transition-colors"
              >
                <FontAwesome name="minus-circle" size={14} color="#ef4444" style={{ marginRight: 12 }} />
                <Text className="text-xs font-black uppercase tracking-widest text-state-danger">Leave Workspace</Text>
              </Pressable>
            </View>
          )}

           <Pressable
            onPress={() => signOut()}
            className="h-12 flex-row items-center rounded-xl border border-typography-dim/20 bg-surface-overlay px-4 hover:bg-surface-border transition-colors"
          >
            <FontAwesome name="sign-out" size={14} color="var(--color-text-muted)" style={{ marginRight: 12 }} />
            <Text className="text-xs font-black uppercase tracking-widest text-typography-main">Sign Out</Text>
          </Pressable>
        </View>
      </View>

      {/* Main Content Area */}
      <ScrollView className="flex-1" contentContainerStyle={{ padding: 48 }}>
        <View className="max-w-3xl mx-auto w-full">
          <View className="mb-10">
             <Text className="text-3xl font-black text-typography-main mb-2">
               {activeTab === 'general' ? 'Account Settings' : activeTab === 'stats' ? 'Your Intelligence' : activeTab === 'security' ? 'Security Suite' : 'Interface Design'}
             </Text>
             <Text className="text-typography-muted font-bold text-sm">
               {activeTab === 'appearance' 
                 ? 'Customize the visual identity and interaction density of your workspace.' 
                 : 'Manage your account preferences and view system-level metrics associated with your identity.'}
             </Text>
          </View>

          <View className="rounded-3xl border border-surface-border bg-surface-card p-10 premium-shadow glass-card">
            {activeTab === 'general' && (
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
            )}
             {activeTab === 'stats' && user?.id && <ProfileAnalytics userId={user.id} />}
            {activeTab === 'security' && <SecurityForm />}
            {activeTab === 'appearance' && (
              <View className="gap-10">
                <View>
                  <Text className="mb-6 text-[10px] font-black uppercase tracking-[0.3em] text-typography-dim">Color Theme</Text>
                  <View className="flex-row flex-wrap gap-4">
                    {THEME_OPTIONS.map((option) => (
                      <Pressable
                        key={option.id}
                        onPress={() => setTheme(option.id)}
                        className={`h-24 w-32 items-center justify-center rounded-2xl border transition-all ${
                          activeTheme === option.id 
                            ? 'border-brand-primary bg-brand-primary/10' 
                            : 'border-surface-border bg-surface-background/50 hover:bg-surface-overlay'
                        }`}
                      >
                        <View className={`h-10 w-10 items-center justify-center rounded-xl ${activeTheme === option.id ? 'bg-brand-primary/20' : 'bg-surface-overlay'}`}>
                          <FontAwesome 
                            name={option.icon as any} 
                            size={18} 
                            color={activeTheme === option.id ? 'var(--color-primary)' : 'var(--color-text-dim)'} 
                          />
                        </View>
                        <Text className={`mt-3 text-[10px] font-black uppercase tracking-widest ${
                          activeTheme === option.id ? 'text-brand-primary' : 'text-typography-muted'
                        }`}>
                          {option.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>

                <View className="flex-row gap-10">
                  <View className="flex-1">
                    <Text className="mb-4 text-[10px] font-black uppercase tracking-[0.3em] text-typography-dim">Interface Density</Text>
                    <View className="flex-row gap-2 rounded-2xl border border-surface-border bg-surface-background/50 p-2">
                      {(['compact', 'normal', 'comfort'] as DensityType[]).map((d) => (
                        <Pressable
                          key={d}
                          onPress={() => setDensity(d)}
                          className={`h-12 flex-1 items-center justify-center rounded-xl transition-all ${
                            density === d ? 'bg-brand-primary shadow-lg' : 'hover:bg-surface-overlay'
                          }`}
                        >
                          <Text className={`text-xs font-black capitalize tracking-widest ${density === d ? 'text-white' : 'text-typography-muted'}`}>{d}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>

                  <View className="flex-1">
                    <Text className="mb-4 text-[10px] font-black uppercase tracking-[0.3em] text-typography-dim">Corner Roundness</Text>
                    <View className="flex-row gap-2 rounded-2xl border border-surface-border bg-surface-background/50 p-2">
                      {(['sharp', 'normal', 'soft'] as RoundnessType[]).map((r) => (
                        <Pressable
                          key={r}
                          onPress={() => setRoundness(r)}
                          className={`h-12 flex-1 items-center justify-center rounded-xl transition-all ${
                            roundness === r ? 'bg-brand-primary shadow-lg' : 'hover:bg-surface-overlay'
                          }`}
                        >
                          <Text className={`text-xs font-black capitalize tracking-widest ${roundness === r ? 'text-white' : 'text-typography-muted'}`}>{r}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                </View>
              </View>
            )}
          </View>
        </View>
      </ScrollView>

      {/* ── High-Density Activity Sidebar (Only on Performance Tab) ── */}
      {activeTab === 'stats' && <RecentActivitySidebar />}
    </View>
  );
}

function TabButton({ active, onPress, icon, label, description }: { 
  active: boolean, 
  onPress: () => void, 
  icon: any, 
  label: string,
  description: string 
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`p-4 rounded-2xl flex-row items-center border transition-all ${
        active ? 'bg-brand-primary/10 border-brand-primary/30' : 'bg-transparent border-transparent hover:bg-surface-card'
      }`}
    >
      <View className={`h-10 w-10 items-center justify-center rounded-xl ${active ? 'bg-brand-primary/20' : 'bg-surface-overlay'}`}>
        <FontAwesome name={icon} size={16} color={active ? '#6366f1' : '#64748b'} />
      </View>
      <View className="ml-4">
        <Text className={`text-sm font-black ${active ? 'text-brand-primary' : 'text-typography-main'}`}>{label}</Text>
        <Text className="text-[10px] font-bold text-typography-dim mt-0.5">{description}</Text>
      </View>
    </Pressable>
  );
}
