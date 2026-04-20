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

  const handleSave = async () => {
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
    if (role.is_system) return Alert.alert('Operation Blocked', 'System roles cannot be deleted.');
    
    Alert.alert(
      'Confirm Deletion',
      `Are you sure you want to delete the role "${role.name}"? This will revoke it from all users and teams.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Delete', 
          style: 'destructive', 
          onPress: async () => {
            await deleteRole(role.id);
          } 
        }
      ]
    );
  };

  const categories = Array.from(new Set(permissions.map(p => p.category)));

  return (
    <View className="flex-1">
      <ScrollView showsVerticalScrollIndicator={false} className="px-1">
        <View className="flex-row items-center justify-between mb-8">
          <View>
            <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.2em] mb-1">Structural Paradigms</Text>
            <Text className="text-typography-main text-xl font-black tracking-tight">Role Registry</Text>
          </View>
          <TouchableOpacity 
            onPress={handleStartCreate}
            className="bg-brand-primary px-6 py-4 rounded-2xl premium-shadow active:scale-[0.98] transition-transform"
          >
            <Text className="text-typography-main font-black text-[10px] uppercase tracking-[0.15em]">Forge Role</Text>
          </TouchableOpacity>
        </View>

        <View className="gap-4 pb-24">
          {roles.map(role => (
            <TouchableOpacity
              key={role.id}
              onPress={() => handleEditRole(role)}
              className="bg-surface-card p-6 rounded-[28px] border border-surface-border premium-shadow active:scale-[0.98] transition-transform"
            >
              <View className="flex-row items-center justify-between mb-4">
                <View className="flex-row items-center flex-1">
                  <View 
                    style={{ backgroundColor: role.color || 'rgb(var(--brand-primary))' }}
                    className="w-4 h-4 rounded-full mr-3 border border-surface-border/30 shadow-sm"
                  />
                  <Text className="text-typography-main font-black text-lg">{role.name}</Text>
                  {role.is_system && (
                    <View className="bg-brand-accent-dim px-2.5 py-1 rounded-lg ml-3 border border-brand-accent/20">
                      <Text className="text-brand-accent text-[8px] font-black uppercase tracking-widest">System Architecture</Text>
                    </View>
                  )}
                </View>
                {!role.is_system && (
                  <TouchableOpacity 
                    onPress={(e) => {
                      e.stopPropagation();
                      handleDelete(role);
                    }} 
                    className="w-10 h-10 items-center justify-center border border-state-danger/20 rounded-xl bg-state-danger-dim"
                  >
                    <FontAwesome name="trash-o" size={14} color="rgb(var(--state-danger))" />
                  </TouchableOpacity>
                )}
              </View>
              <Text className="text-typography-muted text-xs mb-5 leading-5" numberOfLines={2}>
                {role.description || 'No specific operational mandate provided for this authority node.'}
              </Text>
                  <View className="flex-row items-center gap-2">
                     <View className="bg-brand-primary-dim px-4 py-2 rounded-xl border border-brand-primary/20 flex-row items-center">
                        <FontAwesome name="key" size={8} color="rgb(var(--brand-primary))" />
                        <Text className="text-brand-primary text-[9px] font-black uppercase tracking-[0.1em] ml-2">
                          {role.permissionIds?.length || 0} Permissions Gated
                        </Text>
                     </View>
                  </View>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* Editor Modal */}
      <Modal visible={!!editingRole || isCreating} transparent animationType="slide">
        <View className="flex-1 bg-black/85 justify-end">
          <View className="bg-surface-card w-full rounded-t-[56px] border-t border-surface-border p-8 pb-12 premium-shadow h-[92%]">
             <View className="w-16 h-1.5 bg-surface-border/50 rounded-full self-center mb-10" />
             
             <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.25em] mb-2 text-center">Protocol Architect</Text>
             <Text className="text-typography-main text-2xl font-black mb-10 text-center tracking-tight">
                {isCreating ? 'Forge New Authority' : 'Modifying Structure'}
             </Text>

             <ScrollView showsVerticalScrollIndicator={false} className="px-2">
                <View className="mb-10">
                  <Text className="text-typography-label text-[10px] font-black uppercase mb-4 tracking-widest px-1">Identity & Intent</Text>
                  <TextInput
                    value={name}
                    onChangeText={setName}
                    placeholder="Authority Display Name"
                    placeholderTextColor="rgb(var(--text-muted))"
                    className="bg-surface-background border border-surface-border rounded-[20px] px-6 py-5 text-typography-main font-black text-sm mb-4"
                  />
                  <TextInput
                    value={description}
                    onChangeText={setDescription}
                    placeholder="Operational responsibilities and mandates..."
                    placeholderTextColor="rgb(var(--text-muted))"
                    multiline
                    numberOfLines={4}
                    textAlignVertical="top"
                    className="bg-surface-background border border-surface-border rounded-[20px] px-6 py-5 text-typography-main text-sm mb-6 h-28 leading-6"
                  />
                  
                  <View className="flex-row items-center justify-between px-1 mb-4">
                    <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest">Frequency Marker</Text>
                    <Text className="text-brand-primary font-black text-[10px] uppercase tracking-tighter">{color}</Text>
                  </View>
                  <View className="flex-row flex-wrap gap-4 px-1">
                    {['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#475569'].map(c => (
                      <TouchableOpacity 
                        key={c}
                        onPress={() => setColor(c)}
                        style={{ backgroundColor: c }}
                        className={`w-11 h-11 rounded-2xl border-4 ${color === c ? 'border-white' : 'border-black/20'} shadow-sm`}
                      />
                    ))}
                  </View>
                </View>

                <View className="mb-6">
                   <Text className="text-typography-label text-[10px] font-black uppercase mb-6 tracking-widest px-1">Functional Gates</Text>
                   {categories.map(cat => (
                      <View key={cat} className="mb-8">
                        <View className="flex-row items-center mb-4 ml-1">
                          <View className="w-1.5 h-1.5 rounded-full bg-brand-primary mr-3" />
                          <Text className="text-brand-primary text-[11px] font-black uppercase tracking-widest">{cat}</Text>
                        </View>
                        <View className="gap-3">
                          {permissions.filter(p => p.category === cat).map(perm => {
                            const isActive = selectedPerms.includes(perm.id);
                            return (
                              <TouchableOpacity
                                key={perm.id}
                                onPress={() => setSelectedPerms(prev => isActive ? prev.filter(id => id !== perm.id) : [...prev, perm.id])}
                                className={`flex-row items-center justify-between p-5 rounded-[24px] border transition-all ${
                                  isActive ? 'bg-brand-primary-dim border-brand-primary/40' : 'bg-surface-background/50 border-surface-border'
                                }`}
                              >
                                <View className="flex-1 mr-4">
                                  <Text className={`font-black text-xs uppercase tracking-tight ${isActive ? 'text-typography-main' : 'text-typography-muted'}`}>{perm.label}</Text>
                                  <Text className="text-typography-dim text-[10px] mt-1 font-bold">{perm.description || '(no documentation)'}</Text>
                                </View>
                                <View className={`w-6 h-6 rounded-full items-center justify-center border ${isActive ? 'bg-brand-primary border-brand-primary' : 'border-surface-border'}`}>
                                  {isActive && <FontAwesome name="check" size={10} color="rgb(var(--text-main))" />}
                                </View>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      </View>
                   ))}
                </View>
             </ScrollView>

             <View className="flex-row gap-5 mt-6 px-2">
               <TouchableOpacity
                 onPress={() => { setEditingRole(null); setIsCreating(false); }}
                 className="flex-[0.4] bg-surface-background py-5 rounded-[24px] border border-surface-border items-center"
               >
                 <Text className="text-typography-muted font-black text-[10px] uppercase tracking-widest">Abort</Text>
               </TouchableOpacity>
               <TouchableOpacity
                 onPress={handleSave}
                 disabled={loading}
                 className="flex-1 bg-brand-primary py-5 rounded-[24px] items-center premium-shadow active:scale-[0.98]"
               >
                 <Text className="text-typography-main font-black text-[10px] uppercase tracking-[0.25em]">Commit Schema</Text>
               </TouchableOpacity>
             </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
