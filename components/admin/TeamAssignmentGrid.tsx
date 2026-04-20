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
      <ScrollView showsVerticalScrollIndicator={false} className="px-1">
        <View className="flex-row flex-wrap gap-3 pb-20">
          {teams.map(team => {
            const roleCount = teamRoles.filter(tr => tr.team_id === team.id).length;
            
            return (
              <TouchableOpacity
                key={team.id}
                onPress={() => handleOpenTeam(team)}
                className="bg-surface-card w-[48%] p-6 rounded-[32px] border border-surface-border premium-shadow active:scale-[0.98] transition-transform"
              >
                <View 
                  style={{ backgroundColor: team.color || 'rgb(var(--brand-primary))' }}
                  className="w-10 h-10 rounded-full items-center justify-center mb-4 border border-surface-border/30"
                >
                  <FontAwesome name="users" size={16} color="rgb(var(--text-main))" />
                </View>
                <Text className="text-typography-main font-black text-sm mb-1" numberOfLines={1}>
                  {team.name}
                </Text>
                <Text className="text-typography-dim text-[9px] font-bold uppercase tracking-tighter mb-4" numberOfLines={1}>
                  {team.description || 'Strategic Asset Group'}
                </Text>
                
                <View className="bg-surface-background px-3 py-2 rounded-xl border border-surface-border self-start">
                   <Text className="text-brand-primary text-[8px] font-black uppercase tracking-widest">{roleCount} AUTHORITY ROLES</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      {/* Team Role Modal */}
      <Modal visible={!!selectedTeam} transparent animationType="slide">
        <View className="flex-1 bg-black/80 justify-end">
           <View className="bg-surface-card w-full rounded-t-[48px] border-t border-surface-border p-8 pb-12 premium-shadow">
              <View className="w-12 h-1 bg-surface-border rounded-full self-center mb-8" />
              
              <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.2em] mb-2 text-center">Team Sovereignty</Text>
              <Text className="text-typography-main text-2xl font-black mb-8 text-center">{selectedTeam?.name}</Text>

              <View className="mb-6 px-1">
                <Text className="text-brand-primary text-[10px] font-black uppercase mb-4 tracking-widest flex-row items-center">
                  <FontAwesome name="shield" /> &nbsp; Inherited Authority
                </Text>
                <ScrollView className="max-h-80" showsVerticalScrollIndicator={false}>
                   <View className="flex-row flex-wrap gap-2.5">
                      {roles.map(role => {
                         const isActive = draftRoleIds.includes(role.id);
                         return (
                            <TouchableOpacity
                              key={role.id}
                              onPress={() => setDraftRoleIds(prev => isActive ? prev.filter(id => id !== role.id) : [...prev, role.id])}
                              className={`px-6 py-4 rounded-2xl border transition-all ${
                                 isActive ? 'bg-brand-primary-dim border-brand-primary/50' : 'bg-surface-background border-surface-border'
                              }`}
                            >
                               <Text className={`text-xs font-black uppercase tracking-wider ${isActive ? 'text-brand-primary' : 'text-typography-muted'}`}>
                                  {role.name}
                               </Text>
                            </TouchableOpacity>
                         );
                      })}
                   </View>
                </ScrollView>
              </View>

              <View className="flex-row gap-4 mt-4">
                <TouchableOpacity
                  onPress={() => setSelectedTeam(null)}
                  className="flex-[0.4] bg-surface-background py-5 rounded-3xl border border-surface-border items-center"
                >
                  <Text className="text-typography-muted font-black text-[10px] uppercase tracking-widest">Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleSave}
                  disabled={loading}
                  className="flex-1 bg-brand-primary py-5 rounded-3xl items-center premium-shadow active:scale-[0.98]"
                >
                  <Text className="text-typography-main font-black text-[10px] uppercase tracking-[0.2em]">Update Team Hierarchy</Text>
                </TouchableOpacity>
              </View>
           </View>
        </View>
      </Modal>
    </View>
  );
}
