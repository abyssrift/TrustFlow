import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Modal } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { useRoleManager, Team } from '@/contexts/RoleManagerContext';

export default function TeamAssignmentGrid() {
  const { teams, roles, teamRoles, updateTeamAssignments, loading } = useRoleManager();
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [draftRoleIds, setDraftRoleIds] = useState<string[]>([]);

  const handleOpenTeam = (team: Team) => {
    const currentRoles = teamRoles.filter(tr => tr.team_id === team.id).map(tr => tr.role_id);
    setSelectedTeam(team);
    setDraftRoleIds(currentRoles);
  };

  const handleSave = async () => {
    if (!selectedTeam) return;
    const success = await updateTeamAssignments(selectedTeam.id, draftRoleIds);
    if (success) setSelectedTeam(null);
  };

  return (
    <View className="flex-1">
      <ScrollView showsVerticalScrollIndicator={false}>
        <View className="flex-row flex-wrap gap-4 pb-32">
          {teams.map(team => {
            const roleCount = teamRoles.filter(tr => tr.team_id === team.id).length;
            
            return (
              <TouchableOpacity
                key={team.id}
                onPress={() => handleOpenTeam(team)}
                className="bg-surface-card w-full sm:w-[48%] lg:w-[32%] p-6 rounded-2xl border border-surface-border premium-shadow active:scale-[0.98] transition-all"
              >
                <View className="flex-row items-center mb-6">
                  <View 
                    style={{ backgroundColor: team.color || 'rgb(var(--brand-primary))' }}
                    className="w-12 h-12 rounded-xl items-center justify-center border border-white/10"
                  >
                    <FontAwesome name="users" size={18} color="white" />
                  </View>
                  <View className="ml-4 flex-1">
                    <Text className="text-typography-main font-black text-base" numberOfLines={1}>
                      {team.name}
                    </Text>
                    <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-widest" numberOfLines={1}>
                      {team.description || 'Strategic Asset Group'}
                    </Text>
                  </View>
                </View>
                
                <View className="bg-surface-background px-4 py-2.5 rounded-xl border border-surface-border self-start">
                   <Text className="text-brand-primary text-[9px] font-black uppercase tracking-widest">{roleCount} Authority Roles</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      {/* Team Role Modal */}
      <Modal visible={!!selectedTeam} transparent animationType="fade">
        <View className="flex-1 bg-surface-background/90 justify-center items-center p-6">
           <View className="bg-surface-card w-full max-w-2xl rounded-3xl border border-surface-border p-8 premium-shadow max-h-[85%]">
              <View className="flex-row items-center justify-between mb-10">
                <View>
                  <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.25em] mb-1">Team Sovereignty</Text>
                  <Text className="text-typography-main text-2xl font-black">{selectedTeam?.name}</Text>
                </View>
                <TouchableOpacity onPress={() => setSelectedTeam(null)} className="w-10 h-10 items-center justify-center rounded-full bg-surface-background border border-surface-border">
                  <FontAwesome name="times" size={16} color="rgb(var(--text-muted))" />
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false}>
                <View className="mb-6">
                  <View className="flex-row items-center mb-8">
                    <FontAwesome name="shield" size={14} color="rgb(var(--brand-primary))" />
                    <Text className="text-brand-primary text-xs font-black uppercase ml-3 tracking-widest">Inherent Authority Matrix</Text>
                  </View>
                  <View className="flex-row flex-wrap gap-3">
                      {roles.map(role => {
                         const isActive = draftRoleIds.includes(role.id);
                         return (
                            <TouchableOpacity
                              key={role.id}
                              onPress={() => setDraftRoleIds(prev => isActive ? prev.filter(id => id !== role.id) : [...prev, role.id])}
                              className={`px-6 py-4 rounded-xl border transition-all ${
                                 isActive ? 'bg-brand-primary border-brand-primary' : 'bg-surface-background border-surface-border'
                              }`}
                            >
                               <Text className={`text-[10px] font-black uppercase tracking-widest ${isActive ? 'text-white' : 'text-typography-muted'}`}>
                                  {role.name}
                               </Text>
                            </TouchableOpacity>
                         );
                      })}
                  </View>
                </View>
              </ScrollView>

              <View className="flex-row gap-4 mt-12">
                <TouchableOpacity
                  onPress={() => setSelectedTeam(null)}
                  className="flex-1 bg-surface-background py-5 rounded-xl border border-surface-border items-center"
                >
                  <Text className="text-typography-muted font-black text-[10px] uppercase tracking-widest">Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleSave}
                  disabled={loading}
                  className="flex-[1.5] bg-brand-primary py-5 rounded-xl items-center premium-shadow active:scale-[0.98]"
                >
                  <Text className="text-white font-black text-[10px] uppercase tracking-[0.2em]">Update Team Hierarchy</Text>
                </TouchableOpacity>
              </View>
           </View>
        </View>
      </Modal>
    </View>
  );
}
