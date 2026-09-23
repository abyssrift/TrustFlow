import React, { useMemo, useState } from 'react';
import { Image, ScrollView, View, Text, TouchableOpacity } from 'react-native';
import TeamCreateSheet from '@/components/admin/TeamCreateSheet';
import TeamRolesSheet from '@/components/admin/TeamRolesSheet';
import Popup from '@/components/common/Popup';
import SearchableMultiSelect from '@/components/common/SearchableMultiSelect';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import Tooltip from '@/components/common/Tooltip';
import { useAlert } from '@/contexts/AlertContext';
import { useAuth } from '@/contexts/AuthContext';
import { useRoleManager, Team, Role, User } from '@/contexts/RoleManagerContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { cssInterop } from 'react-native-css-interop';
import MultiViewList from '@/components/common/MultiViewList';
import GridSectionHeader from '@/components/admin/GridSectionHeader';
import { useCollapsibleHeaderScroll } from '@/hooks/useCollapsibleHeader';
import GuideAnchor from '@/components/guides/GuideAnchor';

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
  const { showAlert, showConfirm } = useAlert();
  const { hasPermission } = useAuth();
  const canAssignRoles = hasPermission('role.manage');
  // #309: drives the roles-screen collapsible header. Inert when this grid
  // renders outside a <CollapsibleHeaderProvider> (hook is null-safe).
  const headerScroll = useCollapsibleHeaderScroll();

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
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedTeamIds, setSelectedTeamIds] = useState<Set<string>>(new Set());
  const [bulkRoles, setBulkRoles] = useState<string[]>([]);
  const [bulkClaiming, setBulkClaiming] = useState<'unchanged' | 'enable' | 'disable'>('unchanged');
  const [bulkVisible, setBulkVisible] = useState(false);
  const [bulkRunning, setBulkRunning] = useState(false);

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

  const toggleTeamSelection = (team: Team) => {
    setSelectedTeamIds(prev => {
      const next = new Set(prev);
      if (next.has(team.id)) next.delete(team.id);
      else next.add(team.id);
      return next;
    });
  };

  const clearTeamSelection = () => {
    setSelectionMode(false);
    setSelectedTeamIds(new Set());
  };

  const runBulkTeamUpdate = () => {
    if (!selectedTeamIds.size || (!bulkRoles.length && bulkClaiming === 'unchanged')) return;
    const ids = [...selectedTeamIds];
    showConfirm('Apply changes to teams?', `This will update ${ids.length} team${ids.length === 1 ? '' : 's'} using existing assignment and claiming settings.`, async () => {
      setBulkRunning(true);
      const outcomes = await Promise.allSettled(ids.map(async (teamId) => {
        const team = teams.find(t => t.id === teamId);
        if (!team) throw new Error('Team no longer exists');
        const currentRoles = teamRoles.filter(tr => tr.team_id === teamId).map(tr => tr.role_id);
        if (bulkRoles.length > 0 && !await updateTeamAssignments(teamId, [...new Set([...currentRoles, ...bulkRoles])])) throw new Error('Role assignment failed');
        if (bulkClaiming !== 'unchanged' && !await setTeamClaiming(teamId, bulkClaiming === 'enable')) throw new Error('Claiming update failed');
        return teamId;
      }));
      const failedIds = ids.filter((_, index) => outcomes[index].status !== 'fulfilled');
      const succeededIds = ids.filter((_, index) => outcomes[index].status === 'fulfilled');
      setSelectedTeamIds(new Set(failedIds));
      setBulkRunning(false);
      if (failedIds.length === 0) {
        setBulkVisible(false);
        clearTeamSelection();
      } else {
        showAlert('Some teams were not updated', `${succeededIds.length} succeeded; ${failedIds.length} failed or did not report an outcome. Failed teams remain selected so you can retry.`);
      }
    }, undefined, 'Apply changes', 'Cancel');
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
        <GridSectionHeader
          eyebrow="Operational Clusters"
          title="Active Teams"
          right={
            <View className="flex-row items-center gap-2">
              <GuideAnchor id="team-people:primary-action">
                <View className="flex-row items-center gap-2">
                  {canAssignRoles && <TouchableOpacity onPress={selectionMode ? clearTeamSelection : () => setSelectionMode(true)} className="border border-surface-border px-3 py-3 rounded-xl">
                    <Text className="text-typography-main font-black text-[10px] uppercase tracking-widest">{selectionMode ? 'Cancel' : 'Select'}</Text>
                  </TouchableOpacity>}
                  {canAssignRoles && selectionMode && selectedTeamIds.size > 0 ? (
                    <TouchableOpacity onPress={() => setBulkVisible(true)} className="bg-brand-primary px-3 py-3 rounded-xl active:scale-[0.98]">
                      <Text className="text-white font-black text-[10px] uppercase tracking-widest">Bulk ({selectedTeamIds.size})</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity onPress={() => setIsCreating(true)} className="bg-brand-primary px-4 py-3 rounded-xl active:scale-[0.98]">
                      <Text className="text-white font-black text-[10px] uppercase tracking-widest">+ New Team</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </GuideAnchor>
            </View>
          }
        />

        <GuideAnchor id="team-people:list" className="flex-1">
        <MultiViewList
          {...headerScroll}
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
                {members.length > 0 && <MemberStack members={members} size={26} max={3} />}
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
                    {members.length > 0 && <MemberStack members={members} size={24} max={3} />}
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
          selection={{
            active: selectionMode,
            selectedIds: selectedTeamIds,
            onToggle: toggleTeamSelection,
            onPress: (team) => {
              if (!selectionMode) setSelectionMode(true);
              toggleTeamSelection(team);
            },
            onLongPress: (team) => {
              if (!selectionMode) setSelectionMode(true);
              toggleTeamSelection(team);
            },
            onKeyDown: (team, event) => {
              if ((event.key === ' ' || event.key === 'Enter') && event.preventDefault) {
                event.preventDefault();
                toggleTeamSelection(team);
              }
            },
          }}
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
        </GuideAnchor>

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

      <Popup visible={bulkVisible} onClose={() => !bulkRunning && setBulkVisible(false)} presentation="auto" maxWidth={760} maxHeight="90%" title="Bulk team operations" dimBackdrop>
        <ScrollView className="px-5 py-4" contentContainerStyle={{ paddingBottom: 12 }}>
          <Text className="text-typography-muted text-xs mb-4">Apply existing roles and optionally set task claiming for the selected teams. Existing assignments are retained.</Text>
          <SearchableMultiSelect
            title="Roles to add"
            items={roles.map(role => ({ id: role.id, label: role.name, description: role.description, color: role.color }))}
            selectedIds={bulkRoles}
            onToggle={(id) => setBulkRoles(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])}
            searchPlaceholder="Search roles..."
            emptyText="No roles match your search."
          />
          <View className="mt-5">
            <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-2">Task claiming</Text>
            <View className="flex-row flex-wrap gap-2">
              {(['unchanged', 'enable', 'disable'] as const).map(option => (
                <TouchableOpacity key={option} onPress={() => setBulkClaiming(option)} className="px-3 py-2 rounded-lg border" style={{ borderColor: bulkClaiming === option ? colors.primary : colors.border, backgroundColor: bulkClaiming === option ? `${colors.primary}15` : colors.card }}>
                  <Text className="text-[10px] font-black uppercase tracking-widest" style={{ color: bulkClaiming === option ? colors.primary : colors.textMuted }}>{option}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </ScrollView>
        <View className="flex-row gap-2 px-5 py-4 border-t" style={{ borderColor: colors.border }}>
          <TouchableOpacity onPress={() => setBulkVisible(false)} disabled={bulkRunning} className="flex-1 border py-3 rounded-lg items-center" style={{ borderColor: colors.border }}><Text className="text-typography-muted font-black text-[10px] uppercase tracking-widest">Cancel</Text></TouchableOpacity>
          <TouchableOpacity onPress={runBulkTeamUpdate} disabled={bulkRunning || (!bulkRoles.length && bulkClaiming === 'unchanged')} className="flex-1 py-3 rounded-lg items-center" style={{ backgroundColor: colors.primary, opacity: bulkRunning || (!bulkRoles.length && bulkClaiming === 'unchanged') ? 0.5 : 1 }}><Text className="font-black text-[10px] uppercase tracking-widest" style={{ color: colors.background }}>{bulkRunning ? 'Applying…' : 'Apply changes'}</Text></TouchableOpacity>
        </View>
      </Popup>
    </View>
  );
}
