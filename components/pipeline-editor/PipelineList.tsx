import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, ActivityIndicator } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { usePipelineEditor, Pipeline } from '@/contexts/PipelineEditorContext';
import DeadlockAlert from './DeadlockAlert';

const STAGE_PRESETS = [
  { name: 'PENDING', color: '#64748b', is_initial: true },
  { name: 'IN PROGRESS', color: '#3b82f6' },
  { name: 'REVIEW', color: '#fbbf24', requires_submission: true },
  { name: 'COMPLETED', color: '#22c55e', is_terminal: true, terminal_type: 'success' },
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
  } = usePipelineEditor();

  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [isQuickCreate, setIsQuickCreate] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');

  useEffect(() => {
    refreshPipelines();
  }, []);

  const handleCreate = async () => {
    if (!name.trim()) return;
    const stgs = isQuickCreate
      ? STAGE_PRESETS.map((s, i) => ({ ...s, position: i + 1, is_initial: s.is_initial || false, is_terminal: s.is_terminal || false, requires_submission: s.requires_submission || false }))
      : [{ name: 'START', color: '#64748b', position: 1, is_initial: true, is_terminal: false, requires_submission: false }];
    const trans = isQuickCreate ? TRANSITION_PRESETS : [];

    const id = await createPipeline(name, desc, stgs, trans);
    if (id) {
      setShowCreate(false);
      setName('');
      setDesc('');
    }
  };

  const handleDelete = async (id: string) => {
    const ok = await deletePipeline(id);
    if (ok) setConfirmDelete(null);
  };

  const handleSaveEdit = async (p: Pipeline) => {
    await updatePipeline(p.id, editName || undefined, editDesc || undefined);
    setEditingId(null);
  };

  const handleToggleDefault = async (p: Pipeline) => {
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
        <TouchableOpacity
          onPress={() => setShowCreate(true)}
          className="bg-brand-primary px-5 py-3 rounded-xl active:bg-brand-primary-hover active:scale-95 transition-all"
        >
          <View className="flex-row items-center">
            <FontAwesome name="plus" size={12} color="rgb(var(--text-main))" />
            <Text className="text-typography-main font-bold text-sm ml-2 uppercase tracking-wide">New Pipeline</Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* Error Banner */}
      {error && (
        <View className="bg-state-danger-dim border border-state-danger/30 p-3 rounded-xl mb-4">
          <Text className="text-state-danger text-sm font-bold">{error}</Text>
        </View>
      )}

      <DeadlockAlert />

      {/* Pipeline Cards */}
      <ScrollView showsVerticalScrollIndicator={false}>
        {loading && pipelines.length === 0 ? (
          <View className="py-20 items-center">
            <ActivityIndicator color="rgb(var(--brand-primary))" size="large" />
          </View>
        ) : pipelines.length === 0 ? (
          <View className="py-20 items-center">
            <FontAwesome name="sitemap" size={48} color="#334155" />
            <Text className="text-typography-muted text-lg font-bold mt-4">No Pipelines Yet</Text>
            <Text className="text-typography-dim text-sm mt-2 text-center px-10">
              Create your first workflow pipeline to define how tasks move through stages.
            </Text>
          </View>
        ) : (
          pipelines.map(p => (
            <View key={p.id} className="mb-3">
              {editingId === p.id ? (
                /* Inline Edit Mode */
                <View className="bg-surface-card p-4 rounded-2xl border border-brand-primary/50">
                  <TextInput
                    value={editName}
                    onChangeText={setEditName}
                    placeholder="Pipeline name"
                    placeholderTextColor="#64748b"
                    className="bg-surface-background text-typography-main px-4 py-3 rounded-lg border border-surface-border mb-3 text-base"
                  />
                  <TextInput
                    value={editDesc}
                    onChangeText={setEditDesc}
                    placeholder="Description (optional)"
                    placeholderTextColor="#64748b"
                    className="bg-surface-background text-typography-main px-4 py-3 rounded-lg border border-surface-border mb-4 text-sm"
                    multiline
                  />
                  <View className="flex-row gap-3">
                    <TouchableOpacity
                      onPress={() => setEditingId(null)}
                      className="flex-1 bg-surface-background py-2.5 rounded-xl border border-surface-border items-center"
                    >
                      <Text className="text-typography-muted font-bold text-sm">Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => handleSaveEdit(p)}
                      className="flex-1 bg-brand-primary py-2.5 rounded-xl items-center"
                    >
                      <Text className="text-typography-main font-bold text-sm">Save</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : confirmDelete === p.id ? (
                /* Delete Confirmation */
                <View className="bg-surface-card p-4 rounded-2xl border border-state-danger/50">
                  <Text className="text-typography-main font-bold text-base mb-2">Delete "{p.name}"?</Text>
                  <Text className="text-typography-muted text-sm mb-4">
                    This will soft-delete the pipeline. Active tasks using it will be unaffected.
                  </Text>
                  <View className="flex-row gap-3">
                    <TouchableOpacity
                      onPress={() => setConfirmDelete(null)}
                      className="flex-1 bg-surface-background py-2.5 rounded-xl border border-surface-border items-center"
                    >
                      <Text className="text-typography-muted font-bold text-sm">Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => handleDelete(p.id)}
                      className="flex-1 bg-state-danger py-2.5 rounded-xl items-center"
                    >
                      <Text className="text-white font-bold text-sm">Delete</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                /* Normal Card */
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
                        {p.description || 'No description'}
                      </Text>
                    </View>

                    <View className="flex-row items-center gap-2">
                      {/* Default Toggle */}
                      <TouchableOpacity
                        onPress={(e) => { e.stopPropagation(); handleToggleDefault(p); }}
                        className={`p-2 rounded-lg border ${p.is_default ? 'bg-brand-primary-dim border-brand-primary/30' : 'bg-surface-background border-surface-border'}`}
                      >
                        <FontAwesome name="star" size={12} color={p.is_default ? 'rgb(var(--brand-primary))' : 'rgb(var(--text-dim))'} />
                      </TouchableOpacity>

                      {/* Edit */}
                      <TouchableOpacity
                        onPress={(e) => {
                          e.stopPropagation();
                          setEditingId(p.id);
                          setEditName(p.name);
                          setEditDesc(p.description || '');
                        }}
                        className="p-2 rounded-lg border border-surface-border bg-surface-background"
                      >
                        <FontAwesome name="pencil" size={12} color="#64748b" />
                      </TouchableOpacity>

                      {/* Delete */}
                      <TouchableOpacity
                        onPress={(e) => { e.stopPropagation(); setConfirmDelete(p.id); }}
                        className="p-2 rounded-lg border border-surface-border bg-surface-background"
                      >
                        <FontAwesome name="trash-o" size={12} color="#64748b" />
                      </TouchableOpacity>

                      <FontAwesome name="chevron-right" size={12} color="#475569" />
                    </View>
                  </View>
                </TouchableOpacity>
              )}
            </View>
          ))
        )}
        <View className="h-20" />
      </ScrollView>

      {/* Create Modal */}
      {showCreate && (
        <View className="absolute inset-0 bg-black/60 items-center justify-center px-6" style={{ zIndex: 100 }}>
          <View className="bg-surface-card w-full max-w-lg rounded-3xl border border-surface-border p-6">
            <Text className="text-typography-main font-black text-xl mb-1">Create Pipeline</Text>
            <Text className="text-typography-muted text-sm mb-6">
              Define a new workflow template for your tasks.
            </Text>

            <Text className="text-typography-label text-xs font-bold uppercase tracking-wider mb-2">Name</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="e.g. Client Onboarding"
              placeholderTextColor="#64748b"
              className="bg-surface-background text-typography-main px-4 py-3 rounded-lg border border-surface-border mb-4 text-base"
              autoFocus
            />

            <Text className="text-typography-label text-xs font-bold uppercase tracking-wider mb-2">Description</Text>
            <TextInput
              value={desc}
              onChangeText={setDesc}
              placeholder="What is this pipeline for?"
              placeholderTextColor="#64748b"
              className="bg-surface-background text-typography-main px-4 py-3 rounded-lg border border-surface-border mb-4 text-sm"
              multiline
              numberOfLines={2}
            />

            {/* Quick Create Toggle */}
            <View className="flex-row items-center justify-between mb-6 bg-surface-background p-3 rounded-xl border border-surface-border">
              <View className="flex-1 mr-4">
                <Text className="text-typography-main font-bold text-sm">Quick Setup</Text>
                <Text className="text-typography-muted text-xs">
                  Pre-fills 4 stages (Pending → In Progress → Review → Completed) with transitions
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setIsQuickCreate(!isQuickCreate)}
                className={`w-12 h-7 rounded-full flex-row items-center px-1 ${isQuickCreate ? 'bg-brand-primary justify-end' : 'bg-surface-overlay justify-start'}`}
              >
                <View className="w-5 h-5 rounded-full bg-white" />
              </TouchableOpacity>
            </View>

            {!isQuickCreate && (
              <View className="bg-state-info/10 border border-state-info/30 p-3 rounded-xl mb-4">
                <Text className="text-state-info text-xs font-bold">
                  Empty start — you'll add stages and transitions manually in the editor.
                </Text>
              </View>
            )}

            <View className="flex-row gap-3">
              <TouchableOpacity
                onPress={() => { setShowCreate(false); setName(''); setDesc(''); }}
                className="flex-1 bg-surface-background py-3 rounded-xl border border-surface-border items-center h-12 justify-center"
              >
                <Text className="text-typography-muted font-bold">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleCreate}
                className="flex-1 bg-brand-primary py-3 rounded-xl items-center h-12 justify-center"
                disabled={!name.trim() || loading}
              >
                {loading ? (
                  <ActivityIndicator color="rgb(var(--text-main))" size="small" />
                ) : (
                  <Text className="text-typography-main font-bold">Create</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
