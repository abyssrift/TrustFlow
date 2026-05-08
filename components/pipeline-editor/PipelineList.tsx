import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Platform } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { usePipelineEditor, Pipeline } from '@/contexts/PipelineEditorContext';
import { useAuth } from '@/contexts/AuthContext';
import DeadlockAlert from './DeadlockAlert';
import PipelineSettingsForm from './PipelineSettingsForm';

const STAGE_PRESETS = [
  { name: 'PENDING', color: 'var(--color-text-dim)', is_initial: true },
  { name: 'IN PROGRESS', color: 'var(--color-primary)' },
  { name: 'REVIEW', color: 'var(--color-warning)', requires_submission: true },
  { name: 'COMPLETED', color: 'var(--color-success)', is_terminal: true, terminal_type: 'success' },
];

const TRANSITION_PRESETS = [
  { from_position: 1, to_position: 2, label: 'Start Work' },
  { from_position: 2, to_position: 3, label: 'Submit for Review' },
  { from_position: 3, to_position: 4, label: 'Approve' },
  { from_position: 3, to_position: 2, label: 'Request Revision' },
];

export default function PipelineList() {
  const {
    pipelines, loading, error,
    refreshPipelines, selectPipeline,
    createPipeline, updatePipeline, deletePipeline,
    roles,
  } = usePipelineEditor();
  const { hasPermission, profile } = useAuth();
  const isAdmin = profile?.system_role === 'admin' || profile?.workspace_role === 'admin' || profile?.workspace_role === 'owner';

  const [showCreate, setShowCreate] = useState(false);
  const [isQuickCreate, setIsQuickCreate] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const canEdit = hasPermission('pipeline.edit');

  useEffect(() => {
    refreshPipelines();
  }, []);

  const handleCreate = async (data: any) => {
    if (!canEdit) return;
    const stgs = isQuickCreate
      ? STAGE_PRESETS.map((s, i) => ({ ...s, position: i + 1, is_initial: s.is_initial || false, is_terminal: s.is_terminal || false, requires_submission: s.requires_submission || false }))
      : [{ name: 'START', color: 'var(--color-text-dim)', position: 1, is_initial: true, is_terminal: false, requires_submission: false }];
    const trans = isQuickCreate ? TRANSITION_PRESETS : [];

    const id = await createPipeline(data.name, data.description, stgs, trans, data.visibility_permissions, data.task_visibility_mode);
    if (id) {
      setShowCreate(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!canEdit) return;
    const ok = await deletePipeline(id);
    if (ok) setConfirmDelete(null);
  };

  const handleSaveEdit = async (id: string, data: any) => {
    if (!canEdit) return;
    await updatePipeline(id, data.name, data.description, undefined, data.visibility_permissions, data.task_visibility_mode);
    setEditingId(null);
  };

  const handleToggleDefault = async (p: Pipeline) => {
    if (!canEdit) return;
    await updatePipeline(p.id, undefined, undefined, !p.is_default);
  };

  return (
    <View className="flex-1">
      {/* Header */}
      <View className="flex-row items-center justify-between mb-6">
        <View>
          <Text className="text-typography-main text-2xl font-black">Pipelines</Text>
          <Text className="text-typography-muted text-sm mt-1">
            {pipelines.length} workflow{pipelines.length !== 1 ? 's' : ''} configured
          </Text>
        </View>
        {canEdit && (
          <TouchableOpacity
            onPress={() => setShowCreate(true)}
            className="bg-brand-primary px-5 py-3 rounded-xl active:bg-brand-primary-hover active:scale-95 transition-all"
          >
            <View className="flex-row items-center">
              <FontAwesome name="plus" size={12} className="text-brand-on-primary" />
              <Text className="text-brand-on-primary font-bold text-sm ml-2 uppercase tracking-wide">New Pipeline</Text>
            </View>
          </TouchableOpacity>
        )}
      </View>

      {/* Error Banner */}
      {error && (
        <View className="bg-state-danger/10 border border-state-danger/30 p-3 rounded-xl mb-4">
          <Text className="text-state-danger text-sm font-bold">{error}</Text>
        </View>
      )}

      <DeadlockAlert />

      {/* Pipeline Cards */}
      <ScrollView 
        className="flex-1"
        showsVerticalScrollIndicator={Platform.OS === 'web'}
      >
        {loading && pipelines.length === 0 ? (
          <View className="py-20 items-center">
            <ActivityIndicator color="var(--color-primary)" size="large" />
          </View>
        ) : pipelines.length === 0 ? (
          <View className="py-20 items-center px-6">
            <View className="bg-surface-card w-full p-8 rounded-[32px] border border-surface-border items-center premium-shadow">
              <View className="w-20 h-20 bg-brand-primary/10 rounded-full items-center justify-center mb-6">
                <FontAwesome name="sitemap" size={32} className="text-brand-primary" />
              </View>
              
              {canEdit ? (
                <>
                  <Text className="text-typography-main text-xl font-black mt-2 text-center">No Pipelines Yet</Text>
                  <Text className="text-typography-muted text-sm mt-3 text-center leading-5">
                    Create your first workflow pipeline to define how tasks move through stages.
                  </Text>
                  <TouchableOpacity
                    onPress={() => setShowCreate(true)}
                    className="bg-brand-primary px-8 py-4 rounded-2xl mt-8 active:scale-95 transition-all"
                  >
                    <Text className="text-brand-on-primary font-black uppercase tracking-widest text-xs">Create First Pipeline</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <View className="bg-state-info/10 border border-state-info/20 p-5 rounded-2xl w-full">
                    <View className="flex-row items-start">
                      <FontAwesome name="info-circle" size={16} className="text-state-info" style={{ marginTop: 2 }} />
                      <Text className="text-typography-main text-sm font-bold ml-3 flex-1 leading-5">
                        Either no pipelines exist, or they are hidden due to your permissions. Contact your Admin if this is an error.
                      </Text>
                    </View>
                  </View>
                </>
              )}
            </View>
          </View>
        ) : (
          <>
            {!isAdmin && (
               <View className="bg-surface-overlay/30 px-4 py-2 rounded-lg mb-4 border border-surface-border flex-row items-center">
                  <FontAwesome name="lock" size={10} className="text-typography-muted" />
                  <Text className="text-[10px] text-typography-muted ml-2 italic">
                    Showing only pipelines permitted for your current role.
                  </Text>
               </View>
            )}
            {pipelines.map(p => (
              <View key={p.id} className="mb-3">
                {editingId === p.id ? (
                  <View className="bg-surface-card p-6 rounded-3xl border border-brand-primary/30 premium-shadow">
                    <Text className="text-typography-main font-black text-lg mb-4">Edit Pipeline</Text>
                    <PipelineSettingsForm 
                      initialData={{ ...p, description: p.description ?? undefined }}
                      roles={roles}
                      onSubmit={(data: any) => handleSaveEdit(p.id, data)}
                      onCancel={() => setEditingId(null)}
                      submitLabel="Save Changes"
                      loading={loading}
                    />
                  </View>
                ) : confirmDelete === p.id ? (
                  <View className="bg-surface-card p-6 rounded-3xl border border-state-danger/30 premium-shadow">
                    <Text className="text-typography-main font-black text-lg mb-2">Delete "{p.name}"?</Text>
                    <Text className="text-typography-muted text-sm mb-6 leading-5">
                      This will archive the pipeline. Existing tasks using this pipeline will remain functional but new ones cannot be created.
                    </Text>
                    <View className="flex-row gap-3">
                      <TouchableOpacity
                        onPress={() => setConfirmDelete(null)}
                        className="flex-1 bg-surface-background py-3 rounded-xl border border-surface-border items-center justify-center h-12"
                      >
                        <Text className="text-typography-muted font-bold">Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => handleDelete(p.id)}
                        className="flex-1 bg-state-danger py-3 rounded-xl items-center justify-center h-12"
                      >
                        <Text className="text-brand-on-primary font-bold">Confirm Delete</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <TouchableOpacity
                    onPress={() => selectPipeline(p)}
                    className="bg-surface-card p-6 rounded-[28px] border border-surface-border premium-shadow active:scale-[0.98] transition-transform"
                  >
                    <View className="flex-row items-center justify-between">
                      <View className="flex-1 mr-4">
                        <View className="flex-row items-center mb-1">
                          <Text className="text-typography-main font-bold text-lg">{p.name}</Text>
                          {p.is_default && (
                            <View className="bg-brand-primary/15 px-2 py-0.5 rounded-md ml-2">
                              <Text className="text-brand-primary text-[9px] font-black uppercase">Default</Text>
                            </View>
                          )}
                        </View>
                        <Text className="text-typography-muted text-sm" numberOfLines={1}>
                          {p.description || 'No description provided'}
                        </Text>
                        
                        <View className="flex-row items-center mt-3 gap-3">
                           <View className="flex-row items-center">
                              <FontAwesome name="eye" size={10} className="text-typography-muted" />
                              <Text className="text-[10px] text-typography-muted ml-1.5">
                                 {p.visibility_permissions?.length || 0} Roles
                              </Text>
                           </View>
                           <View className="flex-row items-center">
                              <FontAwesome name="lock" size={10} className="text-typography-muted" />
                              <Text className="text-[10px] text-typography-muted ml-1.5 capitalize">
                                 {p.task_visibility_mode === 'assigned_only' ? 'Private Tasks' : 'Public Tasks'}
                              </Text>
                           </View>
                        </View>
                      </View>

                      <View className="flex-row items-center gap-2">
                        {canEdit && (
                          <>
                            <TouchableOpacity
                              onPress={(e: any) => { e.stopPropagation(); handleToggleDefault(p); }}
                              className={`p-2.5 rounded-xl border ${p.is_default ? 'bg-brand-primary border-brand-primary' : 'bg-surface-background border-surface-border'}`}
                            >
                              <FontAwesome name="star" size={12} className={p.is_default ? 'text-brand-on-primary' : 'text-typography-muted'} />
                            </TouchableOpacity>

                            <TouchableOpacity
                              onPress={(e: any) => {
                                e.stopPropagation();
                                setEditingId(p.id);
                              }}
                              className="p-2.5 rounded-xl border border-surface-border bg-surface-background"
                            >
                              <FontAwesome name="pencil" size={12} className="text-typography-muted" />
                            </TouchableOpacity>

                            <TouchableOpacity
                              onPress={(e: any) => { e.stopPropagation(); setConfirmDelete(p.id); }}
                              className="p-2.5 rounded-xl border border-surface-border bg-surface-background"
                            >
                              <FontAwesome name="trash-o" size={12} className="text-typography-muted" />
                            </TouchableOpacity>
                          </>
                        )}
                        <View className="ml-2">
                          <FontAwesome name="chevron-right" size={12} className="text-typography-muted" />
                        </View>
                      </View>
                    </View>
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </>
        )}
        <View className="h-20" />
      </ScrollView>

      {/* Create Modal */}
      {showCreate && (
        <View className="absolute inset-0 bg-black/70 items-center justify-center px-6" style={{ zIndex: 1000 }}>
          <View className="bg-surface-card w-full max-w-lg rounded-[32px] border border-surface-border p-8 premium-shadow">
            <Text className="text-typography-main font-black text-2xl mb-2">New Pipeline</Text>
            <Text className="text-typography-muted text-sm mb-6 leading-5">
              Design a workflow template. You can use our presets to get started faster.
            </Text>

            <ScrollView showsVerticalScrollIndicator={false} className="max-h-[70vh]">
               {/* Quick Create Toggle */}
               <TouchableOpacity 
                  onPress={() => setIsQuickCreate(!isQuickCreate)}
                  className={`flex-row items-center p-4 rounded-2xl border mb-6 ${isQuickCreate ? 'bg-brand-primary/5 border-brand-primary/30' : 'bg-surface-background border-surface-border'}`}
               >
                  <View className="flex-1 mr-4">
                     <Text className={`font-bold text-sm ${isQuickCreate ? 'text-brand-primary' : 'text-typography-main'}`}>Quick Setup (Recommended)</Text>
                     <Text className="text-typography-muted text-[11px] mt-1 leading-4">
                        Auto-generate 4 standard stages and basic transitions.
                     </Text>
                  </View>
                  <View className={`w-12 h-7 rounded-full flex-row items-center px-1 ${isQuickCreate ? 'bg-brand-primary justify-end' : 'bg-surface-overlay justify-start'}`}>
                     <View className="w-5 h-5 rounded-full bg-brand-on-primary shadow-sm" />
                  </View>
               </TouchableOpacity>

               <PipelineSettingsForm 
                  roles={roles}
                  onSubmit={handleCreate}
                  onCancel={() => { setShowCreate(false); setIsQuickCreate(true); }}
                  submitLabel="Create Pipeline"
                  loading={loading}
                />
            </ScrollView>
          </View>
        </View>
      )}
    </View>
  );
}
