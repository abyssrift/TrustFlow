import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, Alert, Modal } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { useRoleManager, Role } from '@/contexts/RoleManagerContext';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeColors } from '@/hooks/useThemeColors';

export default function RoleBuilder() {
  const colors = useThemeColors();
  const { hasPermission } = useAuth();
  const canManageRoles = hasPermission('role.manage');
  const { roles, permissions, createRole, updateRole, deleteRole, loading } = useRoleManager();
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [isCreating, setIsCreating] = useState(false);

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
            <TouchableOpacity
              onPress={handleStartCreate}
              className="bg-brand-primary px-4 py-3 rounded-xl active:scale-[0.98]"
            >
              <Text className="text-white font-black text-[10px] uppercase tracking-widest">+ New Role</Text>
            </TouchableOpacity>
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

      {/* Editor Modal — bottom sheet on mobile */}
      <Modal visible={!!editingRole || isCreating} transparent animationType="slide">
        <View className="flex-1 bg-black/60 justify-end">
          <View className="bg-surface-card w-full rounded-t-3xl border-t border-x border-surface-border max-h-[95%]">
            {/* Handle */}
            <View className="items-center pt-3 pb-1">
              <View className="w-10 h-1 rounded-full bg-surface-border" />
            </View>

            {/* Header */}
            <View className="flex-row items-center justify-between px-5 pt-3 pb-5">
              <View className="flex-1 mr-4">
                <Text className="text-typography-muted text-[9px] font-black uppercase tracking-[0.3em] mb-1">Role Editor</Text>
                <Text className="text-typography-main text-xl font-black tracking-tight" numberOfLines={1}>
                  {isCreating ? 'New Role' : (editingRole?.name || 'Edit Role')}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => { setEditingRole(null); setIsCreating(false); }}
                className="w-10 h-10 items-center justify-center rounded-full bg-surface-background border border-surface-border"
              >
                <FontAwesome name="times" size={16} color={colors.textMain} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} className="px-5" contentContainerStyle={{ paddingBottom: 24 }}>
              {isGlobal && (
                <View className="bg-state-info/10 border border-state-info/30 p-4 rounded-2xl mb-5 flex-row items-center">
                  <View className="w-9 h-9 rounded-full bg-state-info/20 items-center justify-center mr-3 flex-shrink-0">
                    <FontAwesome name="shield" size={16} color={colors.info} />
                  </View>
                  <View className="flex-1">
                    <Text className="text-typography-main font-black text-xs uppercase tracking-tight mb-1">System Protected</Text>
                    <Text className="text-typography-muted text-[10px] leading-4">This is a platform-wide role. Create a custom role to modify permissions.</Text>
                  </View>
                </View>
              )}

              {/* Identity section */}
              <Text className="text-brand-primary text-[10px] font-black uppercase mb-3 tracking-widest">Identity</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                editable={canEdit}
                placeholder="Role name"
                placeholderTextColor={colors.textMuted}
                className={`bg-surface-background border border-surface-border rounded-xl px-4 py-4 text-typography-main font-black text-sm mb-3 ${!canEdit ? 'opacity-50' : ''}`}
              />
              <TextInput
                value={description}
                onChangeText={setDescription}
                editable={canEdit}
                placeholder="Description..."
                placeholderTextColor={colors.textMuted}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
                className={`bg-surface-background border border-surface-border rounded-xl px-4 py-4 text-typography-main text-sm mb-5 h-24 leading-5 ${!canEdit ? 'opacity-50' : ''}`}
              />

              {/* Color section */}
              <View className="flex-row items-center justify-between mb-3">
                <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest">Color</Text>
                <Text className="text-brand-primary font-black text-[10px]">{color}</Text>
              </View>
              <View className={`flex-row flex-wrap gap-3 mb-6 ${!canEdit ? 'opacity-50' : ''}`}>
                {[colors.primary, colors.success, colors.warning, colors.danger, '#6366f1', '#10b981', colors.info, colors.border].map(c => (
                  <TouchableOpacity
                    key={c}
                    onPress={() => canEdit && setColor(c)}
                    style={{ backgroundColor: c }}
                    className={`w-9 h-9 rounded-xl border-2 ${color === c ? 'border-white' : 'border-transparent'}`}
                  />
                ))}
              </View>

              {/* Permissions section */}
              <Text className="text-brand-primary text-[10px] font-black uppercase mb-4 tracking-widest">Permissions</Text>
              <View className="gap-5">
                {categories.map(cat => (
                  <View key={cat}>
                    <View className="flex-row items-center mb-3">
                      <View className="w-1.5 h-1.5 rounded-full bg-brand-primary mr-2 flex-shrink-0" />
                      <Text className="text-typography-main text-[11px] font-black uppercase tracking-widest">{cat}</Text>
                    </View>
                    <View className="gap-2">
                      {permissions.filter(p => p.category === cat).map(perm => {
                        const isActive = selectedPerms.includes(perm.id);
                        return (
                          <TouchableOpacity
                            key={perm.id}
                            onPress={() => canEdit && setSelectedPerms(prev => isActive ? prev.filter(id => id !== perm.id) : [...prev, perm.id])}
                            className={`flex-row items-center justify-between p-4 rounded-2xl border ${
                              isActive ? 'bg-brand-primary/5 border-brand-primary/40' : 'bg-surface-background/30 border-surface-border'
                            } ${!canEdit ? 'opacity-70' : ''}`}
                          >
                            <View className="flex-1 mr-3">
                              <Text className={`font-black text-xs uppercase tracking-tight ${isActive ? 'text-typography-main' : 'text-typography-muted'}`}>{perm.label}</Text>
                              <Text className="text-typography-dim text-[10px] mt-1 font-bold leading-4">{perm.description || '(no documentation)'}</Text>
                            </View>
                            <View className={`w-6 h-6 rounded-full items-center justify-center border flex-shrink-0 ${isActive ? 'bg-brand-primary border-brand-primary' : 'border-surface-border'}`}>
                              {isActive && <FontAwesome name="check" size={10} color="white" />}
                            </View>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                ))}
              </View>
            </ScrollView>

            {/* Footer buttons */}
            <View className="flex-row gap-3 px-5 py-4 border-t border-surface-border">
              <TouchableOpacity
                onPress={() => { setEditingRole(null); setIsCreating(false); }}
                className="flex-1 bg-surface-background py-4 rounded-xl border border-surface-border items-center"
              >
                <Text className="text-typography-muted font-black text-[11px] uppercase tracking-widest">Cancel</Text>
              </TouchableOpacity>
              {canEdit && (
                <TouchableOpacity
                  onPress={handleSave}
                  disabled={loading}
                  className="flex-[2] bg-brand-primary py-4 rounded-xl items-center"
                >
                  <Text className="text-white font-black text-[11px] uppercase tracking-widest">Save Role</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
