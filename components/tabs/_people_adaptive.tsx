import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Platform,
    ScrollView,
    Text,
    TouchableOpacity,
    View
} from 'react-native';

import NotificationRules from '@/components/admin/NotificationRules';
import BillingPanel from '@/components/admin/BillingPanel';
import DataExportPanel from '@/components/admin/DataExportPanel';
import RetentionPanel from '@/components/admin/RetentionPanel';
import RoleBuilder from '@/components/admin/RoleBuilder';
import TeamAssignmentGrid from '@/components/admin/TeamAssignmentGrid';
import UserAssignmentGrid from '@/components/admin/UserAssignmentGrid';
import CompanyEditSettings from '@/components/profile/CompanyEditSettings';
import WorkspaceSettings from '@/components/profile/WorkspaceSettings';
import { BackButton } from '@/components/common/BackButton';
import { useAuth } from '@/contexts/AuthContext';
import { RoleManagerProvider, useRoleManager } from '@/contexts/RoleManagerContext';
import { supabase } from '@/lib/supabase';
import { useMemberLimit } from '@/hooks/useMemberLimit';
import { useThemeColors } from '@/hooks/useThemeColors';

type PeopleSection = 'members' | 'teams' | 'roles' | 'notifications' | 'workspace' | 'company' | 'retention' | 'billing' | 'export';

function resolveSection(param: string | undefined, canViewMembers: boolean, canManageTeams: boolean, canManageNotifications: boolean, canEditCompany: boolean, canManageRetention: boolean, canManageBilling: boolean, canManageExport: boolean): PeopleSection {
  if (param === 'export' && canManageExport) return 'export';
  if (param === 'billing' && canManageBilling) return 'billing';
  if (param === 'retention' && canManageRetention) return 'retention';
  if (param === 'company' && canEditCompany) return 'company';
  if (param === 'workspace' && canManageNotifications) return 'workspace';
  if (param === 'notifications' && canManageNotifications) return 'notifications';
  if (param === 'roles' && canManageTeams) return 'roles';
  if (param === 'teams' && canManageTeams) return 'teams';
  if (param === 'members' && canViewMembers) return 'members';
  if (canManageTeams) return 'teams';
  return 'members';
}

