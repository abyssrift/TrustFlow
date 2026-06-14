import { User, useRoleManager } from '@/contexts/RoleManagerContext';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useState } from 'react';
import { Image, Modal, Platform, ScrollView, Text, TouchableOpacity, View, Alert } from 'react-native';
import { cssInterop } from 'react-native-css-interop';

cssInterop(FontAwesome, {
  className: {
    target: 'style',
    nativeStyleToProp: { color: true, size: true },
  },
} as any);

type TabType = 'profile' | 'activity' | 'roles';

export default function UserAssignmentGrid() {
  const { users, roles, teams, userRoles, teamMembers, teamRoles, updateUserAssignments, removeUserFromCompany, loading } = useRoleManager();
  const { hasPermission } = useAuth();
  const colors = useThemeColors();
  const canAssignRoles = hasPermission('role.manage');
  const canRemoveUsers = hasPermission('company.manage');
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('profile');
  const [draftRoleIds, setDraftRoleIds] = useState<string[]>([]);
  const [draftTeamIds, setDraftTeamIds] = useState<string[]>([]);

  const handleOpenUser = (user: User) => {
    const currentRoles = userRoles.filter(ur => ur.user_id === user.id).map(ur => ur.role_id);
    const currentTeams = teamMembers.filter(tm => tm.user_id === user.id).map(tm => tm.team_id);
    setSelectedUser(user);
    setDraftRoleIds(currentRoles);
    setDraftTeamIds(currentTeams);
    setActiveTab('profile');
  };

  const handleSave = async () => {
    if (!selectedUser || !canAssignRoles) return;
    const success = await updateUserAssignments(selectedUser.id, draftRoleIds, draftTeamIds);
    if (success) setSelectedUser(null);
  };

  const handleRemoveUser = async () => {
    if (!selectedUser || !canRemoveUsers) return;
    Alert.alert('Remove User from Company', `Are you sure you want to remove ${selectedUser.full_name || selectedUser.email} from this company? They will lose access to all company resources.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          const success = await removeUserFromCompany(selectedUser.id);
          if (success) setSelectedUser(null);
        }
      }
    ]);
  };

  const getTenure = (createdAt: string) => {
    const now = new Date();
    const joined = new Date(createdAt);
    const days = Math.floor((now.getTime() - joined.getTime()) / (1000 * 60 * 60 * 24));
    if (days === 0) return 'Today';
    if (days === 1) return '1 day';
    if (days < 30) return `${days} days`;
    const months = Math.floor(days / 30);
    if (months === 1) return '1 month';
    if (months < 12) return `${months} months`;
    const years = Math.floor(months / 12);
    return `${years} year${years > 1 ? 's' : ''}`;
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
                className="w-full sm:w-[48%] lg:w-[32%] p-5 rounded-2xl border premium-shadow transition-all active:scale-[0.98]"
                style={{ backgroundColor: colors.card, borderColor: colors.border }}
              >
                <View className="flex-row items-center mb-5">
                  <View className="w-12 h-12 rounded-xl items-center justify-center border overflow-hidden" style={{ backgroundColor: `${colors.primary}10`, borderColor: `${colors.primary}33` }}>
                    {user.avatar_url ? (
                      <Image source={{ uri: user.avatar_url }} className="w-full h-full" />
                    ) : (
                      <Text className="font-black text-lg" style={{ color: colors.primary }}>
                        {user.full_name?.charAt(0) || user.email.charAt(0).toUpperCase()}
                      </Text>
                    )}
                  </View>
                  <View className="ml-4 flex-1">
                    <Text className="font-black text-base" numberOfLines={1} style={{ color: colors.textMain }}>
                      {user.full_name || 'Unknown Node'}
                    </Text>
                    <Text className="text-[10px] font-bold uppercase tracking-widest" numberOfLines={1} style={{ color: colors.textMuted }}>
                      {user.job_title || 'Unassigned Role'}
                    </Text>
                  </View>
                </View>

                <View className="flex-row items-center gap-3">
                  <View className="px-3 py-2 rounded-lg border flex-1 items-center" style={{ backgroundColor: colors.background, borderColor: colors.border }}>
                    <Text className="text-[9px] font-black uppercase tracking-widest" style={{ color: colors.textMuted }}>{userRoleCount} Roles</Text>
                  </View>
                  <View className="px-3 py-2 rounded-lg border flex-1 items-center" style={{ backgroundColor: colors.background, borderColor: colors.border }}>
                    <Text className="text-[9px] font-black uppercase tracking-widest" style={{ color: colors.textMuted }}>{teamCount} Teams</Text>
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      {/* Member Profile Modal — tabbed design */}
      <Modal
        visible={!!selectedUser}
        transparent
        animationType={Platform.OS === 'web' ? 'fade' : 'slide'}
      >
        {Platform.OS === 'web' ? (
          /* Desktop: centered card */
          <View className="flex-1 bg-black/60 justify-center items-center p-6">
            <View className="w-full max-w-3xl rounded-3xl border premium-shadow overflow-hidden" style={{ backgroundColor: colors.card, borderColor: colors.border, maxHeight: '90%' }}>
              {/* Header with Profile Summary */}
              {selectedUser && (
                <View className="px-8 pt-8 pb-6 border-b" style={{ borderColor: colors.border, backgroundColor: `${colors.primary}08` }}>
                  <View className="flex-row items-start justify-between mb-6">
                    <View className="flex-row items-center flex-1">
                      <View className="w-16 h-16 rounded-2xl items-center justify-center border overflow-hidden mr-4" style={{ backgroundColor: colors.primary, borderColor: colors.primary }}>
                        {selectedUser.avatar_url ? (
                          <Image source={{ uri: selectedUser.avatar_url }} className="w-full h-full" />
                        ) : (
                          <Text className="font-black text-3xl" style={{ color: colors.background }}>
                            {selectedUser.full_name?.charAt(0) || selectedUser.email.charAt(0).toUpperCase()}
                          </Text>
                        )}
                      </View>
                      <View className="flex-1">
                        <Text className="text-2xl font-black mb-1" numberOfLines={1} style={{ color: colors.textMain }}>
                          {selectedUser.full_name || selectedUser.email}
                        </Text>
                        <Text className="text-sm mb-2" style={{ color: colors.textMuted }}>
                          {selectedUser.job_title || 'No role'}
                        </Text>
                        <Text className="text-xs font-semibold" style={{ color: colors.primary }}>
                          Joined {getTenure(selectedUser.created_at)} ago
                        </Text>
                      </View>
                    </View>
                    <TouchableOpacity onPress={() => setSelectedUser(null)} className="w-10 h-10 items-center justify-center rounded-full border" style={{ backgroundColor: `${colors.primary}15`, borderColor: colors.primary }}>
                      <FontAwesome name="times" size={16} color={colors.primary} />
                    </TouchableOpacity>
                  </View>

                  {/* Tabs */}
                  <View className="flex-row gap-2">
                    {(['profile', 'activity', 'roles'] as TabType[]).map(tab => (
                      <TouchableOpacity
                        key={tab}
                        onPress={() => setActiveTab(tab)}
                        className="px-4 py-2.5 rounded-lg border"
                        style={{
                          backgroundColor: activeTab === tab ? colors.primary : colors.card,
                          borderColor: activeTab === tab ? colors.primary : colors.border
                        }}
                      >
                        <Text className="text-[11px] font-black uppercase tracking-tight" style={{ color: activeTab === tab ? colors.background : colors.primary }}>
                          {tab === 'profile' ? 'Profile' : tab === 'activity' ? 'Activity' : 'Access'}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}

              {/* Tab Content */}
              <ScrollView showsVerticalScrollIndicator={false} className="px-8 py-6">
                {selectedUser && activeTab === 'profile' && (
                  <View>
                    {/* Contact Info */}
                    <View className="mb-8">
                      <Text className="text-[11px] font-black uppercase tracking-[0.15em] mb-4" style={{ color: colors.primary }}>Contact Information</Text>
                      <View className="gap-3">
                        <View className="flex-row items-center">
                          <FontAwesome name="envelope" size={13} color={colors.textMuted} style={{ width: 24 }} />
                          <Text className="ml-3 text-sm" style={{ color: colors.textMain }}>{selectedUser.email}</Text>
                        </View>
                        {selectedUser.phone && (
                          <View className="flex-row items-center">
                            <FontAwesome name="phone" size={13} color={colors.textMuted} style={{ width: 24 }} />
                            <Text className="ml-3 text-sm" style={{ color: colors.textMain }}>{selectedUser.phone}</Text>
                          </View>
                        )}
                      </View>
                    </View>

                    {/* Work Information */}
                    <View className="mb-8">
                      <Text className="text-[11px] font-black uppercase tracking-[0.15em] mb-4" style={{ color: colors.primary }}>Work Information</Text>
                      <View className="gap-3">
                        {selectedUser.job_title && (
                          <View>
                            <Text className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: colors.textMuted }}>Job Title</Text>
                            <Text style={{ color: colors.textMain }}>{selectedUser.job_title}</Text>
                          </View>
                        )}
                        {selectedUser.department && (
                          <View>
                            <Text className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: colors.textMuted }}>Department</Text>
                            <Text style={{ color: colors.textMain }}>{selectedUser.department}</Text>
                          </View>
                        )}
                        {selectedUser.work_status && (
                          <View>
                            <Text className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: colors.textMuted }}>Status</Text>
                            <Text style={{ color: colors.textMain }}>{selectedUser.work_status}</Text>
                          </View>
                        )}
                        <View>
                          <Text className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: colors.textMuted }}>Last Active</Text>
                          <Text style={{ color: colors.textMain }}>
                            {selectedUser.last_seen_at ? new Date(selectedUser.last_seen_at).toLocaleDateString() : 'Never'}
                          </Text>
                        </View>
                      </View>
                    </View>

                    {/* Teams */}
                    {teamMembers.filter(tm => tm.user_id === selectedUser.id).length > 0 && (
                      <View>
                        <Text className="text-[11px] font-black uppercase tracking-[0.15em] mb-4" style={{ color: colors.primary }}>Teams</Text>
                        <View className="flex-row flex-wrap gap-2">
                          {teams
                            .filter(t => teamMembers.find(tm => tm.user_id === selectedUser.id && tm.team_id === t.id))
                            .map(team => (
                              <View key={team.id} className="border px-3 py-2 rounded-lg" style={{ backgroundColor: `${colors.primary}10`, borderColor: `${colors.primary}33` }}>
                                <Text className="text-[10px] font-black uppercase tracking-widest" style={{ color: colors.primary }}>
                                  {team.name}
                                </Text>
                              </View>
                            ))}
                        </View>
                      </View>
                    )}
                  </View>
                )}

                {selectedUser && activeTab === 'activity' && (
                  <View>
                    <Text className="text-center py-8" style={{ color: colors.textMuted }}>
                      Activity tracking coming soon. Show recent tasks, comments, and time tracking data.
                    </Text>
                  </View>
                )}

                {selectedUser && activeTab === 'roles' && canAssignRoles && (
                  <View>
                    {/* Direct Roles */}
                    <View className="mb-8">
                      <View className="flex-row items-center mb-4">
                        <FontAwesome name="shield" size={13} color={colors.primary} />
                        <Text className="text-[11px] font-black uppercase ml-3 tracking-[0.15em]" style={{ color: colors.primary }}>Direct Roles</Text>
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
                                <View key={role.id} className="px-4 py-2.5 rounded-xl border flex-row items-center opacity-60" style={{ backgroundColor: `${colors.primary}10`, borderColor: `${colors.primary}33` }}>
                                  <FontAwesome name="lock" size={9} color={colors.primary} style={{ marginRight: 6 }} />
                                  <Text className="text-[10px] font-black uppercase tracking-widest" style={{ color: colors.primary }}>{role.name}</Text>
                                </View>
                              );
                            }
                            return (
                              <TouchableOpacity
                                key={role.id}
                                onPress={() => setDraftRoleIds(prev => isDirect ? prev.filter(id => id !== role.id) : [...prev, role.id])}
                                className="px-4 py-2.5 rounded-xl border transition-all"
                                style={{
                                  backgroundColor: isDirect ? colors.primary : colors.background,
                                  borderColor: isDirect ? colors.primary : colors.border
                                }}
                              >
                                <Text className="text-[10px] font-black uppercase tracking-widest" style={{ color: isDirect ? colors.background : colors.textMuted }}>
                                  {role.name}
                                </Text>
                              </TouchableOpacity>
                            );
                          });
                        })()}
                      </View>
                    </View>

                    {/* Teams */}
                    <View>
                      <View className="flex-row items-center mb-4">
                        <FontAwesome name="users" size={13} color={colors.primary} />
                        <Text className="text-[11px] font-black uppercase ml-3 tracking-[0.15em]" style={{ color: colors.primary }}>Team Membership</Text>
                      </View>
                      <View className="flex-row flex-wrap gap-2">
                        {teams.map(team => {
                          const isActive = draftTeamIds.includes(team.id);
                          return (
                            <TouchableOpacity
                              key={team.id}
                              onPress={() => setDraftTeamIds(prev => isActive ? prev.filter(id => id !== team.id) : [...prev, team.id])}
                              className="px-4 py-2.5 rounded-xl border transition-all"
                              style={{
                                backgroundColor: isActive ? colors.primary : colors.background,
                                borderColor: isActive ? colors.primary : colors.border
                              }}
                            >
                              <Text className="text-[10px] font-black uppercase tracking-widest" style={{ color: isActive ? colors.background : colors.textMuted }}>
                                {team.name}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </View>
                  </View>
                )}

                {selectedUser && activeTab === 'roles' && !canAssignRoles && (
                  <View className="py-8 items-center">
                    <FontAwesome name="lock" size={24} color={colors.textMuted} style={{ marginBottom: 12 }} />
                    <Text className="text-center" style={{ color: colors.textMuted }}>You don't have permission to manage roles.</Text>
                  </View>
                )}
              </ScrollView>

              {/* Footer */}
              <View className="flex-row gap-3 px-8 py-6 border-t" style={{ borderColor: colors.border }}>
                <TouchableOpacity onPress={() => setSelectedUser(null)} className="flex-1 border py-4 rounded-xl items-center" style={{ backgroundColor: colors.card, borderColor: colors.border }}>
                  <Text className="font-black text-[11px] uppercase tracking-widest" style={{ color: colors.textMuted }}>Close</Text>
                </TouchableOpacity>
                {activeTab === 'roles' && canAssignRoles && (
                  <TouchableOpacity onPress={handleSave} disabled={loading} className="flex-1 py-4 rounded-xl items-center premium-shadow active:scale-[0.98]" style={{ backgroundColor: colors.primary }}>
                    <Text className="font-black text-[11px] uppercase tracking-widest" style={{ color: colors.background }}>Save Changes</Text>
                  </TouchableOpacity>
                )}
                {canRemoveUsers && (
                  <TouchableOpacity onPress={handleRemoveUser} className="flex-1 border py-4 rounded-xl items-center active:scale-[0.98]" style={{ backgroundColor: `${colors.danger}20`, borderColor: `${colors.danger}66` }}>
                    <Text className="font-black text-[11px] uppercase tracking-widest" style={{ color: colors.danger }}>Remove</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>
        ) : (
          /* Mobile: bottom sheet with tabs */
          <View className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0, 0, 0, 0.6)' }}>
            <View className="w-full rounded-t-3xl border-t border-x" style={{ backgroundColor: colors.card, borderColor: colors.border, maxHeight: '90%' }}>
              {/* Handle */}
              <View className="items-center pt-3 pb-1">
                <View className="w-10 h-1 rounded-full" style={{ backgroundColor: colors.border }} />
              </View>

              {/* Header with Profile Summary */}
              {selectedUser && (
                <View className="px-5 pt-3 pb-4 border-b" style={{ borderColor: colors.border }}>
                  <View className="flex-row items-start justify-between mb-4">
                    <View className="flex-row items-center flex-1 mr-3">
                      <View className="w-14 h-14 rounded-xl items-center justify-center border overflow-hidden mr-3 flex-shrink-0" style={{ backgroundColor: colors.primary, borderColor: colors.primary }}>
                        {selectedUser.avatar_url ? (
                          <Image source={{ uri: selectedUser.avatar_url }} className="w-full h-full" />
                        ) : (
                          <Text className="font-black text-2xl" style={{ color: colors.background }}>
                            {selectedUser.full_name?.charAt(0) || selectedUser.email.charAt(0).toUpperCase()}
                          </Text>
                        )}
                      </View>
                      <View className="flex-1">
                        <Text className="font-black text-lg mb-1" numberOfLines={1} style={{ color: colors.textMain }}>
                          {selectedUser.full_name || selectedUser.email}
                        </Text>
                        <Text className="text-[10px] font-semibold" style={{ color: colors.primary }}>
                          Joined {getTenure(selectedUser.created_at)} ago
                        </Text>
                      </View>
                    </View>
                    <TouchableOpacity onPress={() => setSelectedUser(null)} className="w-9 h-9 items-center justify-center rounded-full border flex-shrink-0" style={{ backgroundColor: `${colors.primary}15`, borderColor: colors.primary }}>
                      <FontAwesome name="times" size={14} color={colors.primary} />
                    </TouchableOpacity>
                  </View>

                  {/* Tabs */}
                  <View className="flex-row gap-2">
                    {(['profile', 'activity', 'roles'] as TabType[]).map(tab => (
                      <TouchableOpacity
                        key={tab}
                        onPress={() => setActiveTab(tab)}
                        className="flex-1 px-3 py-2 rounded-lg border"
                        style={{
                          backgroundColor: activeTab === tab ? colors.primary : colors.card,
                          borderColor: activeTab === tab ? colors.primary : colors.border
                        }}
                      >
                        <Text className="text-[10px] font-black uppercase tracking-tight text-center" style={{ color: activeTab === tab ? colors.background : colors.primary }}>
                          {tab === 'profile' ? 'Profile' : tab === 'activity' ? 'Activity' : 'Access'}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}

              {/* Tab Content */}
              <ScrollView showsVerticalScrollIndicator={false} className="px-5" contentContainerStyle={{ paddingBottom: 20 }}>
                {selectedUser && activeTab === 'profile' && (
                  <View className="pt-4">
                    {/* Contact Info */}
                    <View className="mb-6">
                      <Text className="text-[10px] font-black uppercase tracking-[0.15em] mb-3" style={{ color: colors.primary }}>Contact</Text>
                      <View className="gap-2">
                        <View className="flex-row items-center p-3 rounded-lg border" style={{ backgroundColor: colors.background, borderColor: colors.border }}>
                          <FontAwesome name="envelope" size={11} color={colors.textMuted} style={{ marginRight: 12, width: 20 }} />
                          <Text className="text-xs flex-1" numberOfLines={1} style={{ color: colors.textMain }}>
                            {selectedUser.email}
                          </Text>
                        </View>
                        {selectedUser.phone && (
                          <View className="flex-row items-center p-3 rounded-lg border" style={{ backgroundColor: colors.background, borderColor: colors.border }}>
                            <FontAwesome name="phone" size={11} color={colors.textMuted} style={{ marginRight: 12, width: 20 }} />
                            <Text className="text-xs" style={{ color: colors.textMain }}>{selectedUser.phone}</Text>
                          </View>
                        )}
                      </View>
                    </View>

                    {/* Work Info */}
                    <View className="mb-6">
                      <Text className="text-[10px] font-black uppercase tracking-[0.15em] mb-3" style={{ color: colors.primary }}>Work Info</Text>
                      <View className="gap-2">
                        {selectedUser.job_title && (
                          <View className="p-3 rounded-lg border" style={{ backgroundColor: colors.background, borderColor: colors.border }}>
                            <Text className="text-typography-label text-[9px] font-bold uppercase tracking-widest mb-1">Job Title</Text>
                            <Text className="text-typography-main text-sm">{selectedUser.job_title}</Text>
                          </View>
                        )}
                        {selectedUser.department && (
                          <View className="p-3 rounded-lg border" style={{ backgroundColor: colors.background, borderColor: colors.border }}>
                            <Text className="text-typography-label text-[9px] font-bold uppercase tracking-widest mb-1">Department</Text>
                            <Text className="text-typography-main text-sm">{selectedUser.department}</Text>
                          </View>
                        )}
                      </View>
                    </View>

                    {/* Teams */}
                    {teamMembers.filter(tm => tm.user_id === selectedUser.id).length > 0 && (
                      <View>
                        <Text className="text-[10px] font-black uppercase tracking-[0.15em] mb-3" style={{ color: colors.primary }}>Teams</Text>
                        <View className="flex-row flex-wrap gap-2">
                          {teams
                            .filter(t => teamMembers.find(tm => tm.user_id === selectedUser.id && tm.team_id === t.id))
                            .map(team => (
                              <View key={team.id} className="border px-3 py-2 rounded-lg" style={{ backgroundColor: `${colors.primary}10`, borderColor: `${colors.primary}33` }}>
                                <Text className="text-[10px] font-black uppercase tracking-widest" style={{ color: colors.primary }}>
                                  {team.name}
                                </Text>
                              </View>
                            ))}
                        </View>
                      </View>
                    )}
                  </View>
                )}

                {selectedUser && activeTab === 'activity' && (
                  <View className="py-8 items-center">
                    <Text className="text-typography-muted text-center text-sm">
                      Activity tracking coming soon.
                    </Text>
                  </View>
                )}

                {selectedUser && activeTab === 'roles' && canAssignRoles && (
                  <View className="pt-4">
                    {/* Direct Roles */}
                    <View className="mb-6">
                      <View className="flex-row items-center mb-3">
                        <FontAwesome name="shield" size={11} color={colors.primary} />
                        <Text className="text-[10px] font-black uppercase ml-2 tracking-widest" style={{ color: colors.primary }}>Direct Roles</Text>
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
                                <View key={role.id} className="flex-row items-center justify-between p-3 rounded-lg border opacity-60" style={{ backgroundColor: `${colors.primary}10`, borderColor: `${colors.primary}33` }}>
                                  <View className="flex-row items-center flex-1 mr-2">
                                    <FontAwesome name="lock" size={9} color={colors.primary} style={{ marginRight: 8 }} />
                                    <Text className="text-[10px] font-black uppercase tracking-tight" style={{ color: colors.primary }}>{role.name}</Text>
                                  </View>
                                  <Text className="text-[8px] font-black uppercase tracking-widest" style={{ color: colors.primary }}>via team</Text>
                                </View>
                              );
                            }
                            return (
                              <TouchableOpacity
                                key={role.id}
                                onPress={() => setDraftRoleIds(prev => isDirect ? prev.filter(id => id !== role.id) : [...prev, role.id])}
                                className="flex-row items-center justify-between p-3 rounded-lg border"
                                style={{
                                  backgroundColor: isDirect ? `${colors.primary}10` : colors.background,
                                  borderColor: isDirect ? `${colors.primary}66` : colors.border
                                }}
                              >
                                <Text className="text-[10px] font-black uppercase tracking-tight flex-1" style={{ color: isDirect ? colors.textMain : colors.textMuted }}>
                                  {role.name}
                                </Text>
                                <View className="w-5 h-5 rounded-full items-center justify-center border ml-2 flex-shrink-0" style={{ backgroundColor: isDirect ? colors.primary : 'transparent', borderColor: isDirect ? colors.primary : colors.border }}>
                                  {isDirect && <FontAwesome name="check" size={9} color={colors.background} />}
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
                        <FontAwesome name="users" size={11} color={colors.primary} />
                        <Text className="text-[10px] font-black uppercase ml-2 tracking-widest" style={{ color: colors.primary }}>Team Membership</Text>
                      </View>
                      <View className="gap-2">
                        {teams.map(team => {
                          const isActive = draftTeamIds.includes(team.id);
                          return (
                            <TouchableOpacity
                              key={team.id}
                              onPress={() => setDraftTeamIds(prev => isActive ? prev.filter(id => id !== team.id) : [...prev, team.id])}
                              className="flex-row items-center justify-between p-3 rounded-lg border"
                              style={{
                                backgroundColor: isActive ? `${colors.primary}10` : colors.background,
                                borderColor: isActive ? `${colors.primary}66` : colors.border
                              }}
                            >
                              <Text className="text-[10px] font-black uppercase tracking-tight flex-1" style={{ color: isActive ? colors.textMain : colors.textMuted }}>
                                {team.name}
                              </Text>
                              <View className="w-5 h-5 rounded-full items-center justify-center border ml-2 flex-shrink-0" style={{ backgroundColor: isActive ? colors.primary : 'transparent', borderColor: isActive ? colors.primary : colors.border }}>
                                {isActive && <FontAwesome name="check" size={9} color={colors.background} />}
                              </View>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </View>
                  </View>
                )}

                {selectedUser && activeTab === 'roles' && !canAssignRoles && (
                  <View className="py-8 items-center">
                    <FontAwesome name="lock" size={20} color={colors.textMuted} style={{ marginBottom: 12 }} />
                    <Text className="text-center text-xs" style={{ color: colors.textMuted }}>
                      You don't have permission to manage roles.
                    </Text>
                  </View>
                )}
              </ScrollView>

              {/* Footer */}
              <View className="flex-row gap-2 px-5 py-4 border-t" style={{ borderColor: colors.border }}>
                <TouchableOpacity onPress={() => setSelectedUser(null)} className="flex-1 border py-3 rounded-lg items-center" style={{ backgroundColor: colors.card, borderColor: colors.border }}>
                  <Text className="font-black text-[10px] uppercase tracking-widest" style={{ color: colors.textMuted }}>Close</Text>
                </TouchableOpacity>
                {activeTab === 'roles' && canAssignRoles && (
                  <TouchableOpacity onPress={handleSave} disabled={loading} className="flex-1 py-3 rounded-lg items-center active:scale-[0.98]" style={{ backgroundColor: colors.primary }}>
                    <Text className="font-black text-[10px] uppercase tracking-widest" style={{ color: colors.background }}>Save</Text>
                  </TouchableOpacity>
                )}
                {canRemoveUsers && (
                  <TouchableOpacity onPress={handleRemoveUser} className="flex-1 border py-3 rounded-lg items-center active:scale-[0.98]" style={{ backgroundColor: `${colors.danger}20`, borderColor: `${colors.danger}66` }}>
                    <Text className="font-black text-[10px] uppercase tracking-widest" style={{ color: colors.danger }}>Remove</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>
        )}
      </Modal>
    </View>
  );
}

