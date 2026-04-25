import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { Stack } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import ProfileAvatar from '@/components/profile/ProfileAvatar';
import ProfileGeneralForm from '@/components/profile/ProfileGeneralForm';
import SecurityForm from '@/components/profile/SecurityForm';
import StatsGrid from '@/components/profile/StatsGrid';
import FontAwesome from '@expo/vector-icons/FontAwesome';

type TabType = 'general' | 'security' | 'stats';

export default function ProfilePageWeb() {
  const { user, signOut } = useAuth();
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
              setProfileData(prev => ({ ...prev, avatar_url: url }));
            }}
            size={100}
          />
          <Text className="mt-4 text-xl font-black text-typography-main text-center">
            {profileData.display_name || profileData.full_name || 'Set Name'}
          </Text>
          <Text className="text-[10px] font-bold text-brand-primary uppercase tracking-[0.2em] mt-1">
            {profileData.job_title || 'Workspace Member'}
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

        <View className="mt-auto">
           <Pressable
            onPress={() => signOut()}
            className="h-12 flex-row items-center rounded-xl border border-brand-danger/20 bg-brand-danger/5 px-4 hover:bg-brand-danger/10 transition-colors"
          >
            <FontAwesome name="sign-out" size={14} className="text-brand-danger mr-3" />
            <Text className="text-xs font-black uppercase tracking-widest text-brand-danger">Sign Out</Text>
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
        <FontAwesome name={icon} size={16} className={active ? 'text-brand-accent' : 'text-typography-dim'} />
      </View>
      <View className="ml-4">
        <Text className={`text-sm font-black ${active ? 'text-brand-primary' : 'text-typography-main'}`}>{label}</Text>
        <Text className="text-[10px] font-bold text-typography-dim mt-0.5">{description}</Text>
      </View>
    </Pressable>
  );
}
