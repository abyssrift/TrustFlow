import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Platform } from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { FontAwesome } from '@expo/vector-icons';
import { RoleManagerProvider, useRoleManager } from '@/contexts/RoleManagerContext';
import { useAuth } from '@/contexts/AuthContext';
import UserAssignmentGrid from '@/components/admin/UserAssignmentGrid';
import TeamAssignmentGrid from '@/components/admin/TeamAssignmentGrid';
import RoleBuilder from '@/components/admin/RoleBuilder';

function RolesWebLayout() {
  const { tab } = useLocalSearchParams();
  const { hasPermission, initialized: authInitialized } = useAuth();
  const { loading, error } = useRoleManager();
  const [activeTab, setActiveTab] = useState<'users' | 'teams' | 'roles'>((tab as any) || 'users');
  const router = useRouter();

  React.useEffect(() => {
    if (tab && (tab === 'users' || tab === 'teams' || tab === 'roles')) {
      setActiveTab(tab);
    }
  }, [tab]);

  if (!authInitialized || loading) {
    return (
      <View className="flex-1 bg-surface-background items-center justify-center">
        <ActivityIndicator size="large" color="var(--color-primary)" />
        <Text className="text-typography-muted mt-4 font-bold">Synchronizing RBAC Terminal...</Text>
      </View>
    );
  }

  if (!hasPermission('role.manage')) {
    return (
      <View className="flex-1 bg-surface-background items-center justify-center p-10">
        <View className="bg-state-danger/10 p-10 rounded-full mb-10 border border-state-danger/20">
          <FontAwesome name="lock" size={80} color="var(--color-danger)" />
        </View>
        <Text className="text-typography-main font-black text-4xl mt-4 tracking-tighter">Access Denied</Text>
        <Text className="text-typography-muted text-xl text-center mt-4 leading-8 max-w-md">
          Administrative privileges are required to access the Protocol Sovereignty registry. 
          Please contact your system architect.
        </Text>
        <TouchableOpacity 
          onPress={() => router.back()}
          className="mt-16 bg-brand-primary px-12 py-5 rounded-xl premium-shadow active:scale-[0.98]"
        >
          <Text className="text-typography-main font-black uppercase tracking-widest text-xs">Return to Dashboard</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-surface-background" style={{ height: '100vh', overflow: 'hidden' } as any}>
      <Stack.Screen options={{ headerShown: false }} />
      
      {/* High-Fidelity Desktop Header */}
      <View className="bg-surface-card px-8 py-8 border-b border-surface-border">
        <View className="flex-row items-center justify-between max-w-[1600px] mx-auto w-full">
          <View>
            <View className="flex-row items-center mb-4">
              <TouchableOpacity
                onPress={() => router.back()}
                className="flex-row items-center group"
              >
                <View className="w-8 h-8 rounded-lg bg-surface-background items-center justify-center border border-surface-border group-hover:border-brand-primary transition-colors">
                  <FontAwesome name="chevron-left" size={10} color="var(--color-text-muted)" />
                </View>
                <Text className="text-typography-muted font-bold text-xs ml-3 group-hover:text-typography-main transition-colors">Back to Admin</Text>
              </TouchableOpacity>
              <View className="w-1 h-1 rounded-full bg-surface-border mx-4" />
              <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.3em]">RBAC / RDAC</Text>
            </View>
            
            <View className="flex-row items-center">
              <View className="w-1.5 h-10 bg-brand-primary rounded-full mr-6" />
              <View>
                <Text className="text-typography-main text-4xl font-black tracking-tighter">Protocol Sovereignty</Text>
                <Text className="text-typography-muted text-sm mt-1 font-medium italic opacity-70">Define authority. Manage inheritance. Secure the matrix.</Text>
              </View>
            </View>
          </View>

          {/* Desktop Tab Switcher - Segmented Control Style */}
          <View className="bg-surface-background p-1.5 rounded-2xl border border-surface-border flex-row">
            {[
              { id: 'users', label: 'Individuals', icon: 'user' },
              { id: 'teams', label: 'Tactical Teams', icon: 'group' },
              { id: 'roles', label: 'Role Registry', icon: 'shield' },
            ].map((t) => {
              const isActive = activeTab === t.id;
              return (
                <TouchableOpacity
                  key={t.id}
                  onPress={() => setActiveTab(t.id as any)}
                  className={`px-8 py-4 rounded-xl flex-row items-center transition-all ${
                    isActive 
                      ? 'bg-surface-card border border-surface-border premium-shadow' 
                      : 'hover:bg-surface-card/40'
                  }`}
                >
                  <FontAwesome 
                    name={t.icon as any} 
                    size={14} 
                    color={isActive ? 'var(--color-primary)' : 'var(--color-text-muted)'} 
                  />
                  <Text className={`font-black text-xs uppercase tracking-widest ml-3 ${isActive ? 'text-typography-main' : 'text-typography-muted'}`}>
                    {t.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </View>

      {/* Main Content Area */}
      <View className="flex-1 max-w-[1600px] mx-auto w-full px-8 pt-10">
        <View className="flex-1">
          {activeTab === 'users' && <UserAssignmentGrid />}
          {activeTab === 'teams' && <TeamAssignmentGrid />}
          {activeTab === 'roles' && <RoleBuilder />}
        </View>
      </View>

      {/* Persistent Status Bar / Error Overlay */}
      {error && (
        <View className="absolute bottom-10 right-10 bg-state-danger px-8 py-5 rounded-2xl flex-row items-center border border-surface-border shadow-2xl">
          <FontAwesome name="warning" size={18} color="var(--color-text-main)" />
          <Text className="text-typography-main font-black ml-4 text-sm">{error}</Text>
        </View>
      )}
    </View>
  );
}

export default function RolesScreen() {
  return (
    <RoleManagerProvider>
      <RolesWebLayout />
    </RoleManagerProvider>
  );
}
