import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Modal } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { useRoleManager, User } from '@/contexts/RoleManagerContext';

export default function UserAssignmentGrid() {
  const { users, roles, teams, userRoles, teamMembers, teamRoles, updateUserAssignments, loading } = useRoleManager();
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [draftRoleIds, setDraftRoleIds] = useState<string[]>([]);
  const [draftTeamIds, setDraftTeamIds] = useState<string[]>([]);

  const handleOpenUser = (user: User) => {
    const currentRoles = userRoles.filter(ur => ur.user_id === user.id).map(ur => ur.role_id);
    const currentTeams = teamMembers.filter(tm => tm.user_id === user.id).map(tm => tm.team_id);
    setSelectedUser(user);
    setDraftRoleIds(currentRoles);
    setDraftTeamIds(currentTeams);
  };

  const handleSave = async () => {
    if (!selectedUser) return;
    const success = await updateUserAssignments(selectedUser.id, draftRoleIds, draftTeamIds);
    if (success) setSelectedUser(null);
  };

  return (
    <View className="flex-1">
      <ScrollView showsVerticalScrollIndicator={false} className="px-1">
        <View className="flex-row flex-wrap gap-3 pb-20">
          {users.map(user => {
            const userRoleCount = userRoles.filter(ur => ur.user_id === user.id).length;
            const teamCount = teamMembers.filter(tm => tm.user_id === user.id).length;
            
            return (
              <TouchableOpacity
                key={user.id}
                onPress={() => handleOpenUser(user)}
                className="bg-surface-card w-[48%] p-5 rounded-[28px] border border-surface-border premium-shadow active:scale-[0.98] transition-transform"
              >
                <View className="w-12 h-12 rounded-2xl bg-brand-primary-dim items-center justify-center mb-4 border border-brand-primary/30">
                  <Text className="text-brand-primary font-black text-lg">
                    {user.full_name?.charAt(0) || user.email.charAt(0).toUpperCase()}
                  </Text>
                </View>
                <Text className="text-typography-main font-black text-sm mb-0.5" numberOfLines={1}>
                  {user.full_name || 'Unknown Node'}
                </Text>
                <Text className="text-typography-dim text-[9px] font-bold uppercase tracking-tighter mb-4" numberOfLines={1}>
                  {user.job_title || 'Unassigned Role'}
                </Text>
                
                <View className="flex-row items-center gap-1.5">
                  <View className="bg-surface-background px-2.5 py-1.5 rounded-xl border border-surface-border flex-1 items-center">
                    <Text className="text-typography-label text-[8px] font-black uppercase tracking-widest">{userRoleCount} R</Text>
                  </View>
                  <View className="bg-surface-background px-2.5 py-1.5 rounded-xl border border-surface-border flex-1 items-center">
                    <Text className="text-typography-label text-[8px] font-black uppercase tracking-widest">{teamCount} T</Text>
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      {/* Assignment Modal */}
      <Modal visible={!!selectedUser} transparent animationType="slide">
        <View className="flex-1 bg-black/80 justify-end">
          <View className="bg-surface-card w-full rounded-t-[48px] border-t border-surface-border p-8 premium-shadow pb-12">
            <View className="w-12 h-1 bg-surface-border rounded-full self-center mb-8" />
            
            <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.2em] mb-2 text-center">Identity & Access Control</Text>
            <Text className="text-typography-main text-2xl font-black mb-8 text-center">{selectedUser?.full_name || selectedUser?.email}</Text>

            <ScrollView className="max-h-[450px]" showsVerticalScrollIndicator={false}>
              <View className="mb-8">
                <Text className="text-brand-primary text-[10px] font-black uppercase mb-4 px-1 tracking-widest flex-row items-center">
                  <FontAwesome name="shield" /> &nbsp; Authority Nodes
                </Text>
                <View className="flex-row flex-wrap gap-2.5">
                  {(() => {
                    const inheritedRoleIds = draftTeamIds.flatMap(teamId => 
                      teamRoles.filter(tr => tr.team_id === teamId).map(tr => tr.role_id)
                    );
                    
                    return roles.map(role => {
                      const isInherited = inheritedRoleIds.includes(role.id);
                      const isDirect = draftRoleIds.includes(role.id);

                      if (isInherited) {
                        return (
                          <View
                            key={role.id}
                            className="px-5 py-3 rounded-2xl border bg-brand-primary-dim border-brand-primary/40 flex-row items-center"
                          >
                            <FontAwesome name="lock" size={10} color="rgb(var(--brand-primary))" style={{ marginRight: 6 }} />
                            <Text className="text-[11px] font-black uppercase tracking-wider text-brand-primary">
                              {role.name}
                            </Text>
                          </View>
                        );
                      }

                      return (
                        <TouchableOpacity
                          key={role.id}
                          onPress={() => setDraftRoleIds(prev => isDirect ? prev.filter(id => id !== role.id) : [...prev, role.id])}
                          className={`px-5 py-3 rounded-2xl border transition-all ${
                            isDirect ? 'bg-brand-primary-dim border-brand-primary/50' : 'bg-surface-background border-surface-border'
                          }`}
                        >
                          <Text className={`text-[11px] font-black uppercase tracking-wider ${isDirect ? 'text-brand-primary' : 'text-typography-muted'}`}>
                            {role.name}
                          </Text>
                        </TouchableOpacity>
                      );
                    });
                  })()}
                </View>
              </View>

              <View className="mb-4">
                <Text className="text-brand-secondary text-[10px] font-black uppercase mb-4 px-1 tracking-widest">
                  <FontAwesome name="users" /> &nbsp; Tactical Teams
                </Text>
                <View className="flex-row flex-wrap gap-2.5">
                  {teams.map(team => {
                    const isActive = draftTeamIds.includes(team.id);
                    return (
                      <TouchableOpacity
                        key={team.id}
                        onPress={() => setDraftTeamIds(prev => isActive ? prev.filter(id => id !== team.id) : [...prev, team.id])}
                        className={`px-5 py-3 rounded-2xl border transition-all ${
                          isActive ? 'bg-brand-secondary-dim border-brand-secondary/50' : 'bg-surface-background border-surface-border'
                        }`}
                      >
                        <Text className={`text-[11px] font-black uppercase tracking-wider ${isActive ? 'text-brand-secondary' : 'text-typography-muted'}`}>
                          {team.name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            </ScrollView>

            <View className="flex-row gap-4 mt-10">
              <TouchableOpacity
                onPress={() => setSelectedUser(null)}
                className="flex-[0.4] bg-surface-background py-5 rounded-3xl border border-surface-border items-center"
              >
                <Text className="text-typography-muted font-black text-[10px] uppercase tracking-widest">Discard</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSave}
                disabled={loading}
                className="flex-1 bg-brand-primary py-5 rounded-3xl items-center premium-shadow active:scale-[0.98]"
              >
                <Text className="text-typography-main font-black text-[10px] uppercase tracking-[0.2em]">Sync Access Matrix</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
