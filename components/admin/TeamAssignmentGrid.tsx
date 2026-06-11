import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Modal, TextInput } from 'react-native';
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

      {/* Create Team Modal — bottom sheet */}
      <Modal visible={isCreating} transparent animationType="slide">
        <View className="flex-1 bg-black/60 justify-end">
          <View className="bg-surface-card w-full rounded-t-3xl border-t border-x border-surface-border">
            {/* Handle */}
            <View className="items-center pt-3 pb-1">
              <View className="w-10 h-1 rounded-full bg-surface-border" />
            </View>

            {/* Header */}
            <View className="flex-row items-center justify-between px-5 pt-3 pb-5">
              <View className="flex-1 mr-4">
                <Text className="text-typography-muted text-[9px] font-black uppercase tracking-[0.3em] mb-1">New Team</Text>
                <Text className="text-typography-main text-xl font-black tracking-tight">Create Team</Text>
              </View>
              <TouchableOpacity
                onPress={() => setIsCreating(false)}
                className="w-10 h-10 items-center justify-center rounded-full bg-surface-background border border-surface-border"
              >
                <FontAwesome name="times" size={16} className="text-typography-muted" />
              </TouchableOpacity>
            </View>

            <View className="px-5 pb-5 gap-4">
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Team name"
                placeholderTextColor={colors.textMuted}
                className="bg-surface-background border border-surface-border rounded-xl px-4 py-4 text-typography-main font-black text-sm"
              />
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="Description..."
                placeholderTextColor={colors.textMuted}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
                className="bg-surface-background border border-surface-border rounded-xl px-4 py-4 text-typography-main text-sm h-24 leading-5"
              />

              <View className="flex-row flex-wrap gap-3">
                {[colors.primary, colors.success, colors.warning, colors.danger, '#6366f1', '#10b981'].map(c => (
                  <TouchableOpacity
                    key={c}
                    onPress={() => setColor(c)}
                    style={{ backgroundColor: c }}
                    className={`w-9 h-9 rounded-xl border-2 ${color === c ? 'border-white' : 'border-transparent'}`}
                  />
                ))}
              </View>

              <View className="flex-row gap-3 pt-2 border-t border-surface-border">
                <TouchableOpacity
                  onPress={() => setIsCreating(false)}
                  className="flex-1 bg-surface-background py-4 rounded-xl border border-surface-border items-center"
                >
                  <Text className="text-typography-muted font-black text-[10px] uppercase tracking-widest">Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleCreateTeam}
                  disabled={loading || !name.trim()}
                  className="flex-[2] bg-brand-primary py-4 rounded-xl items-center active:scale-[0.98]"
                >
                  <Text className="text-white font-black text-[10px] uppercase tracking-widest">Create Team</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* Team Role Assignment Modal — bottom sheet */}
      <Modal visible={!!selectedTeam} transparent animationType="slide">
        <View className="flex-1 bg-black/60 justify-end">
          <View className="bg-surface-card w-full rounded-t-3xl border-t border-x border-surface-border max-h-[85%]">
            {/* Handle */}
            <View className="items-center pt-3 pb-1">
              <View className="w-10 h-1 rounded-full bg-surface-border" />
            </View>

            {/* Header */}
            <View className="flex-row items-center justify-between px-5 pt-3 pb-5">
              <View className="flex-1 mr-4">
                <Text className="text-typography-muted text-[9px] font-black uppercase tracking-[0.3em] mb-1">Assign Roles</Text>
                <Text className="text-typography-main text-xl font-black tracking-tight" numberOfLines={1}>
                  {selectedTeam?.name}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setSelectedTeam(null)}
                className="w-10 h-10 items-center justify-center rounded-full bg-surface-background border border-surface-border"
              >
                <FontAwesome name="times" size={16} className="text-typography-muted" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} className="px-5">
              <View className="flex-row items-center mb-4">
                <FontAwesome name="shield" size={12} className="text-brand-primary" />
                <Text className="text-brand-primary text-xs font-black uppercase ml-2 tracking-widest">Roles</Text>
              </View>
              <View className="flex-row flex-wrap gap-2 pb-4">
                {roles.map(role => {
                  const isActive = draftRoleIds.includes(role.id);
                  return (
                    <TouchableOpacity
                      key={role.id}
                      onPress={() => setDraftRoleIds(prev => isActive ? prev.filter(id => id !== role.id) : [...prev, role.id])}
                      className={`px-4 py-3 rounded-xl border ${
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
            </ScrollView>

            <View className="flex-row gap-3 px-5 py-4 border-t border-surface-border">
              <TouchableOpacity
                onPress={() => setSelectedTeam(null)}
                className="flex-1 bg-surface-background py-4 rounded-xl border border-surface-border items-center"
              >
                <Text className="text-typography-muted font-black text-[10px] uppercase tracking-widest">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSave}
                disabled={loading}
                className="flex-[2] bg-brand-primary py-4 rounded-xl items-center active:scale-[0.98]"
              >
                <Text className="text-white font-black text-[10px] uppercase tracking-widest">Save Changes</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