function TeamWorkspaceContent({ section }: { section: PeopleSection }) {
  const colors = useThemeColors();
  const { loading, error } = useRoleManager();

  if (loading) {
    return (
      <View className="py-20 items-center justify-center">
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (error) {
    return (
      <View className="w-full items-center justify-center py-16 bg-state-danger/10 rounded-3xl border border-dashed border-state-danger/30 mx-4">
        <FontAwesome name="exclamation-triangle" size={32} color={colors.danger} />
        <Text className="text-typography-main font-black mt-4 text-center px-4">{error}</Text>
      </View>
    );
  }

  if (section === 'export') return <DataExportPanel />;
  if (section === 'billing') return <BillingPanel />;
  if (section === 'retention') return <RetentionPanel />;
  if (section === 'company') return <CompanyEditSettings />;
  if (section === 'workspace') return <WorkspaceSettings />;
  if (section === 'roles') return <RoleBuilder />;
  if (section === 'teams') return <TeamAssignmentGrid />;
  if (section === 'notifications') return <NotificationRules />;
  return <UserAssignmentGrid />;
}

export default function PeopleScreen() {
  const colors = useThemeColors();
  const params = useLocalSearchParams<{ section?: string | string[] }>();
  const sectionParam = Array.isArray(params.section) ? params.section[0] : params.section;

  const [joinCode, setJoinCode] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<PeopleSection>('members');

  const { profile, hasPermission } = useAuth();
  const { atLimit: membersAtLimit, remaining: membersRemaining } = useMemberLimit();
  const canManageTeams = hasPermission('role.manage');
  const canManageNotifications = hasPermission('manage_notifications') || hasPermission('role.manage');
  const canViewMembers = hasPermission('user.view_all') || canManageTeams;
  const canEditCompany = hasPermission('company.edit');
  const canManageRetention = !!profile?.is_owner || hasPermission('company.settings') || hasPermission('role.manage');
  const canManageBilling = !!profile?.is_owner || hasPermission('company.billing');
  const canManageExport = !!profile?.is_owner || hasPermission('company.settings') || hasPermission('data.export');
  const hasWorkspaceAccess = canViewMembers || canManageTeams || canManageNotifications || canEditCompany || canManageRetention || canManageBilling || canManageExport;

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
    setActiveSection(resolveSection(sectionParam, canViewMembers, canManageTeams, canManageNotifications, canEditCompany, canManageRetention, canManageBilling, canManageExport));
  }, [sectionParam, canViewMembers, canManageTeams, canManageNotifications, canEditCompany, canManageRetention, canManageBilling, canManageExport]);

  return (
    <View className="flex-1 bg-surface-background">
      <View className="flex-1">
      <View className="px-6 pb-4" style={{ paddingTop: Platform.OS !== 'web' ? 54 : 16 }}>
        {Platform.OS !== 'web' && (
          <View className="mb-4">
            <BackButton />
          </View>
        )}
        <View className="flex-row items-center justify-between mb-4">
          <View>
            <Text className="text-typography-main text-3xl font-black">Corporate</Text>
            <Text className="text-typography-dim text-xs font-medium">Members, teams, and roles</Text>
          </View>
          <TouchableOpacity className="bg-brand-primary w-11 h-11 rounded-2xl items-center justify-center">
            <FontAwesome name="gear" size={16} color="white" />
          </TouchableOpacity>
        </View>

        {joinCode && (
          <View className={`mb-4 border rounded-2xl p-4 ${membersAtLimit ? 'bg-state-danger/5 border-state-danger/30' : 'bg-brand-primary/10 border-brand-primary/30'}`}>
            <TouchableOpacity
              onPress={() => {
                if (membersAtLimit) return;
                Clipboard.setStringAsync(joinCode);
                Alert.alert('Copied', 'Join code copied to clipboard');
              }}
              className="flex-row items-center justify-between"
              disabled={membersAtLimit}
            >
              <View>
                <Text className="text-typography-dim text-[10px] font-black uppercase tracking-widest">Share Join Code</Text>
                <Text className={`font-black text-xl tracking-[0.2em] ${membersAtLimit ? 'text-typography-muted' : 'text-brand-primary'}`}>{joinCode}</Text>
              </View>
              <View className={`w-10 h-10 rounded-xl items-center justify-center ${membersAtLimit ? 'bg-surface-border' : 'bg-brand-primary'}`}>
                <FontAwesome name="copy" size={14} color={membersAtLimit ? colors.textMuted : 'white'} />
              </View>
            </TouchableOpacity>
            {membersAtLimit ? (
              <Text className="text-state-danger text-[10px] font-bold mt-2">
                Seat limit reached — upgrade your plan to add more members.
              </Text>
            ) : membersRemaining != null && membersRemaining <= 2 && (
              <Text className="text-state-warning text-[10px] font-bold mt-2">
                {membersRemaining === 0 ? 'No seats remaining.' : `${membersRemaining} seat${membersRemaining === 1 ? '' : 's'} remaining.`}
              </Text>
            )}
          </View>
        )}

        {hasWorkspaceAccess && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-4">
            <View className="bg-surface-card p-1 rounded-2xl border border-surface-border flex-row">
              {canViewMembers && (
                <TouchableOpacity
                  onPress={() => setActiveSection('members')}
                  className={`px-5 py-3 rounded-xl items-center ${activeSection === 'members' ? 'bg-brand-primary' : ''}`}
                >
                  <Text className={`font-black text-[10px] uppercase tracking-widest ${activeSection === 'members' ? 'text-white' : 'text-typography-muted'}`}>
                    Members
                  </Text>
                </TouchableOpacity>
              )}
              {canManageTeams && (
                <TouchableOpacity
                  onPress={() => setActiveSection('teams')}
                  className={`px-5 py-3 rounded-xl items-center ${activeSection === 'teams' ? 'bg-brand-primary' : ''}`}
                >
                  <Text className={`font-black text-[10px] uppercase tracking-widest ${activeSection === 'teams' ? 'text-white' : 'text-typography-muted'}`}>
                    Teams
                  </Text>
                </TouchableOpacity>
              )}
              {canManageTeams && (
                <TouchableOpacity
                  onPress={() => setActiveSection('roles')}
                  className={`px-5 py-3 rounded-xl items-center ${activeSection === 'roles' ? 'bg-brand-primary' : ''}`}
                >
                  <Text className={`font-black text-[10px] uppercase tracking-widest ${activeSection === 'roles' ? 'text-white' : 'text-typography-muted'}`}>
                    Roles
                  </Text>
                </TouchableOpacity>
              )}
              {canManageNotifications && (
                <TouchableOpacity
                  onPress={() => setActiveSection('notifications')}
                  className={`px-5 py-3 rounded-xl items-center ${activeSection === 'notifications' ? 'bg-brand-primary' : ''}`}
                >
                  <Text className={`font-black text-[10px] uppercase tracking-widest ${activeSection === 'notifications' ? 'text-white' : 'text-typography-muted'}`}>
                    Alert Rules
                  </Text>
                </TouchableOpacity>
              )}
              {canManageNotifications && (
                <TouchableOpacity
                  onPress={() => setActiveSection('workspace')}
                  className={`px-5 py-3 rounded-xl items-center ${activeSection === 'workspace' ? 'bg-brand-primary' : ''}`}
                >
                  <Text className={`font-black text-[10px] uppercase tracking-widest ${activeSection === 'workspace' ? 'text-white' : 'text-typography-muted'}`}>
                    Workspace
                  </Text>
                </TouchableOpacity>
              )}
              {canEditCompany && (
                <TouchableOpacity
                  onPress={() => setActiveSection('company')}
                  className={`px-5 py-3 rounded-xl items-center ${activeSection === 'company' ? 'bg-brand-primary' : ''}`}
                >
                  <Text className={`font-black text-[10px] uppercase tracking-widest ${activeSection === 'company' ? 'text-white' : 'text-typography-muted'}`}>
                    Company
                  </Text>
                </TouchableOpacity>
              )}
              {canManageRetention && (
                <TouchableOpacity
                  onPress={() => setActiveSection('retention')}
                  className={`px-5 py-3 rounded-xl items-center ${activeSection === 'retention' ? 'bg-brand-primary' : ''}`}
                >
                  <Text className={`font-black text-[10px] uppercase tracking-widest ${activeSection === 'retention' ? 'text-white' : 'text-typography-muted'}`}>
                    Retention
                  </Text>
                </TouchableOpacity>
              )}
              {canManageBilling && (
                <TouchableOpacity
                  onPress={() => setActiveSection('billing')}
                  className={`px-5 py-3 rounded-xl items-center ${activeSection === 'billing' ? 'bg-brand-primary' : ''}`}
                >
                  <Text className={`font-black text-[10px] uppercase tracking-widest ${activeSection === 'billing' ? 'text-white' : 'text-typography-muted'}`}>
                    Billing
                  </Text>
                </TouchableOpacity>
              )}
              {canManageExport && (
                <TouchableOpacity
                  onPress={() => setActiveSection('export')}
                  className={`px-5 py-3 rounded-xl items-center ${activeSection === 'export' ? 'bg-brand-primary' : ''}`}
                >
                  <Text className={`font-black text-[10px] uppercase tracking-widest ${activeSection === 'export' ? 'text-white' : 'text-typography-muted'}`}>
                    Export
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </ScrollView>
        )}
      </View>

      {!hasWorkspaceAccess ? (
        <View className="flex-1 px-6 pb-6">
          <View className="flex-1 items-center justify-center bg-state-danger/10 rounded-3xl border border-state-danger/20">
            <FontAwesome name="lock" size={32} color={colors.danger} />
            <Text className="text-typography-main font-black mt-4">Access Restricted</Text>
            <Text className="text-typography-muted text-xs mt-2 text-center px-8">
              You do not have permission to view members or manage teams.
            </Text>
          </View>
        </View>
      ) : (
        <View className="flex-1 px-6">
          <RoleManagerProvider>
            <TeamWorkspaceContent section={activeSection} />
          </RoleManagerProvider>
        </View>
      )}
    </View>
    </View>
  );
}
