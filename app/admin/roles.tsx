import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, SafeAreaView, Platform, StatusBar } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { FontAwesome } from '@expo/vector-icons';
import { RoleManagerProvider, useRoleManager } from '@/contexts/RoleManagerContext';
import { useAuth } from '@/contexts/AuthContext';
import UserAssignmentGrid from '@/components/admin/UserAssignmentGrid';
import TeamAssignmentGrid from '@/components/admin/TeamAssignmentGrid';
import RoleBuilder from '@/components/admin/RoleBuilder';

function RolesLayout() {
  const { hasPermission, initialized: authInitialized } = useAuth();
  const { loading, error } = useRoleManager();
  const [activeTab, setActiveTab] = useState<'users' | 'teams' | 'roles'>('users');
  const router = useRouter();

  if (!authInitialized || loading) {
    return (
      <View className="flex-1 bg-surface-background items-center justify-center">
        <ActivityIndicator size="large" color="rgb(var(--brand-primary))" />
        <Text className="text-typography-muted mt-4 font-bold">Synchronizing RBAC...</Text>
      </View>
    );
  }

  if (!hasPermission('role.manage')) {
    return (
      <View className="flex-1 bg-surface-background items-center justify-center p-10">
        <View className="bg-state-danger-dim p-8 rounded-full mb-8 border border-state-danger/20">
          <FontAwesome name="lock" size={64} color="rgb(var(--state-danger))" />
        </View>
        <Text className="text-typography-main font-black text-3xl mt-4 tracking-tighter">Security Gated Content</Text>
        <Text className="text-typography-muted text-center mt-3 leading-6 max-w-xs">
          Your current credentials lack the <Text className="text-brand-primary font-black uppercase tracking-tighter">role.manage</Text> mandate required for this terminal.
        </Text>
        <TouchableOpacity 
          onPress={() => router.back()}
          className="mt-12 bg-surface-card px-10 py-5 rounded-2xl border border-surface-border premium-shadow active:scale-[0.98]"
        >
          <Text className="text-typography-main font-black uppercase tracking-widest text-[10px]">Return to Ops</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-surface-card" style={Platform.OS === 'android' ? { paddingTop: StatusBar.currentHeight } : {}}>
      <View className="flex-1 bg-surface-background" style={Platform.OS === 'web' ? { minHeight: '100vh' } : {}}>
        <Stack.Screen options={{ headerShown: false }} />
        
        {/* Header */}
        <View className="bg-surface-card px-4 pt-4 pb-6 border-b border-surface-border">
          <View className="flex-row items-center justify-between mb-6">
            <TouchableOpacity
              onPress={() => router.back()}
              className="flex-row items-center h-11 pr-4"
            >
              <FontAwesome name="chevron-left" size={14} color="#94a3b8" />
              <Text className="text-typography-muted font-bold text-sm ml-2">Back</Text>
            </TouchableOpacity>
            <View className="bg-brand-primary-dim px-3 py-1 rounded-full border border-brand-primary/20">
              <Text className="text-brand-primary text-[9px] font-black uppercase tracking-widest">Access Manager</Text>
            </View>
          </View>

          {/* Title Section */}
          <View className="px-2 mb-8">
            <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.25em] mb-1">Administrative Shell / RBAC</Text>
            <Text className="text-typography-main text-3xl font-black tracking-tight">Protocol Sovereignty</Text>
          </View>

          {/* Tabs - Now following the Chip pattern */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="px-1">
            <View className="flex-row gap-2">
              {[
                { id: 'users', label: 'Individuals', icon: 'user' },
                { id: 'teams', label: 'Teams', icon: 'group' },
                { id: 'roles', label: 'Registry Builder', icon: 'shield' },
              ].map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <TouchableOpacity
                    key={tab.id}
                    onPress={() => setActiveTab(tab.id as any)}
                    className={`px-5 py-3 rounded-xl border flex-row items-center transition-all ${
                      isActive 
                        ? 'bg-brand-primary border-brand-primary premium-shadow' 
                        : 'bg-surface-background border-surface-border'
                    }`}
                  >
                    <FontAwesome 
                      name={tab.icon as any} 
                      size={12} 
                      color={isActive ? 'white' : '#64748b'} 
                    />
                    <Text className={`font-black text-[11px] uppercase tracking-wider ml-2.5 ${isActive ? 'text-typography-main' : 'text-typography-muted'}`}>
                      {tab.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
        </View>

        {/* Content - Ensured flex-1 for background coverage */}
        <View className="flex-1 px-4 pt-6">
          {activeTab === 'users' && <UserAssignmentGrid />}
          {activeTab === 'teams' && <TeamAssignmentGrid />}
          {activeTab === 'roles' && <RoleBuilder />}
        </View>

        {/* Error Overlay */}
        {error && (
          <View className="absolute bottom-10 left-6 right-6 bg-state-danger p-4 rounded-2xl flex-row items-center border border-white/20">
            <FontAwesome name="warning" size={16} color="white" />
            <Text className="text-typography-main font-bold ml-3 flex-1 text-xs">{error}</Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

export default function RolesScreen() {
  return (
    <RoleManagerProvider>
      <RolesLayout />
    </RoleManagerProvider>
  );
}
