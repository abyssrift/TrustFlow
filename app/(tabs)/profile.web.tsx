import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { Stack } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { useAlert } from '@/contexts/AlertContext';
import { supabase } from '@/lib/supabase';
import ProfileAvatar from '@/components/profile/ProfileAvatar';
import ProfileGeneralForm from '@/components/profile/ProfileGeneralForm';
import SecurityForm from '@/components/profile/SecurityForm';
import StatsGrid from '@/components/profile/StatsGrid';
import FontAwesome from '@expo/vector-icons/FontAwesome';

type TabType = 'general' | 'security' | 'stats';

export default function ProfilePageWeb() {
  const { user, signOut, refreshProfile } = useAuth();
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
      <View className="flex-1 items-center justify-center bg-surface-background">
        <ActivityIndicator size="large" color="rgb(var(--brand-primary))" />
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
            <FontAwesome name="sign-out" size={14} color="rgb(var(--typography-main))" style={{ marginRight: 12 }} />
            <Text className="text-xs font-black uppercase tracking-widest text-typography-main">Sign Out</Text>
          </Pressable>
        </View>
      </View>

      {/* Main Content Area */}
      <ScrollView className="flex-1" contentContainerStyle={{ padding: 48 }}>
        <View className="max-w-3xl mx-auto w-full">
          <View className="mb-10">
             <Text className="text-3xl font-black text-typography-main mb-2">
               {activeTab === 'general' ? 'Account Settings' : activeTab === 'stats' ? 'Your Intelligence' : 'Security Suite'}
             </Text>
             <Text className="text-typography-muted font-bold text-sm">
               Manage your account preferences and view system-level metrics associated with your identity.
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
            {activeTab === 'stats' && <StatsGrid />}
            {activeTab === 'security' && <SecurityForm />}
          </View>
        </View>
      </ScrollView>
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
