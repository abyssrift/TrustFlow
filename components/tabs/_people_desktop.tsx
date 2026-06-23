import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';

import BillingPanel from '@/components/admin/BillingPanel';
import DataExportPanel from '@/components/admin/DataExportPanel';
import NotificationRules from '@/components/admin/NotificationRules';
import RetentionPanel from '@/components/admin/RetentionPanel';
import RoleBuilder from '@/components/admin/RoleBuilder';
import TeamAssignmentGrid from '@/components/admin/TeamAssignmentGrid';
import UserAssignmentGrid from '@/components/admin/UserAssignmentGrid';
import CompanyEditSettings from '@/components/profile/CompanyEditSettings';
import WorkspaceSettings from '@/components/profile/WorkspaceSettings';
import { useAuth } from '@/contexts/AuthContext';
import { RoleManagerProvider, useRoleManager } from '@/contexts/RoleManagerContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { supabase } from '@/lib/supabase';

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

const SECTION_META: Record<PeopleSection, { label: string; description: string; icon: keyof typeof FontAwesome.glyphMap }> = {
  members: { label: 'Members', description: 'View and manage your team roster', icon: 'users' },
  teams: { label: 'Teams', description: 'Group members into working teams', icon: 'sitemap' },
  roles: { label: 'Role Registry', description: 'Define roles and permissions', icon: 'id-badge' },
  notifications: { label: 'Alert Rules', description: 'Configure notification triggers', icon: 'bell' },
  workspace: { label: 'Workspace', description: 'General workspace preferences', icon: 'sliders' },
  company: { label: 'Company Info', description: 'Legal name, branding, details', icon: 'building' },
  retention: { label: 'Retention', description: 'Inactivity policy and data lifecycle', icon: 'history' },
  billing: { label: 'Billing', description: 'Plan, seats, and subscription', icon: 'credit-card' },
  export: { label: 'Export', description: 'Download a copy of your company data', icon: 'download' },
};

function TeamWorkspaceContent({ section }: { section: PeopleSection }) {
  const colors = useThemeColors();
  const { loading, error } = useRoleManager();

  if (loading) {
    return (
      <View className="py-40 items-center justify-center">
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (error) {
    return (
      <View className="w-full items-center justify-center py-32 bg-state-danger/10 rounded-[40px] border border-dashed border-state-danger/30">
        <FontAwesome name="exclamation-triangle" size={42} color={colors.danger} />
        <Text className="text-typography-main text-xl font-black mt-6">Unable to load team workspace</Text>
        <Text className="text-typography-muted mt-2 text-center max-w-xl">{error}</Text>
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

function SidebarItem({
  active,
  onPress,
  icon,
  label,
}: {
  active: boolean;
  onPress: () => void;
  icon: keyof typeof FontAwesome.glyphMap;
  label: string;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      className={`p-4 rounded-2xl mb-2 border transition-all flex-row items-center ${
        active ? 'bg-brand-primary border-brand-primary premium-shadow' : 'bg-surface-card border-surface-border hover:bg-surface-overlay'
      }`}
    >
      <View className="w-8 items-center mr-3">
        <FontAwesome name={icon} size={15} className={active ? 'text-brand-on-primary' : 'text-typography-muted'} />
      </View>
      <Text className={`text-sm font-bold flex-1 ${active ? 'text-brand-on-primary' : 'text-typography-main'}`}>{label}</Text>
      {active && <FontAwesome name="chevron-right" size={10} className="text-brand-on-primary opacity-50" />}
    </TouchableOpacity>
  );
}

export default function PeopleScreenWeb() {
  const colors = useThemeColors();
  const params = useLocalSearchParams<{ section?: string | string[] }>();
  const sectionParam = Array.isArray(params.section) ? params.section[0] : params.section;

  const [joinCode, setJoinCode] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<PeopleSection>('members');

  const { profile, hasPermission } = useAuth();
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

  const sectionVisibility: Record<PeopleSection, boolean> = {
    members: canViewMembers,
    teams: canManageTeams,
    roles: canManageTeams,
    notifications: canManageNotifications,
    workspace: canManageNotifications,
    company: canEditCompany,
    retention: canManageRetention,
    billing: canManageBilling,
    export: canManageExport,
  };
  const visibleSections = (Object.keys(SECTION_META) as PeopleSection[]).filter(key => sectionVisibility[key]);

  return (
    <View className="flex-1 bg-surface-background flex-row">
      {/* Sidebar */}
      <View className="w-80 h-full border-r border-surface-border overflow-hidden">
        <View className="flex-1 p-8">
          <View className="mb-6">
            <Text className="text-2xl font-black text-typography-main tracking-tighter">Corporate</Text>
            <Text className="text-typography-muted text-xs mt-1 font-bold">Members, teams, and role registry</Text>
          </View>

          {joinCode && (
            <View className="bg-surface-overlay border border-surface-border rounded-2xl p-4 mb-6">
              <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-1">Join Code</Text>
              <View className="flex-row items-center justify-between">
                <Text className="text-brand-primary font-black text-base tracking-[0.2em]">{joinCode}</Text>
                <TouchableOpacity
                  onPress={() => Clipboard.setStringAsync(joinCode)}
                  className="w-8 h-8 bg-brand-primary/10 rounded-lg items-center justify-center hover:bg-brand-primary/20 transition-colors"
                >
                  <FontAwesome name="copy" size={12} color={colors.primary} />
                </TouchableOpacity>
              </View>
            </View>
          )}

          {hasWorkspaceAccess && (
            <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
              <View className="pb-4">
                {visibleSections.map(key => (
                  <SidebarItem
                    key={key}
                    active={activeSection === key}
                    onPress={() => setActiveSection(key)}
                    icon={SECTION_META[key].icon}
                    label={SECTION_META[key].label}
                  />
                ))}
              </View>
            </ScrollView>
          )}
        </View>
      </View>

      {/* Content pane */}
      <ScrollView className="flex-1" contentContainerStyle={{ padding: 48 }}>
        <View className="max-w-[1600px] w-full">
          {!hasWorkspaceAccess ? (
            <View className="w-full items-center justify-center py-40 bg-state-danger/10 rounded-[48px] border border-dashed border-state-danger/30">
              <FontAwesome name="lock" size={48} color={colors.danger} className="mb-6" />
              <Text className="text-typography-main text-2xl font-black">Access Restricted</Text>
              <Text className="text-typography-muted mt-2 text-center max-w-md">
                You do not have permission to view members or manage teams.
              </Text>
            </View>
          ) : (
            <>
              <View className="mb-8">
                <Text className="text-3xl font-black text-typography-main tracking-tight">{SECTION_META[activeSection].label}</Text>
                <Text className="text-typography-muted text-sm mt-1 font-medium">{SECTION_META[activeSection].description}</Text>
              </View>
              <RoleManagerProvider>
                <TeamWorkspaceContent section={activeSection} />
              </RoleManagerProvider>
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
