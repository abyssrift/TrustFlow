import React, { useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { usePipelineEditor } from '@/contexts/PipelineEditorContext';

export default function TransitionEditor() {
  const {
    stages, transitions, permissions, loading, error,
    addTransition, updateTransition, deleteTransition,
  } = usePipelineEditor();

  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Form state
  const [formFrom, setFormFrom] = useState('');
  const [formTo, setFormTo] = useState('');
  const [formLabel, setFormLabel] = useState('');
  const [formPerm, setFormPerm] = useState('');
  const [formType, setFormType] = useState('neutral');
  const [showPermPicker, setShowPermPicker] = useState(false);

  const resetForm = () => {
    setFormFrom('');
    setFormTo('');
    setFormLabel('');
    setFormPerm('');
    setFormType('neutral');
    setShowPermPicker(false);
  };

  const stageName = (id: string) => stages.find(s => s.id === id)?.name || '—';
  const stageColor = (id: string) => stages.find(s => s.id === id)?.color || 'var(--color-text-dim)';

  // DB stores 'revision'/'failure'; UI buttons use 'warning'/'danger'
  const toUiType = (dbType: string | null): string => {
    if (dbType === 'revision') return 'warning';
    if (dbType === 'failure')  return 'danger';
    return dbType || 'neutral';
  };

  const TYPE_DISPLAY: Record<string, { icon: string; color: string }> = {
    success:  { icon: 'check-circle',       color: 'var(--color-success)' },
    warning:  { icon: 'exclamation-circle', color: 'var(--color-warning)' },
    revision: { icon: 'exclamation-circle', color: 'var(--color-warning)' },
    danger:   { icon: 'times-circle',       color: 'var(--color-danger)' },
    failure:  { icon: 'times-circle',       color: 'var(--color-danger)' },
  };

  const handleAdd = async () => {
    if (!formFrom || !formTo || !formLabel.trim()) return;
    await addTransition(formFrom, formTo, formLabel.trim(), formPerm || undefined, formType);
    resetForm();
    setShowAdd(false);
  };

  const handleUpdate = async (id: string) => {
    await updateTransition(id, formLabel.trim() || undefined, formPerm, formType);
    setEditingId(null);
    resetForm();
  };

  const handleDelete = async (id: string) => {
    await deleteTransition(id);
    setConfirmDeleteId(null);
  };

  // Group transitions by from_stage for visual clarity
  const groupedByFromStage = stages.map(s => ({
    stage: s,
    transitions: transitions.filter(t => t.from_stage_id === s.id),
  })).filter(g => g.transitions.length > 0);

  // Stages with NO outgoing transitions (potentially disconnected)
  const disconnectedStages = stages.filter(
    s => !s.is_terminal && !transitions.some(t => t.from_stage_id === s.id)
  );

  return (
    <View className="flex-1 p-8">
      <View className="flex-row items-center justify-between mb-4">
        <View>
          <Text className="text-typography-main text-lg font-black">Transitions</Text>
          <Text className="text-typography-muted text-xs">{transitions.length} rule{transitions.length !== 1 ? 's' : ''} defined</Text>
        </View>
        {!showAdd && (
          <TouchableOpacity
            onPress={() => { resetForm(); setShowAdd(true); }}
            className="bg-brand-primary-dim px-4 py-2 rounded-sm border border-brand-primary/20 active:bg-brand-primary-dim active:scale-95 transition-all"
          >
            <View className="flex-row items-center">
              <FontAwesome name="plus" size={10} color="rgb(var(--brand-primary))" />
              <Text className="text-brand-primary font-bold text-xs ml-2 uppercase tracking-wide">Add Rule</Text>
            </View>
          </TouchableOpacity>
        )}
      </View>

      {error && (
        <View className="bg-state-danger/10 border border-state-danger/30 p-3 rounded-xl mb-3">
          <Text className="text-state-danger text-sm font-bold">{error}</Text>
        </View>
      )}

      {/* Disconnected Warning */}
      {disconnectedStages.length > 0 && (
        <View className="bg-state-warning-dim border border-state-warning/20 p-3 rounded-xl mb-4">
          <View className="flex-row items-center mb-1">
            <FontAwesome name="exclamation-triangle" size={12} color="rgb(var(--state-warning))" />
            <Text className="text-state-warning text-xs font-bold ml-2 uppercase tracking-wide">Disconnected Stages</Text>
          </View>
          <Text className="text-typography-muted text-xs leading-4">
            {disconnectedStages.map(s => s.name).join(', ')} have no outgoing transitions and are not terminal stages.
          </Text>
        </View>
      )}

      <ScrollView 
        className="flex-1"
        showsVerticalScrollIndicator={Platform.OS === 'web'}
      >
        {/* Add Form */}
        {showAdd && (
          <View className="bg-surface-card p-4 rounded-2xl border border-brand-primary/40 mb-4">
            <Text className="text-typography-main font-bold text-base mb-4">New Transition</Text>

            {/* From Stage */}
            <Text className="text-typography-label text-[10px] font-bold uppercase tracking-wider mb-2">From Stage</Text>
            <View className="flex-row flex-wrap gap-2 mb-3">
              {stages.filter(s => !s.is_terminal).map(s => (
                <TouchableOpacity
                  key={s.id}
                  onPress={() => setFormFrom(s.id)}
                  className={`px-3 py-2 rounded-lg border ${formFrom === s.id ? 'border-brand-primary/40 bg-brand-primary-dim' : 'border-surface-border bg-surface-background'}`}
                >
                  <View className="flex-row items-center">
                    <View className="w-2 h-2 rounded-full mr-2" style={{ backgroundColor: s.color || 'var(--color-text-dim)' }} />
                    <Text className={`text-xs font-bold ${formFrom === s.id ? 'text-brand-primary' : 'text-typography-muted'}`}>
                      {s.name}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>

            {/* To Stage */}
            <Text className="text-typography-label text-[10px] font-bold uppercase tracking-wider mb-2">To Stage</Text>
            <View className="flex-row flex-wrap gap-2 mb-3">
              {stages.filter(s => s.id !== formFrom).map(s => (
                <TouchableOpacity
                  key={s.id}
                  onPress={() => setFormTo(s.id)}
                  className={`px-3 py-2 rounded-lg border ${formTo === s.id ? 'border-brand-primary/40 bg-brand-primary-dim' : 'border-surface-border bg-surface-background'}`}
                >
                  <View className="flex-row items-center">
                    <View className="w-2 h-2 rounded-full mr-2" style={{ backgroundColor: s.color || '#6B7280' }} />
                    <Text className={`text-xs font-bold ${formTo === s.id ? 'text-brand-primary' : 'text-typography-muted'}`}>
                      {s.name}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>

            {/* Label */}
            <Text className="text-typography-label text-[10px] font-bold uppercase tracking-wider mb-1.5">Action Label</Text>
            <TextInput
              value={formLabel}
              onChangeText={setFormLabel}
              placeholder="e.g. Approve, Reject, Start Work"
              placeholderTextColor="var(--color-text-dim)"
              className="bg-surface-background text-typography-main px-4 py-2.5 rounded-lg border border-surface-border mb-3"
            />

            {/* Permission */}
            <Text className="text-typography-label text-[10px] font-bold uppercase tracking-wider mb-1.5">
              Required Permission <Text className="text-typography-dim">(optional)</Text>
            </Text>
            <TouchableOpacity
              onPress={() => setShowPermPicker(!showPermPicker)}
              className="bg-surface-background px-4 py-2.5 rounded-lg border border-surface-border mb-1 flex-row items-center justify-between"
            >
              <Text className={`text-sm ${formPerm ? 'text-typography-main font-bold' : 'text-typography-dim'}`}>
                {formPerm ? permissions.find(p => p.key === formPerm)?.label || formPerm : 'Anyone can trigger'}
              </Text>
              <FontAwesome name={showPermPicker ? 'chevron-up' : 'chevron-down'} size={10} color="#64748b" />
            </TouchableOpacity>
            {showPermPicker && (
              <View className="bg-surface-background border border-surface-border rounded-lg mb-3 max-h-40">
                <ScrollView>
                  <TouchableOpacity
                    onPress={() => { setFormPerm(''); setShowPermPicker(false); }}
                    className="px-4 py-2.5 border-b border-surface-border"
                  >
                    <Text className="text-typography-muted text-sm italic">No restriction (anyone)</Text>
                  </TouchableOpacity>
                  {permissions.map(p => (
                    <TouchableOpacity
                      key={p.key}
                      onPress={() => { setFormPerm(p.key); setShowPermPicker(false); }}
                      className={`px-4 py-2.5 border-b border-surface-border ${formPerm === p.key ? 'bg-brand-primary/10' : ''}`}
                    >
                      <Text className="text-typography-main text-sm font-medium">{p.label}</Text>
                      <Text className="text-typography-dim text-[10px]">{p.key}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}

            {/* Transition Type */}
            <Text className="text-typography-label text-[10px] font-bold uppercase tracking-wider mb-2 mt-2">Visual Style</Text>
            <View className="flex-row gap-2 mb-4">
              {[
                { id: 'neutral', icon: 'circle-o', color: 'var(--color-text-dim)' },
                { id: 'success', icon: 'check-circle', color: 'var(--color-success)' },
                { id: 'warning', icon: 'exclamation-circle', color: 'var(--color-warning)' },
                { id: 'danger', icon: 'times-circle', color: 'var(--color-danger)' }
              ].map(t => (
                <TouchableOpacity
                  key={t.id}
                  onPress={() => setFormType(t.id)}
                  className={`flex-1 p-2 rounded-lg border items-center justify-center ${formType === t.id ? 'border-brand-primary bg-brand-primary/10' : 'border-surface-border bg-surface-background'}`}
                >
                  <FontAwesome name={t.icon as any} size={12} color={t.color} />
                  <Text className={`text-[9px] font-bold mt-1 capitalize ${formType === t.id ? 'text-brand-primary' : 'text-typography-dim'}`}>
                    {t.id}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Actions */}
            <View className="flex-row gap-3 mt-2">
              <TouchableOpacity
                onPress={() => { setShowAdd(false); resetForm(); }}
                className="flex-1 bg-surface-background py-2.5 rounded-xl border border-surface-border items-center"
              >
                <Text className="text-typography-muted font-bold text-sm">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleAdd}
                className="flex-1 bg-brand-primary py-3 rounded-sm items-center h-12 justify-center"
                disabled={!formFrom || !formTo || !formLabel.trim() || loading}
              >
                {loading ? (
                  <ActivityIndicator color="rgb(var(--text-main))" size="small" />
                ) : (
                  <Text className="text-typography-main font-black text-sm uppercase tracking-wide">Add Rule</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Grouped Transitions */}
        {groupedByFromStage.map(({ stage, transitions: trans }) => (
          <View key={stage.id} className="mb-4">
            <View className="flex-row items-center mb-2">
              <View className="w-2.5 h-2.5 rounded-full mr-2" style={{ backgroundColor: stage.color || 'var(--color-text-dim)' }} />
              <Text className="text-typography-label text-xs font-bold uppercase tracking-wider">
                From {stage.name}
              </Text>
            </View>

            {trans.map(t => (
              <View key={t.id}>
                {editingId === t.id ? (
                  /* Edit inline */
                  <View className="bg-surface-card p-4 rounded-2xl border border-brand-primary/40 mb-2 ml-4">
                    <Text className="text-typography-label text-[10px] font-bold uppercase tracking-wider mb-1.5">Label</Text>
                    <TextInput
                      value={formLabel}
                      onChangeText={setFormLabel}
                      className="bg-surface-background text-typography-main px-4 py-2.5 rounded-lg border border-surface-border mb-3"
                    />

                    <Text className="text-typography-label text-[10px] font-bold uppercase tracking-wider mb-1.5">
                      Required Permission <Text className="text-typography-dim">(optional)</Text>
                    </Text>
                    <TouchableOpacity
                      onPress={() => setShowPermPicker(!showPermPicker)}
                      className="bg-surface-background px-4 py-2.5 rounded-lg border border-surface-border mb-1 flex-row items-center justify-between"
                    >
                      <Text className={`text-sm ${formPerm ? 'text-typography-main font-bold' : 'text-typography-dim'}`}>
                        {formPerm ? permissions.find(p => p.key === formPerm)?.label || formPerm : 'Anyone can trigger'}
                      </Text>
                      <FontAwesome name={showPermPicker ? 'chevron-up' : 'chevron-down'} size={10} color="var(--color-text-dim)" />
                    </TouchableOpacity>
                    {showPermPicker && (
                      <View className="bg-surface-background border border-surface-border rounded-lg mb-3 max-h-40">
                        <ScrollView>
                          <TouchableOpacity
                            onPress={() => { setFormPerm(''); setShowPermPicker(false); }}
                            className="px-4 py-2.5 border-b border-surface-border"
                          >
                            <Text className="text-typography-muted text-sm italic">No restriction (anyone)</Text>
                          </TouchableOpacity>
                          {permissions.map(p => (
                            <TouchableOpacity
                              key={p.key}
                              onPress={() => { setFormPerm(p.key); setShowPermPicker(false); }}
                              className={`px-4 py-2.5 border-b border-surface-border ${formPerm === p.key ? 'bg-brand-primary/10' : ''}`}
                            >
                              <Text className="text-typography-main text-sm font-medium">{p.label}</Text>
                              <Text className="text-typography-dim text-[10px]">{p.key}</Text>
                            </TouchableOpacity>
                          ))}
                        </ScrollView>
                      </View>
                    )}

                    <Text className="text-typography-label text-[10px] font-bold uppercase tracking-wider mb-2 mt-1">Visual Style</Text>
                    <View className="flex-row gap-2 mb-4">
                      {[
                        { id: 'neutral', icon: 'circle-o', color: 'var(--color-text-dim)' },
                        { id: 'success', icon: 'check-circle', color: 'var(--color-success)' },
                        { id: 'warning', icon: 'exclamation-circle', color: 'var(--color-warning)' },
                        { id: 'danger', icon: 'times-circle', color: 'var(--color-danger)' }
                      ].map(ty => (
                        <TouchableOpacity
                          key={ty.id}
                          onPress={() => setFormType(ty.id)}
                          className={`flex-1 p-2 rounded-lg border items-center justify-center ${formType === ty.id ? 'border-brand-primary bg-brand-primary/10' : 'border-surface-border bg-surface-background'}`}
                        >
                          <FontAwesome name={ty.icon as any} size={12} color={ty.color} />
                          <Text className={`text-[9px] font-bold mt-1 capitalize ${formType === ty.id ? 'text-brand-primary' : 'text-typography-dim'}`}>
                            {ty.id}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>

                    <View className="flex-row gap-3">
                      <TouchableOpacity
                        onPress={() => { setEditingId(null); resetForm(); }}
                        className="flex-1 bg-surface-background py-2 rounded-xl border border-surface-border items-center"
                      >
                        <Text className="text-typography-muted font-bold text-sm">Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => handleUpdate(t.id)}
                        className="flex-1 bg-brand-primary py-2 rounded-xl items-center"
                        disabled={loading}
                      >
                        {loading ? <ActivityIndicator size="small" color="rgb(var(--text-main))" /> : <Text className="text-typography-main font-bold text-sm">Save</Text>}
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : confirmDeleteId === t.id ? (
                  /* Confirm delete */
                  <View className="bg-surface-card p-3 rounded-2xl border border-state-danger/40 mb-2 ml-4">
                    <Text className="text-typography-main text-sm font-bold mb-2">Remove "{t.label}"?</Text>
                    <View className="flex-row gap-3">
                      <TouchableOpacity
                        onPress={() => setConfirmDeleteId(null)}
                        className="flex-1 bg-surface-background py-2 rounded-xl border border-surface-border items-center"
                      >
                        <Text className="text-typography-muted font-bold text-xs">Keep</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => handleDelete(t.id)}
                        className="flex-1 bg-state-danger py-2 rounded-xl items-center"
                      >
                        <Text className="text-brand-on-primary font-bold text-xs">Remove</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  /* Normal transition card */
                  <View className="bg-surface-card p-3 rounded-xl border border-surface-border mb-2 ml-4 flex-row items-center">
                    <View className="flex-1">
                      <View className="flex-row items-center flex-wrap gap-1">
                        <View className="bg-brand-primary-dim px-2 py-0.5 rounded-md border border-brand-primary/20 flex-row items-center gap-1.5">
                          {t.transition_type && t.transition_type !== 'neutral' && TYPE_DISPLAY[t.transition_type] && (
                            <FontAwesome
                              name={TYPE_DISPLAY[t.transition_type].icon as any}
                              size={10}
                              color={TYPE_DISPLAY[t.transition_type].color}
                            />
                          )}
                          <Text className="text-brand-primary text-xs font-black">{t.label}</Text>
                        </View>
                        <FontAwesome name="long-arrow-right" size={10} color="rgb(var(--text-dim))" />
                        <View className="flex-row items-center">
                          <View className="w-2 h-2 rounded-full mr-1" style={{ backgroundColor: stageColor(t.to_stage_id) }} />
                          <Text className="text-typography-muted text-xs font-bold">{stageName(t.to_stage_id)}</Text>
                        </View>
                      </View>
                      {t.required_permission && (
                        <View className="flex-row items-center mt-1.5">
                          <FontAwesome name="lock" size={8} color="var(--color-warning)" />
                          <Text className="text-typography-dim text-[10px] ml-1.5">
                            Requires: {permissions.find(p => p.key === t.required_permission)?.label || t.required_permission}
                          </Text>
                        </View>
                      )}
                    </View>

                    <View className="flex-row gap-1.5">
                      <TouchableOpacity
                        onPress={() => {
                          setFormLabel(t.label);
                          setFormPerm(t.required_permission || '');
                          setFormType(toUiType(t.transition_type));
                          setEditingId(t.id);
                        }}
                        className="p-2 rounded-lg border border-surface-border bg-surface-background"
                      >
                        <FontAwesome name="pencil" size={10} color="#64748b" />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => setConfirmDeleteId(t.id)}
                        className="p-2 rounded-lg border border-surface-border bg-surface-background"
                      >
                        <FontAwesome name="trash-o" size={10} color="var(--color-text-dim)" />
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>
            ))}
          </View>
        ))}

        {transitions.length === 0 && !showAdd && (
          <View className="py-16 items-center">
            <FontAwesome name="random" size={40} color="var(--color-surface-border)" />
            <Text className="text-typography-muted text-base font-bold mt-4">No Transitions</Text>
            <Text className="text-typography-dim text-sm mt-1 text-center px-8">
              Add transitions to define how tasks can move between stages.
            </Text>
          </View>
        )}
        <View className="h-20" />
      </ScrollView>
    </View>
  );
}
