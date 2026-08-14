import React, { useMemo, useState } from 'react';
import { Image, View, Text, TouchableOpacity } from 'react-native';
import TeamCreateSheet from '@/components/admin/TeamCreateSheet';
import TeamRolesSheet from '@/components/admin/TeamRolesSheet';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import Tooltip from '@/components/common/Tooltip';
import { useRoleManager, Team, Role, User } from '@/contexts/RoleManagerContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { cssInterop } from 'react-native-css-interop';
import MultiViewList from '@/components/common/MultiViewList';

cssInterop(FontAwesome, {
  className: {
    target: 'style',
    nativeStyleToProp: { color: true, size: true },
  },
} as any);

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return parts.slice(0, 2).map((p) => p[0].toUpperCase()).join('');
}

function MemberStack({ members, size = 22, max = 4 }: { members: User[]; size?: number; max?: number }) {
  const colors = useThemeColors();
  const shown = members.slice(0, max);
  const overflow = members.length - shown.length;
  const overlap = Math.round(size * 0.33);
  return (
    <View className="flex-row items-center">
      {shown.map((m, i) => (
        <View
          key={m.id}
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            marginLeft: i === 0 ? 0 : -overlap,
            borderWidth: 2,
            borderColor: colors.card,
            backgroundColor: colors.background,
            overflow: 'hidden',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {m.avatar_url ? (
            <Image source={{ uri: m.avatar_url }} className="w-full h-full" />
          ) : (
            <Text style={{ color: colors.primary, fontSize: Math.round(size * 0.38), fontWeight: '900' }}>
              {getInitials(m.full_name || m.email)}
            </Text>
          )}
        </View>
      ))}
      {overflow > 0 && (
        <View
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            marginLeft: -overlap,
            borderWidth: 2,
            borderColor: colors.card,
            backgroundColor: colors.background,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: colors.textMuted, fontSize: Math.round(size * 0.35), fontWeight: '900' }}>+{overflow}</Text>
        </View>
      )}
    </View>
  );
}

function RoleChip({ role }: { role: Role }) {
  const colors = useThemeColors();
  const chipColor = role.color?.includes('var') ? colors.primary : (role.color || colors.primary);
  return (
    <View className="bg-surface-background px-2.5 py-1 rounded-md border border-surface-border flex-row items-center flex-shrink">
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: chipColor, marginRight: 6 }} />
      <Text className="text-typography-muted text-[10px] font-bold" numberOfLines={1}>{role.name}</Text>
    </View>
  );
}

export default function TeamAssignmentGrid() {
  const colors = useThemeColors();
  const { users, teams, roles, teamRoles, teamMembers, updateTeamAssignments, setTeamClaiming, createTeam, loading } = useRoleManager();

  const membersByTeam = useMemo(() => {
    const map = new Map<string, User[]>();
    for (const tm of teamMembers) {
      const u = users.find((x) => x.id === tm.user_id);
      if (!u) continue;
      const list = map.get(tm.team_id);
      if (list) list.push(u);
      else map.set(tm.team_id, [u]);
    }
    return map;
  }, [teamMembers, users]);

  const rolesByTeam = useMemo(() => {
    const map = new Map<string, Role[]>();
    for (const tr of teamRoles) {
      const r = roles.find((x) => x.id === tr.role_id);
      if (!r) continue;
      const list = map.get(tr.team_id);
      if (list) list.push(r);
      else map.set(tr.team_id, [r]);
    }
    return map;
  }, [teamRoles, roles]);
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
            const members = membersByTeam.get(t.id) || [];
            const teamRoleObjs = rolesByTeam.get(t.id) || [];
            const shownRoles = teamRoleObjs.slice(0, 3);
            const extraRoles = teamRoleObjs.length - shownRoles.length;
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
                  {t.enforce_single_claimant && (
                    <Tooltip label="Task claiming enabled">
                      <View className="bg-brand-primary/10 border border-brand-primary/20 rounded-lg px-2 py-1 flex-row items-center">
                        <FontAwesome name="user-o" size={9} color={colors.primary} />
                      </View>
                    </Tooltip>
                  )}
                </View>

                <View className="mb-4">
                  <View className="flex-row items-center gap-2 mb-3">
                    {members.length > 0 && <MemberStack members={members} size={28} />}
                    <Text className="text-typography-dim text-xs">
                      {members.length} member{members.length !== 1 ? 's' : ''}
                    </Text>
                  </View>
                  <View className="flex-row items-center gap-1.5 flex-wrap">
                    {teamRoleObjs.length === 0 && (
                      <Text className="text-typography-dim text-xs">No roles assigned yet</Text>
                    )}
                    {shownRoles.map((r) => <RoleChip key={r.id} role={r} />)}
                    {extraRoles > 0 && (
                      <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">+{extraRoles}</Text>
                    )}
                  </View>
                </View>

                <View className="flex-row items-center justify-between pt-3 border-t border-surface-border">
                  <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest">
                    {teamRoleObjs.length} role{teamRoleObjs.length !== 1 ? 's' : ''} assigned
                  </Text>
                  <TouchableOpacity
                    onPress={(e: any) => { e.stopPropagation(); handleOpenTeam(t); }}
                    className="flex-row items-center gap-1.5 bg-surface-background px-3 py-2 rounded-lg border border-surface-border"
                  >
                    <FontAwesome name="cog" size={10} color={colors.primary} />
                    <Text className="text-brand-primary text-[9px] font-black uppercase tracking-widest">Manage</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          }}
          renderRow={(t) => {
            const members = membersByTeam.get(t.id) || [];
            const teamRoleObjs = rolesByTeam.get(t.id) || [];
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
                {members.length > 0 && <MemberStack members={members} size={20} max={3} />}
                <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest flex-shrink-0">
                  {teamRoleObjs.length} role{teamRoleObjs.length !== 1 ? 's' : ''}
                </Text>
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
              key: 'members',
              label: 'Members',
              flex: 1,
              render: (t) => {
                const members = membersByTeam.get(t.id) || [];
                return (
                  <View className="flex-row items-center gap-1.5">
                    {members.length > 0 && <MemberStack members={members} size={18} max={3} />}
                    <Text className="text-typography-muted text-xs">{members.length}</Text>
                  </View>
                );
              },
            },
            {
              key: 'roles',
              label: 'Roles',
              flex: 1.6,
              render: (t) => {
                const teamRoleObjs = rolesByTeam.get(t.id) || [];
                const shown = teamRoleObjs.slice(0, 2);
                const extra = teamRoleObjs.length - shown.length;
                if (teamRoleObjs.length === 0) return <Text className="text-typography-dim text-xs">—</Text>;
                return (
                  <View className="flex-row items-center gap-1.5 flex-wrap">
                    {shown.map((r) => <RoleChip key={r.id} role={r} />)}
                    {extra > 0 && <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">+{extra}</Text>}
                  </View>
                );
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
