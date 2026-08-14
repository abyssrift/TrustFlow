import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import TeamCreateSheet from '@/components/admin/TeamCreateSheet';
import TeamRolesSheet from '@/components/admin/TeamRolesSheet';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRoleManager, Team } from '@/contexts/RoleManagerContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { cssInterop } from 'react-native-css-interop';
import MultiViewList from '@/components/common/MultiViewList';

cssInterop(FontAwesome, {
  className: {
    target: 'style',
    nativeStyleToProp: { color: true, size: true },
  },
} as any);

export default function TeamAssignmentGrid() {
  const colors = useThemeColors();
  const { teams, roles, teamRoles, updateTeamAssignments, setTeamClaiming, createTeam, loading } = useRoleManager();
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [draftRoleIds, setDraftRoleIds] = useState<string[]>([]);
  const [query, setQuery] = useState('');

  const visibleTeams = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return teams;
    return teams.filter((t) =>
      t.name.toLowerCase().includes(q) ||
      (t.description ?? '').toLowerCase().includes(q)
    );
  }, [teams, query]);

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

  const handleToggleClaiming = async (enabled: boolean) => {
    if (!selectedTeam) return;
    await setTeamClaiming(selectedTeam.id, enabled);
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
        <View className="flex-row items-center justify-between mb-4 px-1">
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

        <MultiViewList
          items={visibleTeams}
          keyExtractor={(t) => t.id}
          renderCard={(t) => {
            const roleCount = teamRoles.filter(tr => tr.team_id === t.id).length;
            return (
              <View className="bg-surface-card w-full p-5 rounded-2xl border border-surface-border">
                <View className="flex-row items-center mb-4">
                  <View
                    style={{ backgroundColor: t.color?.includes('var') ? colors.primary : (t.color || colors.primary) }}
                    className="w-11 h-11 rounded-xl items-center justify-center flex-shrink-0"
                  >
                    <FontAwesome name="users" size={16} color="white" />
                  </View>
                  <View className="ml-3 flex-1">
                    <Text className="text-typography-main font-black text-base" numberOfLines={1}>{t.name}</Text>
                    <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-widest" numberOfLines={1}>
                      {t.description || 'No description'}
                    </Text>
                  </View>
                </View>
                <View className="bg-surface-background px-3 py-1.5 rounded-lg border border-surface-border self-start">
                  <Text className="text-brand-primary text-[9px] font-black uppercase tracking-widest">{roleCount} roles assigned</Text>
                </View>
              </View>
            );
          }}
          renderRow={(t) => {
            const roleCount = teamRoles.filter(tr => tr.team_id === t.id).length;
            return (
              <View className="flex-row items-center gap-3">
                <View
                  style={{ backgroundColor: t.color?.includes('var') ? colors.primary : (t.color || colors.primary) }}
                  className="w-9 h-9 rounded-xl items-center justify-center flex-shrink-0"
                >
                  <FontAwesome name="users" size={14} color="white" />
                </View>
                <View className="flex-1 min-w-0">
                  <Text className="text-typography-main font-black text-sm" numberOfLines={1}>{t.name}</Text>
                  <Text className="text-typography-muted text-[11px]" numberOfLines={1}>{t.description || 'No description'}</Text>
                </View>
                <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest flex-shrink-0">{roleCount} roles</Text>
              </View>
            );
          }}
          columns={[
            {
              key: 'team',
              label: 'Team',
              flex: 2.2,
              render: (t) => (
                <View className="flex-row items-center gap-3">
                  <View
                    style={{ backgroundColor: t.color?.includes('var') ? colors.primary : (t.color || colors.primary) }}
                    className="w-9 h-9 rounded-xl items-center justify-center flex-shrink-0"
                  >
                    <FontAwesome name="users" size={14} color="white" />
                  </View>
                  <View className="min-w-0">
                    <Text className="text-typography-main font-black text-sm" numberOfLines={1}>{t.name}</Text>
                    <Text className="text-typography-muted text-[10px]" numberOfLines={1}>{t.description || 'No description'}</Text>
                  </View>
                </View>
              ),
            },
            {
              key: 'roles',
              label: 'Roles',
              flex: 1,
              align: 'center',
              render: (t) => {
                const n = teamRoles.filter(tr => tr.team_id === t.id).length;
                return <Text className="text-typography-main text-xs font-bold">{n}</Text>;
              },
            },
          ]}
          onItemPress={(t) => handleOpenTeam(t)}
          storageKey="team-registry"
          modes={['large', 'list', 'details']}
          defaultMode="large"
          search={{ value: query, onChange: setQuery, placeholder: 'Search teams' }}
          loading={loading}
          emptyState={{
            icon: 'users',
            title: query.trim() ? 'No matching teams' : 'No teams yet',
            body: query.trim() ? 'Try a different search.' : 'Create your first team to start organizing roles and members.',
            actionLabel: 'New team',
            onAction: () => setIsCreating(true),
          }}
          style={{ flex: 1 }}
        />

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
        team={selectedTeam ? teams.find(t => t.id === selectedTeam.id) ?? selectedTeam : null}
        roles={roles}
        draftRoleIds={draftRoleIds}
        onToggleRole={(id) => setDraftRoleIds(prev => prev.includes(id) ? prev.filter(r => r !== id) : [...prev, id])}
        onSave={handleSave}
        loading={loading}
        onToggleClaiming={handleToggleClaiming}
      />
    </View>
  );
}
