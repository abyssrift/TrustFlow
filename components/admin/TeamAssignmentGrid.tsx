import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import TeamCreateSheet from '@/components/admin/TeamCreateSheet';
import TeamRolesSheet from '@/components/admin/TeamRolesSheet';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRoleManager, Team } from '@/contexts/RoleManagerContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { cssInterop } from 'react-native-css-interop';

cssInterop(FontAwesome, {
  className: {
    target: 'style',
    nativeStyleToProp: { color: true, size: true },
  },
} as any);

export default function TeamAssignmentGrid() {
  const colors = useThemeColors();
  const { teams, roles, teamRoles, updateTeamAssignments, createTeam, loading } = useRoleManager();
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [draftRoleIds, setDraftRoleIds] = useState<string[]>([]);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(colors.primary);

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

  const handleCreateTeam = async () => {
    if (!name.trim()) return;
    const id = await createTeam(name, description, color);
    if (id) {
      setIsCreating(false);
      setName('');
      setDescription('');
      setColor(colors.primary);
    }
  };

  return (
    <View className="flex-1">
      <ScrollView showsVerticalScrollIndicator={false}>
        <View className="flex-row items-center justify-between mb-6 px-1">
          <View className="flex-1 mr-3">
            <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.25em] mb-1">Operational Clusters</Text>
            <Text className="text-typography-main text-2xl font-black tracking-tight">Active Teams</Text>
          </View>
          <TouchableOpacity
            onPress={() => setIsCreating(true)}
            className="bg-brand-primary px-4 py-3 rounded-xl active:scale-[0.98]"
          >
            <Text className="text-white font-black text-[10px] uppercase tracking-widest">+ New Team</Text>
          </TouchableOpacity>
        </View>

        {teams.length === 0 ? (
          <View className="items-center justify-center py-24 bg-surface-card rounded-3xl border border-dashed border-surface-border">
            <View className="w-16 h-16 bg-brand-primary/10 rounded-2xl items-center justify-center mb-5">
              <FontAwesome name="users" size={26} className="text-brand-primary" />
            </View>
            <Text className="text-typography-main text-lg font-black mb-2">No teams yet</Text>
            <Text className="text-typography-muted text-center text-xs px-8 mb-8 leading-5">
              Create your first team to start organizing roles and members.
            </Text>
            <TouchableOpacity
              onPress={() => setIsCreating(true)}
              className="bg-surface-background px-6 py-4 rounded-2xl border border-surface-border"
            >
              <Text className="text-brand-primary font-black text-xs uppercase tracking-[0.2em]">Create First Team</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View className="gap-3 pb-32">
            {teams.map(team => {
              const roleCount = teamRoles.filter(tr => tr.team_id === team.id).length;
              return (
                <TouchableOpacity
                  key={team.id}
                  onPress={() => handleOpenTeam(team)}
                  className="bg-surface-card w-full p-5 rounded-2xl border border-surface-border active:scale-[0.98]"
                >
                  <View className="flex-row items-center mb-4">
                    <View
                      style={{ backgroundColor: team.color?.includes('var') ? colors.primary : (team.color || colors.primary) }}
                      className="w-11 h-11 rounded-xl items-center justify-center flex-shrink-0"
                    >
                      <FontAwesome name="users" size={16} color="white" />
                    </View>
                    <View className="ml-3 flex-1">
                      <Text className="text-typography-main font-black text-base" numberOfLines={1}>{team.name}</Text>
                      <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-widest" numberOfLines={1}>
                        {team.description || 'No description'}
                      </Text>
                    </View>
                  </View>

                  <View className="bg-surface-background px-3 py-1.5 rounded-lg border border-surface-border self-start">
                    <Text className="text-brand-primary text-[9px] font-black uppercase tracking-widest">{roleCount} roles assigned</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>

      <TeamCreateSheet
        visible={isCreating}
        onClose={() => setIsCreating(false)}
        name={name}
        onChangeName={setName}
        description={description}
        onChangeDescription={setDescription}
        color={color}
        onChangeColor={setColor}
        onCreate={handleCreateTeam}
        loading={loading}
      />

      <TeamRolesSheet
        visible={!!selectedTeam}
        onClose={() => setSelectedTeam(null)}
        team={selectedTeam}
        roles={roles}
        draftRoleIds={draftRoleIds}
        onToggleRole={(id) => setDraftRoleIds(prev => prev.includes(id) ? prev.filter(r => r !== id) : [...prev, id])}
        onSave={handleSave}
        loading={loading}
      />
    </View>
  );
}
