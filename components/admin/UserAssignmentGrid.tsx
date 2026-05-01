import { User, useRoleManager } from '@/contexts/RoleManagerContext';
import { FontAwesome } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Image, Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native';

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
      <ScrollView showsVerticalScrollIndicator={false}>
        <View className="flex-row flex-wrap gap-4 pb-32">
          {users.map(user => {
            const userRoleCount = userRoles.filter(ur => ur.user_id === user.id).length;
            const teamCount = teamMembers.filter(tm => tm.user_id === user.id).length;
            
            return (
              <TouchableOpacity
                key={user.id}
                onPress={() => handleOpenUser(user)}
                className="bg-surface-card w-full sm:w-[48%] lg:w-[32%] p-5 rounded-2xl border border-surface-border premium-shadow active:scale-[0.98] transition-all"
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

      {/* Assignment Modal */}
      <Modal visible={!!selectedUser} transparent animationType="fade">
        <View className="flex-1 bg-surface-background/90 justify-center items-center p-6">
          <View className="bg-surface-card w-full max-w-2xl rounded-3xl border border-surface-border p-8 premium-shadow max-h-[90%]">
            <View className="flex-row items-center justify-between mb-8">
              <View>
                <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.2em] mb-1">Identity & Access Control</Text>
                <Text className="text-typography-main text-2xl font-black">{selectedUser?.full_name || selectedUser?.email}</Text>
              </View>
              <TouchableOpacity onPress={() => setSelectedUser(null)} className="w-10 h-10 items-center justify-center rounded-full bg-surface-background border border-surface-border">
                <FontAwesome name="times" size={16} color="rgb(var(--text-muted))" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <View className="mb-10">
                <View className="flex-row items-center mb-6">
                  <FontAwesome name="shield" size={14} color="rgb(var(--brand-primary))" />
                  <Text className="text-brand-primary text-xs font-black uppercase ml-3 tracking-[0.15em]">Direct Authority Nodes</Text>
                </View>
                <View className="flex-row flex-wrap gap-3">
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
                            className="px-5 py-3 rounded-xl border bg-brand-primary/5 border-brand-primary/20 flex-row items-center opacity-60"
                          >
                            <FontAwesome name="lock" size={10} color="rgb(var(--brand-primary))" style={{ marginRight: 8 }} />
                            <Text className="text-[10px] font-black uppercase tracking-widest text-brand-primary">
                              {role.name}
                            </Text>
                          </View>
                        );
                      }

                      return (
                        <TouchableOpacity
                          key={role.id}
                          onPress={() => setDraftRoleIds(prev => isDirect ? prev.filter(id => id !== role.id) : [...prev, role.id])}
                          className={`px-5 py-3 rounded-xl border transition-all ${
                            isDirect ? 'bg-brand-primary border-brand-primary' : 'bg-surface-background border-surface-border'
                          }`}
                        >
                          <Text className={`text-[10px] font-black uppercase tracking-widest ${isDirect ? 'text-white' : 'text-typography-muted'}`}>
                            {role.name}
                          </Text>
                        </TouchableOpacity>
                      );
                    });
                  })()}
                </View>
              </View>

              <View className="mb-4">
                <View className="flex-row items-center mb-6">
                   <FontAwesome name="users" size={14} color="rgb(var(--brand-primary))" />
                   <Text className="text-brand-primary text-xs font-black uppercase ml-3 tracking-[0.15em]">Tactical Team Deployment</Text>
                </View>
                <View className="flex-row flex-wrap gap-3">
                  {teams.map(team => {
                    const isActive = draftTeamIds.includes(team.id);
                    return (
                      <TouchableOpacity
                        key={team.id}
                        onPress={() => setDraftTeamIds(prev => isActive ? prev.filter(id => id !== team.id) : [...prev, team.id])}
                        className={`px-5 py-3 rounded-xl border transition-all ${
                          isActive ? 'bg-brand-primary border-brand-primary' : 'bg-surface-background border-surface-border'
                        }`}
                      >
                        <Text className={`text-[10px] font-black uppercase tracking-widest ${isActive ? 'text-white' : 'text-typography-muted'}`}>
                          {team.name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            </ScrollView>

            <View className="flex-row gap-4 mt-12">
              <TouchableOpacity
                onPress={() => setSelectedUser(null)}
                className="flex-1 bg-surface-background py-5 rounded-xl border border-surface-border items-center"
              >
                <Text className="text-typography-muted font-black text-[10px] uppercase tracking-widest">Discard Changes</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSave}
                disabled={loading}
                className="flex-[1.5] bg-brand-primary py-5 rounded-xl items-center premium-shadow active:scale-[0.98]"
              >
                <Text className="text-white font-black text-[10px] uppercase tracking-[0.2em]">Sync Access Matrix</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
