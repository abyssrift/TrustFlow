import { User, useRoleManager } from '@/contexts/RoleManagerContext';
import { useAuth } from '@/contexts/AuthContext';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useState } from 'react';
import { Image, Modal, Platform, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { cssInterop } from 'react-native-css-interop';

cssInterop(FontAwesome, {
  className: {
    target: 'style',
    nativeStyleToProp: { color: true, size: true },
  },
} as any);

export default function UserAssignmentGrid() {
  const { users, roles, teams, userRoles, teamMembers, teamRoles, updateUserAssignments, loading } = useRoleManager();
  const { hasPermission } = useAuth();
  const canAssignRoles = hasPermission('role.manage');
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [draftRoleIds, setDraftRoleIds] = useState<string[]>([]);
  const [draftTeamIds, setDraftTeamIds] = useState<string[]>([]);

  const handleOpenUser = (user: User) => {
    if (!canAssignRoles) return;
    const currentRoles = userRoles.filter(ur => ur.user_id === user.id).map(ur => ur.role_id);
    const currentTeams = teamMembers.filter(tm => tm.user_id === user.id).map(tm => tm.team_id);
    setSelectedUser(user);
    setDraftRoleIds(currentRoles);
    setDraftTeamIds(currentTeams);
  };

  const handleSave = async () => {
    if (!selectedUser || !canAssignRoles) return;
    const success = await updateUserAssignments(selectedUser.id, draftRoleIds, draftTeamIds);
    if (success) setSelectedUser(null);
  };

  return (
    <View className="flex-1">
      <ScrollView showsVerticalScrollIndicator={false}>
        <View className="flex-row flex-wrap gap-4 pb-32">
          {users.map(user => {
            const userRoleCount = userRoles.filter(ur => ur.user_id === user.id).length;
            const teamCount = teamMembers.filter(tm => tm.user_id === user.id).length;
            
            return (
              <TouchableOpacity
                key={user.id}
                onPress={() => handleOpenUser(user)}
                disabled={!canAssignRoles}
                className={`bg-surface-card w-full sm:w-[48%] lg:w-[32%] p-5 rounded-2xl border border-surface-border premium-shadow transition-all ${canAssignRoles ? 'active:scale-[0.98]' : 'opacity-70'}`}
              >
                <View className="flex-row items-center mb-5">
                  <View className="w-12 h-12 rounded-xl bg-brand-primary/10 items-center justify-center border border-brand-primary/20 overflow-hidden">
                    {user.avatar_url ? (
                      <Image source={{ uri: user.avatar_url }} className="w-full h-full" />
                    ) : (
                      <Text className="text-brand-primary font-black text-lg">
                        {user.full_name?.charAt(0) || user.email.charAt(0).toUpperCase()}
                      </Text>
                    )}
                  </View>
                  <View className="ml-4 flex-1">
                    <Text className="text-typography-main font-black text-base" numberOfLines={1}>
                      {user.full_name || 'Unknown Node'}
                    </Text>
                    <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-widest" numberOfLines={1}>
                      {user.job_title || 'Unassigned Role'}
                    </Text>
                  </View>
                </View>
                
                <View className="flex-row items-center gap-3">
                  <View className="bg-surface-background px-3 py-2 rounded-lg border border-surface-border flex-1 items-center">
                    <Text className="text-typography-label text-[9px] font-black uppercase tracking-widest">{userRoleCount} Roles</Text>
                  </View>
                  <View className="bg-surface-background px-3 py-2 rounded-lg border border-surface-border flex-1 items-center">
                    <Text className="text-typography-label text-[9px] font-black uppercase tracking-widest">{teamCount} Teams</Text>
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      {/* Assignment Modal — bottom sheet on mobile, centered card on desktop */}
      <Modal
        visible={!!selectedUser}
        transparent
        animationType={Platform.OS === 'web' ? 'fade' : 'slide'}
      >
        {Platform.OS === 'web' ? (
          /* Desktop: centered card */
          <View className="flex-1 bg-black/60 justify-center items-center p-6">
            <View className="bg-surface-card w-full max-w-2xl rounded-3xl border border-surface-border premium-shadow" style={{ maxHeight: '90%' }}>
              {/* Header */}
              <View className="flex-row items-center justify-between px-8 pt-8 pb-6">
                <View className="flex-1 mr-4">
                  <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.2em] mb-1">Identity & Access Control</Text>
                  <Text className="text-typography-main text-2xl font-black" numberOfLines={1}>{selectedUser?.full_name || selectedUser?.email}</Text>
                </View>
                <TouchableOpacity onPress={() => setSelectedUser(null)} className="w-10 h-10 items-center justify-center rounded-full bg-surface-background border border-surface-border flex-shrink-0">
                  <FontAwesome name="times" size={16} className="text-typography-muted" />
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} className="px-8">
                {/* Roles */}
                <View className="mb-8">
                  <View className="flex-row items-center mb-4">
                    <FontAwesome name="shield" size={13} className="text-brand-primary" />
                    <Text className="text-brand-primary text-[10px] font-black uppercase ml-3 tracking-[0.15em]">Direct Roles</Text>
                  </View>
                  <View className="flex-row flex-wrap gap-2">
                    {(() => {
                      const inheritedRoleIds = draftTeamIds.flatMap(teamId =>
                        teamRoles.filter(tr => tr.team_id === teamId).map(tr => tr.role_id)
                      );
                      return roles.map(role => {
                        const isInherited = inheritedRoleIds.includes(role.id);
                        const isDirect = draftRoleIds.includes(role.id);
                        if (isInherited) {
                          return (
                            <View key={role.id} className="px-4 py-2.5 rounded-xl border bg-brand-primary/5 border-brand-primary/20 flex-row items-center opacity-60">
                              <FontAwesome name="lock" size={9} className="text-brand-primary" style={{ marginRight: 6 }} />
                              <Text className="text-[10px] font-black uppercase tracking-widest text-brand-primary">{role.name}</Text>
                            </View>
                          );
                        }
                        return (
                          <TouchableOpacity
                            key={role.id}
                            onPress={() => setDraftRoleIds(prev => isDirect ? prev.filter(id => id !== role.id) : [...prev, role.id])}
                            className={`px-4 py-2.5 rounded-xl border transition-all active:scale-[0.97] ${isDirect ? 'bg-brand-primary border-brand-primary' : 'bg-surface-background border-surface-border'}`}
                          >
                            <Text className={`text-[10px] font-black uppercase tracking-widest ${isDirect ? 'text-white' : 'text-typography-muted'}`}>{role.name}</Text>
                          </TouchableOpacity>
                        );
                      });
                    })()}
                  </View>
                </View>

                {/* Teams */}
                <View className="mb-8">
                  <View className="flex-row items-center mb-4">
                    <FontAwesome name="users" size={13} className="text-brand-primary" />
                    <Text className="text-brand-primary text-[10px] font-black uppercase ml-3 tracking-[0.15em]">Team Membership</Text>
                  </View>
                  <View className="flex-row flex-wrap gap-2">
                    {teams.map(team => {
                      const isActive = draftTeamIds.includes(team.id);
                      return (
                        <TouchableOpacity
                          key={team.id}
                          onPress={() => setDraftTeamIds(prev => isActive ? prev.filter(id => id !== team.id) : [...prev, team.id])}
                          className={`px-4 py-2.5 rounded-xl border transition-all active:scale-[0.97] ${isActive ? 'bg-brand-primary border-brand-primary' : 'bg-surface-background border-surface-border'}`}
                        >
                          <Text className={`text-[10px] font-black uppercase tracking-widest ${isActive ? 'text-white' : 'text-typography-muted'}`}>{team.name}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              </ScrollView>

              {/* Footer */}
              <View className="flex-row gap-3 px-8 py-6 border-t border-surface-border">
                <TouchableOpacity onPress={() => setSelectedUser(null)} className="flex-1 bg-surface-background py-4 rounded-xl border border-surface-border items-center">
                  <Text className="text-typography-muted font-black text-[10px] uppercase tracking-widest">Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={handleSave} disabled={loading} className="flex-[1.5] bg-brand-primary py-4 rounded-xl items-center premium-shadow active:scale-[0.98]">
                  <Text className="text-white font-black text-[10px] uppercase tracking-[0.2em]">Sync Access Matrix</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ) : (
          /* Mobile: bottom sheet */
          <View className="flex-1 bg-black/60 justify-end">
            <View className="bg-surface-card w-full rounded-t-3xl border-t border-x border-surface-border" style={{ maxHeight: '90%' }}>
              {/* Handle */}
              <View className="items-center pt-3 pb-1">
                <View className="w-10 h-1 rounded-full bg-surface-border" />
              </View>

              {/* Header */}
              <View className="flex-row items-center justify-between px-5 pt-3 pb-5">
                <View className="flex-1 mr-4">
                  <Text className="text-typography-muted text-[9px] font-black uppercase tracking-[0.3em] mb-1">Identity & Access Control</Text>
                  <Text className="text-typography-main text-xl font-black tracking-tight" numberOfLines={1}>{selectedUser?.full_name || selectedUser?.email}</Text>
                </View>
                <TouchableOpacity onPress={() => setSelectedUser(null)} className="w-10 h-10 items-center justify-center rounded-full bg-surface-background border border-surface-border flex-shrink-0">
                  <FontAwesome name="times" size={16} className="text-typography-muted" />
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} className="px-5" contentContainerStyle={{ paddingBottom: 20 }}>
                {/* Roles */}
                <View className="mb-7">
                  <View className="flex-row items-center mb-3">
                    <FontAwesome name="shield" size={12} className="text-brand-primary" />
                    <Text className="text-brand-primary text-[10px] font-black uppercase ml-2 tracking-widest">Direct Roles</Text>
                  </View>
                  <View className="gap-2">
                    {(() => {
                      const inheritedRoleIds = draftTeamIds.flatMap(teamId =>
                        teamRoles.filter(tr => tr.team_id === teamId).map(tr => tr.role_id)
                      );
                      return roles.map(role => {
                        const isInherited = inheritedRoleIds.includes(role.id);
                        const isDirect = draftRoleIds.includes(role.id);
                        if (isInherited) {
                          return (
                            <View key={role.id} className="flex-row items-center justify-between p-4 rounded-2xl border bg-brand-primary/5 border-brand-primary/20 opacity-60">
                              <View className="flex-row items-center flex-1 mr-3">
                                <FontAwesome name="lock" size={11} className="text-brand-primary" style={{ marginRight: 10 }} />
                                <Text className="text-[11px] font-black uppercase tracking-tight text-brand-primary">{role.name}</Text>
                              </View>
                              <Text className="text-brand-primary text-[9px] font-black uppercase tracking-widest">via team</Text>
                            </View>
                          );
                        }
                        return (
                          <TouchableOpacity
                            key={role.id}
                            onPress={() => setDraftRoleIds(prev => isDirect ? prev.filter(id => id !== role.id) : [...prev, role.id])}
                            className={`flex-row items-center justify-between p-4 rounded-2xl border ${isDirect ? 'bg-brand-primary/10 border-brand-primary/40' : 'bg-surface-background border-surface-border'}`}
                          >
                            <Text className={`text-[11px] font-black uppercase tracking-tight flex-1 mr-3 ${isDirect ? 'text-typography-main' : 'text-typography-muted'}`}>{role.name}</Text>
                            <View className={`w-6 h-6 rounded-full items-center justify-center border flex-shrink-0 ${isDirect ? 'bg-brand-primary border-brand-primary' : 'border-surface-border'}`}>
                              {isDirect && <FontAwesome name="check" size={10} color="white" />}
                            </View>
                          </TouchableOpacity>
                        );
                      });
                    })()}
                  </View>
                </View>

                {/* Teams */}
                <View>
                  <View className="flex-row items-center mb-3">
                    <FontAwesome name="users" size={12} className="text-brand-primary" />
                    <Text className="text-brand-primary text-[10px] font-black uppercase ml-2 tracking-widest">Team Membership</Text>
                  </View>
                  <View className="gap-2">
                    {teams.map(team => {
                      const isActive = draftTeamIds.includes(team.id);
                      return (
                        <TouchableOpacity
                          key={team.id}
                          onPress={() => setDraftTeamIds(prev => isActive ? prev.filter(id => id !== team.id) : [...prev, team.id])}
                          className={`flex-row items-center justify-between p-4 rounded-2xl border ${isActive ? 'bg-brand-primary/10 border-brand-primary/40' : 'bg-surface-background border-surface-border'}`}
                        >
                          <Text className={`text-[11px] font-black uppercase tracking-tight flex-1 mr-3 ${isActive ? 'text-typography-main' : 'text-typography-muted'}`}>{team.name}</Text>
                          <View className={`w-6 h-6 rounded-full items-center justify-center border flex-shrink-0 ${isActive ? 'bg-brand-primary border-brand-primary' : 'border-surface-border'}`}>
                            {isActive && <FontAwesome name="check" size={10} color="white" />}
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              </ScrollView>

              {/* Footer */}
              <View className="flex-row gap-3 px-5 py-4 border-t border-surface-border">
                <TouchableOpacity onPress={() => setSelectedUser(null)} className="flex-1 bg-surface-background py-4 rounded-xl border border-surface-border items-center">
                  <Text className="text-typography-muted font-black text-[11px] uppercase tracking-widest">Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={handleSave} disabled={loading} className="flex-[2] bg-brand-primary py-4 rounded-xl items-center active:scale-[0.98]">
                  <Text className="text-white font-black text-[11px] uppercase tracking-widest">Save Changes</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
      </Modal>
    </View>
  );
}

