import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert } from 'react-native';
import RoleEditorSheet from '@/components/admin/RoleEditorSheet';
import RoleTemplateGallery from '@/components/admin/RoleTemplateGallery';
import { FontAwesome } from '@expo/vector-icons';
import { useRoleManager, Role } from '@/contexts/RoleManagerContext';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { RoleTemplate } from '@/lib/roleTemplates';

export default function RoleBuilder() {
  const colors = useThemeColors();
  const { hasPermission } = useAuth();
  const canManageRoles = hasPermission('role.manage');
  const { roles, permissions, createRole, updateRole, deleteRole, loading } = useRoleManager();
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);

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
    if (!name.trim()) return Alert.alert('Error', 'Role name is required.');

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
    Alert.alert(
      'Confirm Deletion',
      `Are you sure you want to delete the role "${role.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: async () => await deleteRole(role.id) }
      ]
    );
  };

  const categories = Array.from(new Set(permissions.map(p => p.category)));

  return (
    <View className="flex-1">
      <ScrollView showsVerticalScrollIndicator={false}>
        <View className="flex-row items-center justify-between mb-6 px-1">
          <View className="flex-1 mr-3">
            <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.25em] mb-1">Structural Paradigms</Text>
            <Text className="text-typography-main text-2xl font-black tracking-tight">Role Registry</Text>
          </View>
          {canManageRoles && (
            <View className="flex-row items-center gap-2">
              <TouchableOpacity
                onPress={() => setShowTemplates(true)}
                className="bg-surface-card border border-surface-border px-4 py-3 rounded-xl active:scale-[0.98] flex-row items-center"
              >
                <FontAwesome name="th-large" size={11} color={colors.primary} />
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
        </View>

        <View className="gap-3 pb-32">
          {roles.map(role => (
            <TouchableOpacity
              key={role.id}
              onPress={() => handleEditRole(role)}
              className="bg-surface-card w-full p-5 rounded-2xl border border-surface-border active:scale-[0.98]"
            >
              <View className="flex-row items-center justify-between mb-3">
                <View className="flex-row items-center flex-1 mr-3">
                  <View
                    style={{ backgroundColor: role.color?.includes('var') ? colors.primary : (role.color || colors.primary) }}
                    className="w-3.5 h-3.5 rounded-full mr-3 flex-shrink-0"
                  />
                  <Text className="text-typography-main font-black text-base flex-shrink" numberOfLines={1}>{role.name}</Text>
                  {role.is_system && (
                    <View className="bg-brand-primary/10 px-2 py-0.5 rounded-lg ml-2 border border-brand-primary/20 flex-shrink-0">
                      <Text className="text-brand-primary text-[8px] font-black uppercase tracking-widest">System</Text>
                    </View>
                  )}
                </View>
                {!role.is_system && canManageRoles && (
                  <TouchableOpacity
                    onPress={(e) => {
                      e.stopPropagation();
                      handleDelete(role);
                    }}
                    className="w-9 h-9 items-center justify-center border border-state-danger/10 rounded-xl bg-state-danger-dim flex-shrink-0"
                  >
                    <FontAwesome name="trash-o" size={14} color={colors.danger} />
                  </TouchableOpacity>
                )}
              </View>

              <Text className="text-typography-muted text-xs mb-4 leading-5" numberOfLines={2}>
                {role.description || 'No description provided.'}
              </Text>

              <View className="flex-row items-center">
                <View className="bg-surface-background px-3 py-1.5 rounded-lg border border-surface-border flex-row items-center">
                  <FontAwesome name="key" size={10} color={colors.primary} />
                  <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest ml-2">
                    {role.permissionIds?.length || 0} permissions
                  </Text>
                </View>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

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
