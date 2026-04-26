import React, { useState, useMemo } from 'react';
import { View, Text, TouchableOpacity, TextInput, ScrollView, ActivityIndicator } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { Permission } from '@/contexts/PipelineEditorContext';

type PipelineFormData = {
  name: string;
  description: string | null;
  visibility_permissions: string[];
  task_visibility_mode: 'all' | 'assigned_only';
};

type Props = {
  initialData?: Partial<PipelineFormData>;
  permissions: Permission[];
  onSubmit: (data: PipelineFormData) => Promise<void>;
  onCancel: () => void;
  submitLabel: string;
  loading?: boolean;
  onDelete?: () => Promise<void>;
};

export default function PipelineSettingsForm({ 
  initialData, 
  permissions, 
  onSubmit, 
  onCancel, 
  submitLabel,
  loading,
  onDelete
}: Props) {
  const [name, setName] = useState(initialData?.name || '');
  const [desc, setDesc] = useState(initialData?.description || '');
  const [selectedPerms, setSelectedPerms] = useState<string[]>(initialData?.visibility_permissions || []);
  const [taskVisibilityMode, setTaskVisibilityMode] = useState<'all' | 'assigned_only'>(initialData?.task_visibility_mode || 'all');
  const [searchTerm, setSearchTerm] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleting, setDeleting] = useState(false);

  const filteredPermissions = useMemo(() => {
    if (!searchTerm) return permissions;
    return permissions.filter(p => 
      p.label.toLowerCase().includes(searchTerm.toLowerCase()) || 
      p.key.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [permissions, searchTerm]);

  const togglePermission = (key: string) => {
    setSelectedPerms(prev => 
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const handleApply = () => {
    if (!name.trim()) return;
    onSubmit({
      name: name.trim(),
      description: desc,
      visibility_permissions: selectedPerms,
      task_visibility_mode: taskVisibilityMode
    });
  };

  const handleDelete = async () => {
    if (deleteInput !== name) return;
    setDeleting(true);
    try {
      await onDelete?.();
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  return (
    <View className="gap-5">
      {/* Basic Info */}
      <View>
        <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-2 ml-1">Identity</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Pipeline Name"
          placeholderTextColor="rgb(var(--text-dim))"
          className="bg-surface-background border border-surface-border rounded-xl px-4 py-3 text-typography-main font-bold"
        />
      </View>

      <View>
        <TextInput
          value={desc}
          onChangeText={setDesc}
          placeholder="Description (optional)"
          placeholderTextColor="rgb(var(--text-dim))"
          className="bg-surface-background border border-surface-border rounded-xl px-4 py-3 text-typography-main text-sm"
          multiline
          numberOfLines={2}
        />
      </View>

      {/* Visibility Section */}
      <View className="bg-surface-overlay/50 p-4 rounded-2xl border border-surface-border">
        <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-4">Security & Visibility</Text>
        
        {/* Permission Picker with Search */}
        <View className="mb-4">
          <View className="flex-row items-center justify-between mb-2 px-1">
            <Text className="text-typography-main font-bold text-xs">Access Permissions</Text>
            <Text className="text-typography-muted text-[10px]">{selectedPerms.length} selected</Text>
          </View>
          
          <View className="relative mb-3">
            <View className="absolute left-3 top-2.5 z-10">
              <FontAwesome name="search" size={10} color="rgb(var(--text-dim))" />
            </View>
            <TextInput
              value={searchTerm}
              onChangeText={setSearchTerm}
              placeholder="Search permissions..."
              placeholderTextColor="rgb(var(--text-dim))"
              className="bg-surface-background border border-surface-border rounded-lg pl-8 pr-3 py-2 text-[11px] text-typography-main"
            />
          </View>

          <View className="max-h-40 bg-surface-background rounded-xl border border-surface-border overflow-hidden">
            <ScrollView nestedScrollEnabled className="p-2">
              <View className="flex-row flex-wrap gap-2">
                {filteredPermissions.length === 0 ? (
                  <Text className="text-typography-muted text-[10px] italic p-2">No matching permissions</Text>
                ) : (
                  filteredPermissions.map(p => {
                    const isSelected = selectedPerms.includes(p.key);
                    return (
                      <TouchableOpacity
                        key={p.key}
                        onPress={() => togglePermission(p.key)}
                        className={`px-3 py-1.5 rounded-lg border flex-row items-center ${
                          isSelected ? 'bg-brand-primary border-brand-primary' : 'bg-surface-card border-surface-border'
                        }`}
                      >
                        {isSelected && <FontAwesome name="check" size={8} color="white" style={{ marginRight: 6 }} />}
                        <Text className={`text-[10px] font-bold ${isSelected ? 'text-white' : 'text-typography-main'}`}>
                          {p.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })
                )}
              </View>
            </ScrollView>
          </View>
          {selectedPerms.length > 0 && (
             <TouchableOpacity onPress={() => setSelectedPerms([])} className="mt-2 self-end px-2 py-1">
                <Text className="text-brand-primary text-[9px] font-black uppercase tracking-tighter">Clear Selection</Text>
             </TouchableOpacity>
          )}
        </View>

        {/* Task Visibility Toggle */}
        <View>
          <Text className="text-typography-main font-bold text-xs mb-3 px-1">Task Visibility Mode</Text>
          <View className="flex-row gap-2">
            <TouchableOpacity 
              onPress={() => setTaskVisibilityMode('all')}
              className={`flex-1 py-2.5 rounded-xl border items-center flex-row justify-center gap-2 ${
                taskVisibilityMode === 'all' ? 'bg-brand-primary border-brand-primary' : 'bg-surface-background border-surface-border'
              }`}
            >
              <FontAwesome name="globe" size={10} color={taskVisibilityMode === 'all' ? 'white' : 'rgb(var(--text-muted))'} />
              <Text className={`text-[10px] font-black uppercase tracking-tighter ${taskVisibilityMode === 'all' ? 'text-white' : 'text-typography-muted'}`}>
                All Tasks
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              onPress={() => setTaskVisibilityMode('assigned_only')}
              className={`flex-1 py-2.5 rounded-xl border items-center flex-row justify-center gap-2 ${
                taskVisibilityMode === 'assigned_only' ? 'bg-brand-primary border-brand-primary' : 'bg-surface-background border-surface-border'
              }`}
            >
              <FontAwesome name="user-secret" size={10} color={taskVisibilityMode === 'assigned_only' ? 'white' : 'rgb(var(--text-muted))'} />
              <Text className={`text-[10px] font-black uppercase tracking-tighter ${taskVisibilityMode === 'assigned_only' ? 'text-white' : 'text-typography-muted'}`}>
                Assigned Only
              </Text>
            </TouchableOpacity>
          </View>
          <Text className="text-typography-muted text-[9px] mt-2 ml-1 leading-3 italic">
            {taskVisibilityMode === 'all' 
              ? 'Members can see all tasks in this pipeline.' 
              : 'Members only see tasks assigned to them or their team.'}
          </Text>
        </View>
      </View>

      {/* Danger Zone */}
      {onDelete && (
        <View className="mt-8 pt-8 border-t border-surface-border">
          <Text className="text-state-danger text-[10px] font-black uppercase tracking-widest mb-4 ml-1">Danger Zone</Text>
          
          <View className="bg-state-danger/5 border border-state-danger/20 p-6 rounded-2xl">
            <View className="flex-row items-center justify-between mb-4">
              <View className="flex-1 mr-4">
                <Text className="text-typography-main font-bold text-sm">Delete Pipeline</Text>
                <Text className="text-typography-muted text-[10px] mt-1 leading-4">
                  Permanently remove this pipeline and all its associated stages, transitions, and automations. This action cannot be undone.
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setShowDeleteConfirm(true)}
                className="bg-state-danger px-4 py-2 rounded-xl active:scale-95 transition-all"
              >
                <Text className="text-white font-black uppercase tracking-widest text-[10px]">Delete</Text>
              </TouchableOpacity>
            </View>

            {showDeleteConfirm && (
              <View className="mt-4 p-4 bg-surface-card rounded-xl border border-state-danger/30">
                <Text className="text-typography-main font-bold text-xs mb-3">
                  Please type <Text className="text-state-danger">"{name}"</Text> to confirm:
                </Text>
                <TextInput
                  value={deleteInput}
                  onChangeText={setDeleteInput}
                  placeholder="Type pipeline name..."
                  placeholderTextColor="rgba(var(--text-dim), 0.5)"
                  className="bg-surface-background border border-surface-border rounded-lg px-3 py-2 text-xs text-typography-main mb-3"
                />
                <View className="flex-row gap-2">
                  <TouchableOpacity
                    onPress={() => {
                      setShowDeleteConfirm(false);
                      setDeleteInput('');
                    }}
                    className="flex-1 bg-surface-background py-2 rounded-lg border border-surface-border items-center"
                  >
                    <Text className="text-typography-muted font-bold text-[10px] uppercase">Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleDelete}
                    disabled={deleteInput !== name || deleting}
                    className={`flex-1 py-2 rounded-lg items-center ${
                      deleteInput !== name || deleting ? 'bg-state-danger/30' : 'bg-state-danger'
                    }`}
                  >
                    {deleting ? (
                      <ActivityIndicator size="small" color="white" />
                    ) : (
                      <Text className="text-white font-black text-[10px] uppercase">Confirm Delete</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        </View>
      )}

      {/* Footer Actions */}
      <View className="flex-row gap-3 pt-4 mb-10">
        <TouchableOpacity
          onPress={onCancel}
          className="flex-1 bg-surface-background py-3 rounded-xl border border-surface-border items-center justify-center h-12"
        >
          <Text className="text-typography-muted font-bold text-sm uppercase tracking-widest">Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleApply}
          disabled={!name.trim() || loading}
          className={`flex-1 py-3 rounded-xl items-center justify-center h-12 premium-shadow ${
            !name.trim() || loading ? 'bg-surface-overlay opacity-50' : 'bg-brand-primary'
          }`}
        >
          {loading ? (
            <ActivityIndicator color="white" size="small" />
          ) : (
            <Text className="text-white font-black uppercase tracking-widest text-sm">{submitLabel}</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}
