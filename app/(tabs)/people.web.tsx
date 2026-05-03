import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as Clipboard from 'expo-clipboard';

import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { RoleManagerProvider, useRoleManager } from '@/contexts/RoleManagerContext';
import UserAssignmentGrid from '@/components/admin/UserAssignmentGrid';
import TeamAssignmentGrid from '@/components/admin/TeamAssignmentGrid';
import RoleBuilder from '@/components/admin/RoleBuilder';
import NotificationRules from '@/components/admin/NotificationRules';

type PeopleSection = 'members' | 'teams' | 'roles' | 'notifications';

function resolveSection(param: string | undefined, canViewMembers: boolean, canManageTeams: boolean, canManageNotifications: boolean): PeopleSection {
  if (param === 'notifications' && canManageNotifications) return 'notifications';
  if (param === 'roles' && canManageTeams) return 'roles';
  if (param === 'teams' && canManageTeams) return 'teams';
  if (param === 'members' && canViewMembers) return 'members';
  if (canManageTeams) return 'teams';
  return 'members';
}

function TeamWorkspaceContent({ section }: { section: PeopleSection }) {
  const { loading, error } = useRoleManager();

  if (loading) {
    return (
      <View className="py-40 items-center justify-center">
        <ActivityIndicator size="large" color="rgb(var(--brand-primary))" />
      </View>
    );
  }

  if (error) {
    return (
      <View className="w-full items-center justify-center py-32 bg-state-danger/10 rounded-[40px] border border-dashed border-state-danger/30">
        <FontAwesome name="exclamation-triangle" size={42} color="rgb(var(--state-danger))" />
        <Text className="text-typography-main text-xl font-black mt-6">Unable to load team workspace</Text>
        <Text className="text-typography-muted mt-2 text-center max-w-xl">{error}</Text>
      </View>
    );
  }

  if (section === 'roles') return <RoleBuilder />;
  if (section === 'teams') return <TeamAssignmentGrid />;
  if (section === 'notifications') return <NotificationRules />;
  return <UserAssignmentGrid />;
}

export default function PeopleScreenWeb() {
  const params = useLocalSearchParams<{ section?: string | string[] }>();
  const sectionParam = Array.isArray(params.section) ? params.section[0] : params.section;

  const [joinCode, setJoinCode] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<PeopleSection>('members');

  const { profile, hasPermission } = useAuth();
  const canManageTeams = hasPermission('role.manage');
  const canManageNotifications = hasPermission('manage_notifications') || hasPermission('role.manage');
  const canViewMembers = hasPermission('user.view_all') || canManageTeams;
  const hasWorkspaceAccess = canViewMembers || canManageTeams || canManageNotifications;

  useEffect(() => {
    const fetchCompanyInfo = async () => {
      if (!profile?.company_id) return;
      const { data } = await supabase
        .from('companies')
        .select('join_code')
        .eq('id', profile.company_id)
        .single();
      if (data?.join_code) setJoinCode(data.join_code);
    };
    fetchCompanyInfo();
  }, [profile?.company_id]);

  useEffect(() => {
    setActiveSection(resolveSection(sectionParam, canViewMembers, canManageTeams, canManageNotifications));
  }, [sectionParam, canViewMembers, canManageTeams, canManageNotifications]);

  return (
    <View className="flex-1 bg-surface-background p-10">
      <View className="max-w-[1600px] mx-auto w-full flex-1">
        <View className="flex-row items-center justify-between mb-8">
          <View>
            <Text className="text-typography-main text-5xl font-black tracking-tighter">Team</Text>
            <Text className="text-typography-muted text-lg mt-2 font-medium">Members, teams, and role registry</Text>
          </View>

          {joinCode && (
            <View className="bg-surface-card border border-surface-border rounded-2xl px-6 flex-row items-center h-14 premium-shadow">
              <View>
                <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-0.5">Join Code</Text>
                <Text className="text-brand-primary font-black text-lg tracking-[0.2em]">{joinCode}</Text>
              </View>
              <TouchableOpacity
                onPress={() => Clipboard.setStringAsync(joinCode)}
                className="ml-6 w-10 h-10 bg-brand-primary/10 rounded-xl items-center justify-center hover:bg-brand-primary/20 transition-colors"
              >
                <FontAwesome name="copy" size={14} color="rgb(var(--brand-primary))" />
              </TouchableOpacity>
            </View>
          )}
        </View>

        {!hasWorkspaceAccess ? (
          <View className="w-full items-center justify-center py-40 bg-state-danger/10 rounded-[48px] border border-dashed border-state-danger/30">
            <FontAwesome name="lock" size={48} color="rgb(var(--state-danger))" className="mb-6" />
            <Text className="text-typography-main text-2xl font-black">Access Restricted</Text>
            <Text className="text-typography-muted mt-2 text-center max-w-md">
              You do not have permission to view members or manage teams.
            </Text>
          </View>
        ) : (
          <>
            <View className="mb-8 bg-surface-card p-1.5 rounded-2xl border border-surface-border flex-row self-start min-w-[460px]">
              {canViewMembers && (
                <TouchableOpacity
                  onPress={() => setActiveSection('members')}
                  className={`px-8 py-3 rounded-xl ${activeSection === 'members' ? 'bg-brand-primary' : ''}`}
                >
                  <Text className={`font-black text-xs uppercase tracking-widest ${activeSection === 'members' ? 'text-white' : 'text-typography-muted'}`}>
                    Members
                  </Text>
                </TouchableOpacity>
              )}
              {canManageTeams && (
                <TouchableOpacity
                  onPress={() => setActiveSection('teams')}
                  className={`px-8 py-3 rounded-xl ${activeSection === 'teams' ? 'bg-brand-primary' : ''}`}
                >
                  <Text className={`font-black text-xs uppercase tracking-widest ${activeSection === 'teams' ? 'text-white' : 'text-typography-muted'}`}>
                    Teams
                  </Text>
                </TouchableOpacity>
              )}
              {canManageTeams && (
                <TouchableOpacity
                  onPress={() => setActiveSection('roles')}
                  className={`px-8 py-3 rounded-xl ${activeSection === 'roles' ? 'bg-brand-primary' : ''}`}
                >
                  <Text className={`font-black text-xs uppercase tracking-widest ${activeSection === 'roles' ? 'text-white' : 'text-typography-muted'}`}>
                    Role Registry
                  </Text>
                </TouchableOpacity>
              )}
              {canManageNotifications && (
                <TouchableOpacity
                  onPress={() => setActiveSection('notifications')}
                  className={`px-8 py-3 rounded-xl ${activeSection === 'notifications' ? 'bg-brand-primary' : ''}`}
                >
                  <Text className={`font-black text-xs uppercase tracking-widest ${activeSection === 'notifications' ? 'text-white' : 'text-typography-muted'}`}>
                    Alert Rules
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            <RoleManagerProvider>
              <TeamWorkspaceContent section={activeSection} />
            </RoleManagerProvider>
          </>
        )}
      </View>
    </View>
  );
}
