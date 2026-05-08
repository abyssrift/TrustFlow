import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, Alert, Modal } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { useRoleManager, Role, Permission } from '@/contexts/RoleManagerContext';

export default function RoleBuilder() {
  const { roles, permissions, createRole, updateRole, deleteRole, loading } = useRoleManager();
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('#6366f1');
  const [selectedPerms, setSelectedPerms] = useState<string[]>([]);

  const handleEditRole = (role: Role) => {
    setEditingRole(role);
    setName(role.name);
    setDescription(role.description || '');
    setColor(role.color || '#6366f1');
    setSelectedPerms(role.permissionIds || []);
    setIsCreating(false);
  };

  const handleStartCreate = () => {
    setEditingRole(null);
    setName('');
    setDescription('');
    setColor('#6366f1');
    setSelectedPerms([]);
    setIsCreating(true);
  };

  const isGlobal = editingRole?.is_system && !editingRole?.company_id;
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
    if (role.is_system) return; // System roles are protected
    
    // In a premium UI, we might use a custom confirm modal, but for now we follow current logic.
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
        <View className="flex-row items-center justify-between mb-8 px-1">
          <View>
            <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.25em] mb-1">Structural Paradigms</Text>
            <Text className="text-typography-main text-2xl font-black tracking-tight">Role Registry</Text>
          </View>
          <TouchableOpacity 
            onPress={handleStartCreate}
            className="bg-brand-primary px-8 py-4 rounded-xl premium-shadow active:scale-[0.98] transition-transform"
          >
            <Text className="text-white font-black text-[11px] uppercase tracking-widest">Forge New Role</Text>
          </TouchableOpacity>
        </View>

        <View className="flex-row flex-wrap gap-4 pb-32">
          {roles.map(role => (
            <TouchableOpacity
              key={role.id}
              onPress={() => handleEditRole(role)}
              className="bg-surface-card w-full sm:w-[48%] lg:w-[32%] p-6 rounded-2xl border border-surface-border premium-shadow active:scale-[0.98] transition-all"
            >
              <View className="flex-row items-center justify-between mb-5">
                <View className="flex-row items-center flex-1">
                  <View 
                    style={{ backgroundColor: role.color || 'rgb(var(--brand-primary))' }}
                    className="w-4 h-4 rounded-full mr-3 border border-white/20 shadow-sm"
                  />
                  <Text className="text-typography-main font-black text-lg" numberOfLines={1}>{role.name}</Text>
                  {role.is_system && (
                    <View className="bg-brand-primary/10 px-2.5 py-1 rounded-lg ml-3 border border-brand-primary/20">
                      <Text className="text-brand-primary text-[8px] font-black uppercase tracking-widest">System</Text>
                    </View>
                  )}
                </View>
                {!role.is_system && (
                  <TouchableOpacity 
                    onPress={(e) => {
                      e.stopPropagation();
                      handleDelete(role);
                    }} 
                    className="w-10 h-10 items-center justify-center border border-state-danger/10 rounded-xl bg-state-danger-dim"
                  >
                    <FontAwesome name="trash-o" size={14} color="rgb(var(--state-danger))" />
                  </TouchableOpacity>
                )}
              </View>
              
              <Text className="text-typography-muted text-xs mb-6 leading-5 h-10" numberOfLines={2}>
                {role.description || 'No operational mandate provided for this authority node.'}
              </Text>
              
              <View className="flex-row items-center">
                 <View className="bg-surface-background px-4 py-2 rounded-xl border border-surface-border flex-row items-center">
                    <FontAwesome name="key" size={10} color="rgb(var(--brand-primary))" />
                    <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest ml-3">
                      {role.permissionIds?.length || 0} Gates
                    </Text>
                 </View>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* Editor Modal */}
      <Modal visible={!!editingRole || isCreating} transparent animationType="fade">
        <View className="flex-1 bg-surface-background/90 justify-center items-center p-6">
          <View className="bg-surface-card w-full max-w-4xl rounded-3xl border border-surface-border p-8 premium-shadow max-h-[95%]">
             <View className="flex-row items-center justify-between mb-10">
               <View>
                 <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.3em] mb-1">Protocol Architect</Text>
                 <Text className="text-typography-main text-3xl font-black tracking-tight">
                    {isCreating ? 'Forge New Authority' : 'Modify Authority Structure'}
                 </Text>
               </View>
               <TouchableOpacity onPress={() => { setEditingRole(null); setIsCreating(false); }} className="w-12 h-12 items-center justify-center rounded-full bg-surface-background border border-surface-border">
                 <FontAwesome name="times" size={20} color="rgb(var(--text-muted))" />
               </TouchableOpacity>
             </View>

             <ScrollView showsVerticalScrollIndicator={false}>
                {isGlobal && (
                  <View className="bg-state-info/10 border border-state-info/30 p-6 rounded-2xl mb-10 flex-row items-center">
                    <View className="w-10 h-10 rounded-full bg-state-info/20 items-center justify-center mr-4">
                      <FontAwesome name="shield" size={18} color="rgb(var(--state-info))" />
                    </View>
                    <View className="flex-1">
                      <Text className="text-typography-main font-black text-xs uppercase tracking-tight mb-1">System Protected Protocol</Text>
                      <Text className="text-typography-muted text-[10px] leading-4">This authority structure is a platform-wide standard. To modify its specific functional gates, please forge a custom company role instead.</Text>
                    </View>
                  </View>
                )}

                <View className="flex-row flex-wrap gap-10">
                    {/* Left Pane: Config */}
                    <View className="flex-1 min-w-[300px]">
                        <Text className="text-brand-primary text-[10px] font-black uppercase mb-6 tracking-widest px-1">Identity & Intent</Text>
                        <TextInput
                            value={name}
                            onChangeText={setName}
                            editable={canEdit}
                            placeholder="Authority Display Name"
                            placeholderTextColor="rgb(var(--text-muted))"
                            className={`bg-surface-background border border-surface-border rounded-xl px-6 py-5 text-typography-main font-black text-sm mb-5 ${!canEdit ? 'opacity-50' : ''}`}
                        />
                        <TextInput
                            value={description}
                            onChangeText={setDescription}
                            editable={canEdit}
                            placeholder="Operational responsibilities..."
                            placeholderTextColor="rgb(var(--text-muted))"
                            multiline
                            numberOfLines={4}
                            textAlignVertical="top"
                            className={`bg-surface-background border border-surface-border rounded-xl px-6 py-5 text-typography-main text-sm mb-8 h-32 leading-6 ${!canEdit ? 'opacity-50' : ''}`}
                        />
                        
                        <View className="flex-row items-center justify-between mb-6 px-1">
                            <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest">Frequency Marker</Text>
                            <Text className="text-brand-primary font-black text-[10px] uppercase">{color}</Text>
                        </View>
                        <View className={`flex-row flex-wrap gap-3 px-1 ${!canEdit ? 'opacity-50' : ''}`}>
                            {['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#475569'].map(c => (
                            <TouchableOpacity 
                                key={c}
                                onPress={() => canEdit && setColor(c)}
                                style={{ backgroundColor: c }}
                                className={`w-10 h-10 rounded-xl border-2 ${color === c ? 'border-white' : 'border-transparent'} shadow-sm transition-all`}
                            />
                            ))}
                        </View>
                    </View>

                    {/* Right Pane: Permissions */}
                    <View className="flex-[1.5] min-w-[400px]">
                        <Text className="text-brand-primary text-[10px] font-black uppercase mb-6 tracking-widest px-1">Functional Gates</Text>
                        <View className="gap-8">
                            {categories.map(cat => (
                                <View key={cat}>
                                    <View className="flex-row items-center mb-5 ml-1">
                                        <View className="w-1.5 h-1.5 rounded-full bg-brand-primary mr-3" />
                                        <Text className="text-typography-main text-[11px] font-black uppercase tracking-widest">{cat}</Text>
                                    </View>
                                    <View className="gap-3">
                                        {permissions.filter(p => p.category === cat).map(perm => {
                                            const isActive = selectedPerms.includes(perm.id);
                                            return (
                                                <TouchableOpacity
                                                    key={perm.id}
                                                    onPress={() => canEdit && setSelectedPerms(prev => isActive ? prev.filter(id => id !== perm.id) : [...prev, perm.id])}
                                                    className={`flex-row items-center justify-between p-5 rounded-2xl border transition-all ${
                                                        isActive ? 'bg-brand-primary/5 border-brand-primary/40' : 'bg-surface-background/30 border-surface-border'
                                                    } ${!canEdit ? 'opacity-70' : ''}`}
                                                >
                                                    <View className="flex-1 mr-6">
                                                        <Text className={`font-black text-xs uppercase tracking-tight ${isActive ? 'text-typography-main' : 'text-typography-muted'}`}>{perm.label}</Text>
                                                        <Text className="text-typography-dim text-[10px] mt-1 font-bold leading-4">{perm.description || '(no documentation)'}</Text>
                                                    </View>
                                                    <View className={`w-6 h-6 rounded-full items-center justify-center border transition-all ${isActive ? 'bg-brand-primary border-brand-primary' : 'border-surface-border'}`}>
                                                        {isActive && <FontAwesome name="check" size={10} color="white" />}
                                                    </View>
                                                </TouchableOpacity>
                                            );
                                        })}
                                    </View>
                                </View>
                            ))}
                        </View>
                    </View>
                </View>
             </ScrollView>

             <View className="flex-row gap-6 mt-10">
               <TouchableOpacity
                 onPress={() => { setEditingRole(null); setIsCreating(false); }}
                 className="flex-1 bg-surface-background py-5 rounded-xl border border-surface-border items-center"
               >
                 <Text className="text-typography-muted font-black text-[11px] uppercase tracking-widest">Discard Schema</Text>
               </TouchableOpacity>
               {canEdit && (
                 <TouchableOpacity
                   onPress={handleSave}
                   disabled={loading}
                   className="flex-[2] bg-brand-primary py-5 rounded-xl items-center premium-shadow active:scale-[0.98]"
                 >
                   <Text className="text-white font-black text-[11px] uppercase tracking-[0.3em]">Commit Authority Registry</Text>
                 </TouchableOpacity>
               )}
             </View>

          </View>
        </View>
      </Modal>
    </View>
  );
}
