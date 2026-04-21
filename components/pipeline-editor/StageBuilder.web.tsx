import React, { useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ActivityIndicator, Alert, Platform } from 'react-native';
import HorizontalScroll from '../common/HorizontalScroll';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import DraggableFlatList, { ScaleDecorator, RenderItemParams } from 'react-native-draggable-flatlist';
import { FontAwesome } from '@expo/vector-icons';
import { usePipelineEditor, Stage } from '@/contexts/PipelineEditorContext';

const COLOR_PALETTE = [
  '#64748b', '#3b82f6', '#6366f1', '#8b5cf6',
  '#ec4899', '#ef4444', '#f59e0b', '#fbbf24',
  '#22c55e', '#14b8a6', '#06b6d4', '#f97316',
];

export default function StageBuilder() {
  const {
    stages, loading, error, pipelines, automations, isOperationInFlight,
    stageActions,
    addStage, updateStage, deleteStage, reorderStages,
    selectedPipeline,
  } = usePipelineEditor();

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingStage, setEditingStage] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formColor, setFormColor] = useState('#6B7280');
  const [formDesc, setFormDesc] = useState('');
  const [formIsInitial, setFormIsInitial] = useState(false);
  const [formIsTerminal, setFormIsTerminal] = useState(false);
  const [formTerminalType, setFormTerminalType] = useState<'success' | 'failure' | ''>('');
  const [formRequiresSub, setFormRequiresSub] = useState(false);
  const [formLinkedPipeId, setFormLinkedPipeId] = useState<string | null>(null);

  const resetForm = () => {
    setFormName('');
    setFormColor('#6B7280');
    setFormDesc('');
    setFormIsInitial(false);
    setFormIsTerminal(false);
    setFormTerminalType('');
    setFormRequiresSub(false);
    setFormLinkedPipeId(null);
  };

  const populateForm = (s: Stage) => {
    setFormName(s.name);
    setFormColor(s.color || '#6B7280');
    setFormDesc(s.description || '');
    setFormIsInitial(s.is_initial);
    setFormIsTerminal(s.is_terminal);
    setFormTerminalType(s.terminal_type || '');
    setFormRequiresSub(s.requires_submission);
    setFormLinkedPipeId(s.linked_pipeline_id);
  };

  const handleAdd = async () => {
    if (!formName.trim()) return;
    await addStage({
      name: formName.trim().toUpperCase(),
      color: formColor,
      description: formDesc || undefined,
      is_initial: formIsInitial,
      is_terminal: formIsTerminal,
      terminal_type: formTerminalType || null,
      requires_submission: formRequiresSub,
    } as any);
    resetForm();
    setShowAddForm(false);
  };

  const handleUpdate = async (id: string) => {
    await updateStage(id, {
      name: formName.trim().toUpperCase(),
      color: formColor,
      description: formDesc || undefined,
      is_initial: formIsInitial,
      is_terminal: formIsTerminal,
      terminal_type: formTerminalType || null,
      requires_submission: formRequiresSub,
    } as any);
    setEditingStage(null);
    resetForm();
  };

  const handleDelete = async (id: string) => {
    await deleteStage(id);
    setConfirmDeleteId(null);
  };

  const handleMoveUp = (index: number) => {
    if (index <= 0) return;
    if (stages[index].is_initial || (index === 1 && stages[0]?.is_initial)) {
      Alert.alert('Invalid Move', 'Entry Stage must remain first.', [{text: 'OK'}]);
      return;
    }
    const ids = stages.map(s => s.id);
    [ids[index], ids[index - 1]] = [ids[index - 1], ids[index]];
    reorderStages(ids);
  };

  const handleMoveDown = (index: number) => {
    if (index >= stages.length - 1) return;
    if (stages[index].is_initial) {
      Alert.alert('Invalid Move', 'Entry Stage must remain first.', [{text: 'OK'}]);
      return;
    }
    const ids = stages.map(s => s.id);
    [ids[index], ids[index + 1]] = [ids[index + 1], ids[index]];
    reorderStages(ids);
  };

  const handleMoveToTop = (index: number) => {
    if (index <= 0) return;
    if (stages[0]?.is_initial && !stages[index].is_initial) {
      Alert.alert('Invalid Move', 'Entry Stage must remain first.', [{text: 'OK'}]);
      return;
    }
    const ids = stages.map(s => s.id);
    const [item] = ids.splice(index, 1);
    ids.unshift(item);
    reorderStages(ids);
  };

  const handleMoveToEnd = (index: number) => {
    if (index >= stages.length - 1) return;
    if (stages[index].is_initial) {
      Alert.alert('Invalid Move', 'Entry Stage must remain first.', [{text: 'OK'}]);
      return;
    }
    const ids = stages.map(s => s.id);
    const [item] = ids.splice(index, 1);
    ids.push(item);
    reorderStages(ids);
  };

  const renderStageForm = (isEdit: boolean, stageId?: string) => (
    <View className="bg-surface-card p-4 rounded-2xl border border-brand-primary/40 mb-3">
      <Text className="text-typography-main font-bold text-base mb-4">
        {isEdit ? 'Edit Stage' : 'Add New Stage'}
      </Text>

      {/* Name */}
      <Text className="text-typography-label text-[10px] font-bold uppercase tracking-wider mb-1.5">Stage Name</Text>
      <TextInput
        value={formName}
        onChangeText={setFormName}
        placeholder="e.g. REVIEWING"
        placeholderTextColor="#64748b"
        className="bg-surface-background text-typography-main px-4 py-2.5 rounded-lg border border-surface-border mb-3"
        autoCapitalize="characters"
      />

      {/* Description */}
      <Text className="text-typography-label text-[10px] font-bold uppercase tracking-wider mb-1.5">Description</Text>
      <TextInput
        value={formDesc}
        onChangeText={setFormDesc}
        placeholder="What happens in this stage?"
        placeholderTextColor="#64748b"
        className="bg-surface-background text-typography-main px-4 py-2.5 rounded-lg border border-surface-border mb-3 text-sm"
      />

      {/* Color Picker */}
      <Text className="text-typography-label text-[10px] font-bold uppercase tracking-wider mb-2">Color</Text>
      <View className="flex-row flex-wrap gap-2 mb-4">
        {COLOR_PALETTE.map(c => (
          <TouchableOpacity
            key={c}
            onPress={() => setFormColor(c)}
            className={`w-8 h-8 rounded-lg ${formColor === c ? 'border-2 border-typography-main' : 'border border-surface-border'}`}
            style={{ backgroundColor: c }}
          />
        ))}
      </View>

      {/* Flags */}
      <Text className="text-typography-label text-[10px] font-bold uppercase tracking-wider mb-2">Stage Flags</Text>
      <View className="gap-2 mb-4">
        <FlagToggle
          label="Entry Point"
          desc="First stage — tasks start here"
          active={formIsInitial}
          onToggle={() => setFormIsInitial(!formIsInitial)}
          icon="sign-in"
          color="#3b82f6"
        />
        <FlagToggle
          label="Requires Submission"
          desc="Workers must submit work before advancing"
          active={formRequiresSub}
          onToggle={() => setFormRequiresSub(!formRequiresSub)}
          icon="upload"
          color="#8b5cf6"
        />
        <FlagToggle
          label="Terminal Stage"
          desc="End state — no further transitions"
          active={formIsTerminal}
          onToggle={() => {
            setFormIsTerminal(!formIsTerminal);
            if (!!formIsTerminal) setFormTerminalType('');
          }}
          icon="flag-checkered"
          color="#f59e0b"
        />
      </View>

      {/* Recursive Spawning */}
      <Text className="text-typography-label text-[10px] font-bold uppercase tracking-wider mb-2">Recursive Spawning</Text>
      <View className="mb-4">
        <HorizontalScroll className="flex-row gap-2">
          <TouchableOpacity
            onPress={() => setFormLinkedPipeId(null)}
            className={`px-3 py-2 rounded-xl border ${!formLinkedPipeId ? 'bg-brand-primary/10 border-brand-primary/40' : 'bg-surface-background border-surface-border'}`}
          >
            <Text className={`text-xs font-bold ${!formLinkedPipeId ? 'text-brand-primary' : 'text-typography-muted'}`}>No Respawn</Text>
          </TouchableOpacity>
          {pipelines.filter(p => p.id !== selectedPipeline?.id).map(p => (
            <TouchableOpacity
              key={p.id}
              onPress={() => setFormLinkedPipeId(p.id)}
              className={`px-3 py-2 rounded-xl border ${formLinkedPipeId === p.id ? 'bg-brand-primary/10 border-brand-primary/40' : 'bg-surface-background border-surface-border'}`}
            >
              <Text className={`text-xs font-bold ${formLinkedPipeId === p.id ? 'text-brand-primary' : 'text-typography-muted'}`}>{p.name}</Text>
            </TouchableOpacity>
          ))}
        </HorizontalScroll>
        <Text className="text-typography-dim text-[10px] mt-1">If a task enters this stage, spawn a sub-task with this pipeline.</Text>
      </View>

      {/* Terminal Type */}
      {formIsTerminal && (
        <View className="mb-4">
          <Text className="text-typography-label text-[10px] font-bold uppercase tracking-wider mb-2">Terminal Outcome</Text>
          <View className="flex-row gap-2">
            {(['success', 'failure'] as const).map(t => (
              <TouchableOpacity
                key={t}
                onPress={() => setFormTerminalType(t)}
                className={`flex-1 py-2.5 rounded-xl items-center border ${
                  formTerminalType === t
                    ? t === 'success' ? 'bg-state-success/20 border-state-success/50' : 'bg-state-danger/20 border-state-danger/50'
                    : 'bg-surface-background border-surface-border'
                }`}
              >
                <Text className={`text-sm font-bold uppercase ${
                  formTerminalType === t
                    ? t === 'success' ? 'text-state-success' : 'text-state-danger'
                    : 'text-typography-muted'
                }`}>
                  {t === 'success' ? '✓ Success' : '✗ Failure'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* Stage Actions */}
      {isEdit && stageId ? (
        <StageActionManager stageId={stageId} />
      ) : (
        <View className="mb-4 p-4 border border-surface-border border-dashed rounded-xl items-center">
          <Text className="text-typography-muted text-xs">Save this stage first to manage its Actions.</Text>
        </View>
      )}

      {/* Actions */}
      <View className="flex-row gap-3">
        <TouchableOpacity
          onPress={() => {
            isEdit ? setEditingStage(null) : setShowAddForm(false);
            resetForm();
          }}
          className="flex-1 bg-surface-background py-2.5 rounded-xl border border-surface-border items-center"
        >
          <Text className="text-typography-muted font-bold text-sm">Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => isEdit && stageId ? handleUpdate(stageId) : handleAdd()}
          className="flex-1 bg-brand-primary py-2.5 rounded-xl items-center"
          disabled={!formName.trim() || loading}
        >
          {loading ? (
            <ActivityIndicator color="#ffffff" size="small" />
          ) : (
            <Text className="text-white font-bold text-sm">{isEdit ? 'Update' : 'Add Stage'}</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View className="flex-1">
      <View className="flex-row items-center justify-between mb-4">
        <View>
          <Text className="text-typography-main text-lg font-black">Stages</Text>
          <Text className="text-typography-muted text-xs">{(stages?.length || 0)} stage{(stages?.length || 0) !== 1 ? 's' : ''} configured</Text>
        </View>
        {!showAddForm && (
          <TouchableOpacity
            onPress={() => { resetForm(); setShowAddForm(true); }}
            className="bg-brand-primary/10 px-4 py-2 rounded-xl border border-brand-primary/30"
          >
            <View className="flex-row items-center">
              <FontAwesome name="plus" size={10} color="#6366f1" />
              <Text className="text-brand-primary font-bold text-xs ml-2">Add Stage</Text>
            </View>
          </TouchableOpacity>
        )}
      </View>

       {error && (
        <View className="bg-state-danger/10 border border-state-danger/30 p-3 rounded-xl mb-3">
          <Text className="text-state-danger text-sm font-bold">{error}</Text>
        </View>
      )}

      <GestureHandlerRootView style={{ flex: 1 }}>
        <DraggableFlatList
          data={stages || []}
          onDragEnd={({ data }) => {
            const newIds = data.map(st => st.id);
            // Validation: ensure initial stage is still at the top
            const oldInitialStageId = stages.find(s => s.is_initial)?.id;
            const newInitialStageId = data[0]?.id;
            
            if (oldInitialStageId && oldInitialStageId !== newInitialStageId) {
              Alert.alert('Invalid Move', 'Entry Stage must remain first.', [{text: 'OK'}]);
              return;
            }
            
            reorderStages(newIds);
          }}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={showAddForm ? renderStageForm(false) : null}
          contentContainerStyle={{ paddingBottom: 80 }}
          renderItem={({ item: s, drag, isActive, getIndex }: RenderItemParams<Stage>) => {
            const index = getIndex() || 0;
            return (
              <ScaleDecorator>
                <View style={{ opacity: isActive ? 0.7 : 1 }}>
                  {editingStage === s.id ? (
                    renderStageForm(true, s.id)
                  ) : confirmDeleteId === s.id ? (
                    <View className="bg-surface-card p-4 rounded-2xl border border-state-danger/40 mb-3">
                      <Text className="text-typography-main font-bold mb-2">Delete stage "{s.name}"?</Text>
                      <Text className="text-typography-muted text-xs mb-3">
                        Any transitions from/to this stage will be removed. Tasks in this stage cannot be deleted.
                      </Text>
                      <View className="flex-row gap-3">
                        <TouchableOpacity
                          onPress={() => setConfirmDeleteId(null)}
                          className="flex-1 bg-surface-background py-2 rounded-xl border border-surface-border items-center"
                        >
                          <Text className="text-typography-muted font-bold text-sm">Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => handleDelete(s.id)}
                          className="flex-1 bg-state-danger py-2 rounded-xl items-center"
                        >
                          <Text className="text-white font-bold text-sm">Delete</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <View className="bg-surface-card p-4 rounded-2xl border border-surface-border mb-3">
                      <View className="flex-row items-center">
                        {/* Drag Handle & Position */}
                        <TouchableOpacity 
                          onLongPress={drag} 
                          disabled={isOperationInFlight}
                          className="mr-3 items-center justify-center"
                        >
                          <View className="mb-2">
                            <FontAwesome name="bars" size={16} color={isOperationInFlight ? '#475569' : '#64748b'} />
                          </View>
                          <View className={`w-9 h-9 rounded-lg items-center justify-center ${isOperationInFlight ? 'opacity-50' : ''}`} style={{ backgroundColor: s.color || '#6B7280' }}>
                            <Text className="text-white font-black text-sm">{s.position}</Text>
                          </View>
                        </TouchableOpacity>

                        {/* Stage Info */}
                        <View className="flex-1">
                          <View className="flex-row items-center flex-wrap gap-1.5 mb-1">
                            <Text className="text-typography-main font-bold text-base">{s.name}</Text>
                            {s.is_initial && (
                              <View className="bg-state-info/15 px-1.5 py-0.5 rounded">
                                <Text className="text-state-info text-[8px] font-black uppercase">Entry</Text>
                              </View>
                            )}
                            {s.is_terminal && (
                              <View className={`px-1.5 py-0.5 rounded ${s.terminal_type === 'success' ? 'bg-state-success/15' : 'bg-state-danger/15'}`}>
                                <Text className={`text-[8px] font-black uppercase ${s.terminal_type === 'success' ? 'text-state-success' : 'text-state-danger'}`}>
                                  {s.terminal_type || 'Terminal'}
                                </Text>
                              </View>
                            )}
                            {s.requires_submission && (
                              <View className="bg-brand-accent/15 px-1.5 py-0.5 rounded">
                                <Text className="text-brand-accent text-[8px] font-black uppercase">Submission</Text>
                              </View>
                            )}
                            {s.linked_pipeline_id && (
                              <View className="bg-brand-primary/15 px-1.5 py-0.5 rounded">
                                <Text className="text-brand-primary text-[8px] font-black uppercase">
                                  ⚡ {pipelines.find(p => p.id === s.linked_pipeline_id)?.name || 'Linked'}
                                </Text>
                              </View>
                            )}
                            
                            {(() => {
                              const stageAutomations = automations.filter(a => a.source_stage_id === s.id || a.target_stage_id === s.id);
                              if (stageAutomations.length > 0) {
                                return (
                                  <View className="bg-state-warning/15 px-1.5 py-0.5 rounded">
                                    <Text className="text-state-warning text-[8px] font-black uppercase">
                                      ⚠️ {stageAutomations.length} auto{stageAutomations.length !== 1 ? 's' : ''}
                                    </Text>
                                  </View>
                                );
                              }
                              return null;
                            })()}
                          </View>
                          {s.description && (
                            <Text className="text-typography-dim text-xs" numberOfLines={1}>{s.description}</Text>
                          )}
                        </View>

                        {/* Actions */}
                        <View className="flex-row gap-2">
                          <TouchableOpacity
                            onPress={() => { populateForm(s); setEditingStage(s.id); }}
                            className="p-2 rounded-lg border border-surface-border bg-surface-background"
                          >
                            <FontAwesome name="pencil" size={12} color="#64748b" />
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => setConfirmDeleteId(s.id)}
                            className="p-2 rounded-lg border border-surface-border bg-surface-background"
                          >
                            <FontAwesome name="trash-o" size={12} color="#64748b" />
                          </TouchableOpacity>
                        </View>
                      </View>

                      {/* Summary of Actions */}
                      {(() => {
                        const acts = stageActions.filter(a => a.stage_id === s.id);
                        if (acts.length > 0) {
                          return (
                            <View className="flex-row flex-wrap gap-1 mt-2 pl-[48px]">
                              {acts.sort((a,b) => a.position - b.position).map(a => (
                                <View key={a.id} className="bg-surface-background border border-surface-border px-1.5 py-0.5 rounded flex-row items-center">
                                  <Text className="text-typography-dim text-[8px] uppercase tracking-wider">{a.label}</Text>
                                </View>
                              ))}
                            </View>
                          );
                        }
                        return null;
                      })()}
                    </View>
                  )}

                  {/* Connector Line between stages */}
                  {index < stages.length - 1 && editingStage !== s.id && confirmDeleteId !== s.id && (
                    <View className="items-center my-0">
                      <View className="w-0.5 h-3 bg-surface-border" />
                      <FontAwesome name="chevron-down" size={8} color="#334155" />
                    </View>
                  )}
                </View>
              </ScaleDecorator>
            );
          }}
        />
      </GestureHandlerRootView>
    </View>
  );
}

function StageActionManager({ stageId }: { stageId: string }) {
  const { stageActions, permissions, addStageAction, updateStageAction, deleteStageAction, reorderStageActions } = usePipelineEditor();
  const actions = stageActions.filter(a => a.stage_id === stageId).sort((a,b) => a.position - b.position);
  
  const [showAdd, setShowAdd] = useState(false);
  const [type, setType] = useState('advance');
  const [label, setLabel] = useState('');
  const [style, setStyle] = useState('neutral');
  const [role, setRole] = useState('any');
  const [precondition, setPrecondition] = useState('');
  
  // Note: For now we'll allow free-form custom transition_ids later or pre-fill them
  
  const handleAdd = async () => {
    if (!label.trim()) return;
    await addStageAction({
      stage_id: stageId,
      action_type: type,
      label: label.trim(),
      style,
      required_role: role,
      precondition: precondition || null,
    });
    setShowAdd(false);
    setLabel('');
  };
  
  const handleDelete = async (id: string) => {
    await deleteStageAction(id);
  };
  
  const moveAction = (index: number, dir: number) => {
    if (index + dir < 0 || index + dir >= actions.length) return;
    const newActions = [...actions];
    [newActions[index], newActions[index + dir]] = [newActions[index + dir], newActions[index]];
    reorderStageActions(stageId, newActions.map(a => a.id));
  };
  
  return (
    <View className="mb-4 p-4 rounded-xl bg-surface-background border border-surface-border">
      <View className="flex-row justify-between items-center mb-3">
        <Text className="text-typography-main font-bold text-sm">Stage Actions ({actions.length})</Text>
        <TouchableOpacity onPress={() => setShowAdd(!showAdd)}>
          <Text className="text-brand-primary text-xs font-bold">{showAdd ? 'Cancel' : '+ Add Action'}</Text>
        </TouchableOpacity>
      </View>
      
      {showAdd && (
        <View className="p-3 bg-surface-overlay border border-surface-border rounded-lg mb-3">
          <TextInput
            placeholder="Action Label (e.g. Reject)"
            value={label}
            onChangeText={setLabel}
            placeholderTextColor="#64748b"
            className="bg-surface-background border border-surface-border rounded-md px-3 py-1.5 text-xs text-typography-main mb-2"
          />
          <View className="flex-row gap-2 mb-2">
            <TextInput
              placeholder="Type (e.g. advance, review_reject)"
              value={type}
              onChangeText={setType}
              placeholderTextColor="#64748b"
              className="flex-1 bg-surface-background border border-surface-border rounded-md px-3 py-1.5 text-xs text-typography-main"
            />
            <TextInput
              placeholder="Style (e.g. success, danger)"
              value={style}
              onChangeText={setStyle}
              placeholderTextColor="#64748b"
              className="flex-1 bg-surface-background border border-surface-border rounded-md px-3 py-1.5 text-xs text-typography-main"
            />
          </View>
          <View className="flex-row gap-2 mb-2">
            <TextInput
              placeholder="Role (e.g. any, assignee, creator)"
              value={role}
              onChangeText={setRole}
              placeholderTextColor="#64748b"
              className="flex-1 bg-surface-background border border-surface-border rounded-md px-3 py-1.5 text-xs text-typography-main"
            />
            <TextInput
              placeholder="Precondition (optional)"
              value={precondition}
              onChangeText={setPrecondition}
              placeholderTextColor="#64748b"
              className="flex-1 bg-surface-background border border-surface-border rounded-md px-3 py-1.5 text-xs text-typography-main"
            />
          </View>
          <TouchableOpacity onPress={handleAdd} disabled={!label} className={`py-2 rounded-md items-center ${label ? 'bg-brand-primary' : 'bg-brand-primary/50'}`}>
            <Text className="text-white text-xs font-bold">Save Action</Text>
          </TouchableOpacity>
        </View>
      )}
      
      {actions.map((act, idx) => (
        <View key={act.id} className="flex-row items-center border-b border-surface-border/50 py-2 last:border-0">
          <View className="flex-1">
            <Text className="text-typography-main text-xs font-bold">{act.label}</Text>
            <Text className="text-typography-dim text-[10px]">Type: {act.action_type} • Role: {act.required_role} • Style: {act.style}</Text>
            {act.precondition && <Text className="text-typography-dim text-[10px]">Cond: {act.precondition}</Text>}
          </View>
          <View className="flex-row gap-1">
            <TouchableOpacity onPress={() => moveAction(idx, -1)} disabled={idx === 0} className="p-1.5 opacity-70">
              <FontAwesome name="arrow-up" size={10} color="#64748b" />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => moveAction(idx, 1)} disabled={idx === actions.length - 1} className="p-1.5 opacity-70">
              <FontAwesome name="arrow-down" size={10} color="#64748b" />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => handleDelete(act.id)} className="p-1.5 ml-2">
              <FontAwesome name="times" size={12} color="#ef4444" />
            </TouchableOpacity>
          </View>
        </View>
      ))}
      {actions.length === 0 && !showAdd && (
        <Text className="text-typography-dim text-xs text-center p-2">No actions defined for this stage.</Text>
      )}
    </View>
  );
}

function FlagToggle({ label, desc, active, onToggle, icon, color }: {
  label: string; desc: string; active: boolean; onToggle: () => void; icon: string; color: string;
}) {
  return (
    <TouchableOpacity
      onPress={onToggle}
      className={`flex-row items-center p-3 rounded-xl border ${active ? 'border-brand-primary/40 bg-brand-primary/5' : 'border-surface-border bg-surface-background'}`}
    >
      <View className="w-8 h-8 rounded-lg items-center justify-center mr-3" style={{ backgroundColor: active ? color + '20' : '#1e293b' }}>
        <FontAwesome name={icon as any} size={14} color={active ? color : '#475569'} />
      </View>
      <View className="flex-1">
        <Text className={`font-bold text-sm ${active ? 'text-typography-main' : 'text-typography-muted'}`}>{label}</Text>
        <Text className="text-typography-dim text-[10px]">{desc}</Text>
      </View>
      <View className={`w-5 h-5 rounded-md border-2 items-center justify-center ${active ? 'bg-brand-primary border-brand-primary' : 'border-surface-border'}`}>
        {active && <FontAwesome name="check" size={10} color="#ffffff" />}
      </View>
    </TouchableOpacity>
  );
}
