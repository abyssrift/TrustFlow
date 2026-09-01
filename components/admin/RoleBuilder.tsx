import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, Platform } from 'react-native';
import RoleEditorSheet from '@/components/admin/RoleEditorSheet';
import RoleTemplateGallery from '@/components/admin/RoleTemplateGallery';
import { FontAwesome } from '@expo/vector-icons';
import { useRoleManager, Role } from '@/contexts/RoleManagerContext';
import { useAuth } from '@/contexts/AuthContext';
import { useAlert } from '@/contexts/AlertContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { RoleTemplate } from '@/lib/roleTemplates';
import Tooltip from '@/components/common/Tooltip';
import MultiViewList from '@/components/common/MultiViewList';
import GridSectionHeader from '@/components/admin/GridSectionHeader';
import { useCollapsibleHeaderScroll } from '@/hooks/useCollapsibleHeader';

export default function RoleBuilder() {
  const colors = useThemeColors();
  const { showAlert, showConfirm } = useAlert();
  const { hasPermission } = useAuth();
  const canManageRoles = hasPermission('role.manage');
  const { roles, permissions, userRoles, teamRoles, createRole, updateRole, deleteRole, loading } = useRoleManager();
  // #309: drives the roles-screen collapsible header. Inert when this grid
  // renders outside a <CollapsibleHeaderProvider> (hook is null-safe).
  const headerScroll = useCollapsibleHeaderScroll();
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [query, setQuery] = useState('');

  const visibleRoles = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return roles;
    return roles.filter((r) =>
      r.name.toLowerCase().includes(q) ||
      (r.description ?? '').toLowerCase().includes(q)
    );
  }, [roles, query]);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(colors.primary);
  const [selectedPerms, setSelectedPerms] = useState<string[]>([]);

  const handleEditRole = (role: Role) => {
    if (!canManageRoles) return;
    setEditingRole(role);
    setName(role.name);
    setDescription(role.description || '');
    setColor(role.color || '#6366f1');
    setSelectedPerms(role.permissionIds || []);
    setIsCreating(false);
  };

  const handleStartCreate = () => {
    if (!canManageRoles) return;
    setEditingRole(null);
    setName('');
    setDescription('');
    setColor('#6366f1');
    setSelectedPerms([]);
    setIsCreating(true);
  };

  const handleCloneRole = (role: Role) => {
    if (!canManageRoles) return;
    setEditingRole(null);
    setName(`${role.name} (Copy)`);
    setDescription(role.description || '');
    setColor(role.color?.includes('var') ? colors.primary : (role.color || colors.primary));
    setSelectedPerms(role.permissionIds || []);
    setIsCreating(true);
  };

  const handlePickTemplate = (tpl: RoleTemplate) => {
    if (!canManageRoles) return;
    // Resolve the template's permission keys against the live permission set.
    // Unknown keys (e.g. removed in a later schema) are silently skipped.
    const ids = permissions.filter(p => tpl.permissionKeys.includes(p.key)).map(p => p.id);
    setEditingRole(null);
    setName(tpl.name);
    setDescription(tpl.description);
    setColor(tpl.color);
    setSelectedPerms(ids);
    setShowTemplates(false);
    setIsCreating(true);
  };

  const isGlobal = editingRole?.is_system;
  const canEdit = !isGlobal;

  const handleSave = async () => {
    if (!canEdit) return;
    if (!name.trim()) return showAlert('Error', 'Role name is required.');

    let success = false;
    if (editingRole) {
      success = await updateRole(editingRole.id, name, description, color, selectedPerms);
    } else {
      const id = await createRole(name, description, color, selectedPerms);
      success = !!id;
    }

    if (success) {
      setEditingRole(null);
      setIsCreating(false);
    }
  };

  const handleDelete = async (role: Role) => {
    if (role.is_system) return;
    const nPeople = userRoles.filter(u => u.role_id === role.id).length;
    const nTeams = teamRoles.filter(t => t.role_id === role.id).length;
    const impact = nPeople + nTeams > 0
      ? `It is assigned to ${nPeople} ${nPeople === 1 ? 'person' : 'people'} and ${nTeams} ${nTeams === 1 ? 'team' : 'teams'} — they will lose its permissions.`
      : 'It is not assigned to anyone.';
    showConfirm(
      'Confirm Deletion',
      `Delete the role "${role.name}"? ${impact}`,
      async () => await deleteRole(role.id),
      undefined,
      'Delete',
      undefined,
      'destructive'
    );
  };

  const categories = Array.from(new Set(permissions.map(p => p.category)));

  return (
    <View className="flex-1">
        <GridSectionHeader
          eyebrow="Structural Paradigms"
          title="Role Registry"
          right={canManageRoles && (
            <View className="flex-row items-center gap-2">
              <TouchableOpacity
                onPress={() => setShowTemplates(true)}
                className="bg-surface-card border border-surface-border px-4 py-3 rounded-xl active:scale-[0.98] flex-row items-center"
              >
                <FontAwesome name="list-alt" size={11} color={colors.primary} />
                <Text className="text-typography-main font-black text-[10px] uppercase tracking-widest ml-2">Templates</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleStartCreate}
                className="bg-brand-primary px-4 py-3 rounded-xl active:scale-[0.98]"
              >
                <Text className="text-white font-black text-[10px] uppercase tracking-widest">+ New Role</Text>
              </TouchableOpacity>
            </View>
          )}
        />

        <MultiViewList
          {...headerScroll}
          items={visibleRoles}
          keyExtractor={(r) => r.id}
          renderCard={(r) => {
            const nPeople = userRoles.filter(u => u.role_id === r.id).length;
            const nTeams = teamRoles.filter(t => t.role_id === r.id).length;
            return (
              <View className="bg-surface-card w-full p-5 rounded-2xl border border-surface-border">
                <View className="flex-row items-center justify-between mb-3">
                  <View className="flex-row items-center flex-1 mr-3">
                    <View
                      style={{ backgroundColor: r.color?.includes('var') ? colors.primary : (r.color || colors.primary) }}
                      className="w-3.5 h-3.5 rounded-full mr-3 flex-shrink-0"
                    />
                    <Text className="text-typography-main font-black text-base flex-shrink" numberOfLines={1}>{r.name}</Text>
                    {r.is_system && (
                      <View className="bg-brand-primary/10 px-2 py-0.5 rounded-lg ml-2 border border-brand-primary/20 flex-shrink-0">
                        <Text className="text-brand-primary text-[8px] font-black uppercase tracking-widest">System</Text>
                      </View>
                    )}
                  </View>
                  <View className="flex-row items-center gap-2 flex-shrink-0">
                    {canManageRoles && Platform.OS === 'web' && (
                      <Tooltip label="Duplicate role">
                        <TouchableOpacity
                          onPress={(e: any) => {
                            e.stopPropagation();
                            handleCloneRole(r);
                          }}
                          className="w-9 h-9 items-center justify-center border border-surface-border rounded-xl bg-surface-background"
                        >
                          <FontAwesome name="clone" size={13} color={colors.textMuted} />
                        </TouchableOpacity>
                      </Tooltip>
                    )}
                    {!r.is_system && canManageRoles && (
                      <Tooltip label="Delete role">
                        <TouchableOpacity
                          onPress={(e) => {
                            e.stopPropagation();
                            handleDelete(r);
                          }}
                          className="w-9 h-9 items-center justify-center border border-state-danger/10 rounded-xl bg-state-danger-dim"
                        >
                          <FontAwesome name="trash-o" size={14} color={colors.danger} />
                        </TouchableOpacity>
                      </Tooltip>
                    )}
                  </View>
                </View>

                <Text className="text-typography-muted text-xs mb-4 leading-5" numberOfLines={2}>
                  {r.description || 'No description provided.'}
                </Text>

                <View className="flex-row items-center gap-2">
                  <Tooltip label="Permissions granted to this role">
                    <View className="bg-surface-background px-3 py-1.5 rounded-lg border border-surface-border flex-row items-center">
                      <FontAwesome name="key" size={10} color={colors.primary} />
                      <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest ml-2">
                        {r.permissionIds?.length || 0} permissions
                      </Text>
                    </View>
                  </Tooltip>
                  <Tooltip label="Members with this role">
                    <View className="bg-surface-background px-3 py-1.5 rounded-lg border border-surface-border flex-row items-center">
                      <FontAwesome name="user" size={10} color={colors.textMuted} />
                      <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest ml-2">
                        {nPeople + nTeams > 0
                          ? `${nPeople} ${nPeople === 1 ? 'person' : 'people'} · ${nTeams} ${nTeams === 1 ? 'team' : 'teams'}`
                          : 'Unassigned'}
                      </Text>
                    </View>
                  </Tooltip>
                </View>
              </View>
            );
          }}
          renderRow={(r) => {
            const nPeople = userRoles.filter(u => u.role_id === r.id).length;
            const nTeams = teamRoles.filter(t => t.role_id === r.id).length;
            return (
              <View className="flex-row items-center gap-3">
                <View
                  style={{ backgroundColor: r.color?.includes('var') ? colors.primary : (r.color || colors.primary) }}
                  className="w-9 h-9 rounded-xl items-center justify-center flex-shrink-0"
                >
                  <FontAwesome name="shield" size={14} color="white" />
                </View>
                <View className="flex-1 min-w-0">
                  <View className="flex-row items-center gap-2">
                    <Text className="text-typography-main font-black text-sm flex-shrink" numberOfLines={1}>{r.name}</Text>
                    {r.is_system && (
                      <View className="bg-brand-primary/10 px-2 py-0.5 rounded-lg border border-brand-primary/20 flex-shrink-0">
                        <Text className="text-brand-primary text-[8px] font-black uppercase tracking-widest">System</Text>
                      </View>
                    )}
                  </View>
                  <Text className="text-typography-muted text-[11px]" numberOfLines={1}>
                    {r.permissionIds?.length || 0} permissions · {nPeople + nTeams > 0 ? `${nPeople} people · ${nTeams} teams` : 'Unassigned'}
                  </Text>
                </View>
                {canManageRoles && Platform.OS === 'web' && (
                  <Tooltip label="Duplicate role">
                    <TouchableOpacity
                      onPress={(e: any) => { e.stopPropagation(); handleCloneRole(r); }}
                      className="w-9 h-9 items-center justify-center border border-surface-border rounded-xl bg-surface-background"
                    >
                      <FontAwesome name="clone" size={13} color={colors.textMuted} />
                    </TouchableOpacity>
                  </Tooltip>
                )}
                {!r.is_system && canManageRoles && (
                  <Tooltip label="Delete role">
                    <TouchableOpacity
                      onPress={(e: any) => { e.stopPropagation(); handleDelete(r); }}
                      className="w-9 h-9 items-center justify-center border border-state-danger/10 rounded-xl bg-state-danger-dim"
                    >
                      <FontAwesome name="trash-o" size={14} color={colors.danger} />
                    </TouchableOpacity>
                  </Tooltip>
                )}
              </View>
            );
          }}
          columns={[
            {
              key: 'role',
              label: 'Role',
              flex: 2.2,
              render: (r) => (
                <View className="flex-row items-center gap-3">
                  <View
                    style={{ backgroundColor: r.color?.includes('var') ? colors.primary : (r.color || colors.primary) }}
                    className="w-9 h-9 rounded-xl items-center justify-center flex-shrink-0"
                  >
                    <FontAwesome name="shield" size={14} color="white" />
                  </View>
                  <View className="min-w-0">
                    <Text className="text-typography-main font-black text-sm" numberOfLines={1}>{r.name}</Text>
                    <Text className="text-typography-muted text-[10px]">{r.is_system ? 'System role' : 'Custom role'}</Text>
                  </View>
                </View>
              ),
            },
            {
              key: 'permissions',
              label: 'Permissions',
              flex: 1.2,
              render: (r) => <Text className="text-typography-main text-xs font-bold">{r.permissionIds?.length || 0}</Text>,
            },
            {
              key: 'members',
              label: 'Members',
              flex: 1.4,
              render: (r) => {
                const nPeople = userRoles.filter(u => u.role_id === r.id).length;
                const nTeams = teamRoles.filter(t => t.role_id === r.id).length;
                return <Text className="text-typography-muted text-xs">{nPeople + nTeams > 0 ? `${nPeople} people · ${nTeams} teams` : 'Unassigned'}</Text>;
              },
            },
            {
              key: 'status',
              label: 'Status',
              flex: 0.9,
              align: 'right',
              render: (r) => <Text className="text-typography-muted text-[10px] uppercase font-black tracking-widest">{r.is_system ? 'System' : 'Custom'}</Text>,
            },
          ]}
          onItemPress={(r) => handleEditRole(r)}
          storageKey="role-registry"
          modes={['large', 'list', 'details']}
          defaultMode="large"
          search={{ value: query, onChange: setQuery, placeholder: 'Search roles' }}
          loading={loading}
          emptyState={{
            icon: 'shield',
            title: query.trim() ? 'No matching roles' : 'No roles yet',
            body: query.trim() ? 'Try a different search.' : 'Create a role to define permissions for your team.',
            actionLabel: 'New role',
            onAction: canManageRoles ? () => handleStartCreate() : undefined,
          }}
          style={{ flex: 1 }}
        />

      <RoleEditorSheet
        visible={!!editingRole || isCreating}
        onClose={() => { setEditingRole(null); setIsCreating(false); }}
        isCreating={isCreating}
        editingRole={editingRole}
        name={name}
        onChangeName={setName}
        description={description}
        onChangeDescription={setDescription}
        color={color}
        onChangeColor={setColor}
        selectedPerms={selectedPerms}
        onTogglePerm={(id) => setSelectedPerms(prev => prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id])}
        permissions={permissions}
        categories={categories}
        isGlobal={isGlobal}
        canEdit={canEdit}
        onSave={handleSave}
        loading={loading}
        onClone={editingRole ? () => handleCloneRole(editingRole) : undefined}
        onBulkToggle={(ids, select) => setSelectedPerms(prev =>
          select ? Array.from(new Set([...prev, ...ids])) : prev.filter(p => !ids.includes(p))
        )}
        onApplyTemplate={handlePickTemplate}
      />

      <RoleTemplateGallery
        visible={showTemplates}
        onClose={() => setShowTemplates(false)}
        permissions={permissions}
        onPickTemplate={handlePickTemplate}
      />
    </View>
  );
}
