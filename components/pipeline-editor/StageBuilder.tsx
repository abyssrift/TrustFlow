import React, { useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ActivityIndicator, Alert, Platform, ScrollView } from 'react-native';
import HorizontalScroll from '../common/HorizontalScroll';
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
  const [formRequiresTimer, setFormRequiresTimer] = useState(false);
  const [formUseBus, setFormUseBus] = useState(false);
  const [formLinkedPipeId, setFormLinkedPipeId] = useState<string | null>(null);
  const [formManagerRouting, setFormManagerRouting] = useState('INHERIT');
  const [formMaxEscalation, setFormMaxEscalation] = useState(3);

  const resetForm = () => {
    setFormName('');
    setFormColor('#6B7280');
    setFormDesc('');
    setFormIsInitial(false);
    setFormIsTerminal(false);
    setFormTerminalType('');
    setFormRequiresSub(false);
    setFormRequiresTimer(false);
    setFormUseBus(false);
    setFormLinkedPipeId(null);
    setFormManagerRouting('INHERIT');
    setFormMaxEscalation(3);
  };

  const populateForm = (s: Stage) => {
    setFormName(s.name);
    setFormColor(s.color || '#6B7280');
    setFormDesc(s.description || '');
    setFormIsInitial(s.is_initial);
    setFormIsTerminal(s.is_terminal);
    setFormTerminalType(s.terminal_type || '');
    setFormRequiresSub(s.requires_submission);
    setFormRequiresTimer(s.requires_timer);
    setFormUseBus(s.use_business_hours);
    setFormLinkedPipeId(s.linked_pipeline_id);
    setFormManagerRouting(s.manager_routing_rule || 'INHERIT');
    setFormMaxEscalation(s.max_escalation_depth || 3);
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
      requires_timer: formRequiresTimer,
      use_business_hours: formUseBus,
      manager_routing_rule: formManagerRouting,
      max_escalation_depth: formMaxEscalation,
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
      requires_timer: formRequiresTimer,
      use_business_hours: formUseBus,
      linked_pipeline_id: formLinkedPipeId || null,
      manager_routing_rule: formManagerRouting,
      max_escalation_depth: formMaxEscalation,
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
    <View className="bg-surface-card p-4 rounded-2xl border border-brand-primary/20 mb-3 shadow-lg">
      <Text className="text-typography-main font-black text-lg mb-4">
        {isEdit ? 'Configure Stage' : 'Forge New Stage'}
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
          label="Requires Timer"
          desc="Enforces time-tracking for this stage"
          active={formRequiresTimer}
          onToggle={() => setFormRequiresTimer(!formRequiresTimer)}
          icon="clock-o"
          color="#f59e0b"
        />
        <FlagToggle
          label="Use Business Hours"
          desc="Calculates duration only during Sun-Thu 09:00-17:00"
          active={formUseBus}
          onToggle={() => setFormUseBus(!formUseBus)}
          icon="calendar"
          color="#14b8a6"
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
            className={`px-3 py-2 rounded-xl border ${!formLinkedPipeId ? 'bg-brand-primary-dim border-brand-primary/40' : 'bg-surface-background border-surface-border'}`}
          >
            <Text className={`text-xs font-bold ${!formLinkedPipeId ? 'text-brand-primary' : 'text-typography-muted'}`}>No Respawn</Text>
          </TouchableOpacity>
          {pipelines.filter(p => p.id !== selectedPipeline?.id).map(p => (
            <TouchableOpacity
              key={p.id}
              onPress={() => setFormLinkedPipeId(p.id)}
              className={`px-3 py-2 rounded-xl border ${formLinkedPipeId === p.id ? 'bg-brand-primary-dim border-brand-primary/40' : 'bg-surface-background border-surface-border'}`}
            >
              <Text className={`text-xs font-bold ${formLinkedPipeId === p.id ? 'text-brand-primary' : 'text-typography-muted'}`}>{p.name}</Text>
            </TouchableOpacity>
          ))}
        </HorizontalScroll>
        <Text className="text-typography-dim text-[10px] mt-1 italic opacity-80">If a task enters this stage, spawn a sub-task with this pipeline.</Text>
      </View>

      {/* Advanced Logic */}
      <Text className="text-typography-label text-[10px] font-bold uppercase tracking-wider mb-2">Advanced Logic (SLA & Routing)</Text>
      <View className="mb-4 gap-3">
         <View>
            <Text className="text-typography-muted text-[10px] font-bold uppercase mb-1">Manager Routing Rule</Text>
            <TextInput
               value={formManagerRouting}
               onChangeText={setFormManagerRouting}
               placeholder="INHERIT, TEAM_LEAD, etc."
               placeholderTextColor="#64748b"
               className="bg-surface-background text-typography-main px-4 py-2 rounded-lg border border-surface-border text-xs"
            />
         </View>
         <View>
            <Text className="text-typography-muted text-[10px] font-bold uppercase mb-1">Max Escalation Depth</Text>
            <TextInput
               value={String(formMaxEscalation)}
               onChangeText={(v) => setFormMaxEscalation(parseInt(v) || 0)}
               keyboardType="numeric"
               className="bg-surface-background text-typography-main px-4 py-2 rounded-lg border border-surface-border text-xs w-20"
            />
         </View>
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
                className={`flex-1 py-2.5 rounded-xl items-center border h-12 justify-center ${
                  formTerminalType === t
                    ? t === 'success' ? 'bg-state-success-dim border-state-success/40' : 'bg-state-danger-dim border-state-danger/40'
                    : 'bg-surface-background border-surface-border'
                }`}
              >
                <Text className={`text-sm font-black uppercase tracking-widest ${
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
          className="flex-1 bg-surface-background py-3 rounded-xl border border-surface-border items-center h-12 justify-center"
        >
          <Text className="text-typography-muted font-bold text-sm">Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => isEdit && stageId ? handleUpdate(stageId) : handleAdd()}
          className="flex-1 bg-brand-primary py-3 rounded-xl items-center h-12 justify-center"
          disabled={!formName.trim() || loading}
        >
          {loading ? (
            <ActivityIndicator color="rgb(var(--text-main))" size="small" />
          ) : (
            <Text className="text-typography-main font-black text-sm uppercase tracking-wide">{isEdit ? 'Update' : 'Add Stage'}</Text>
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
            className="bg-brand-primary-dim px-4 py-2 rounded-xl border border-brand-primary/20 active:bg-brand-primary-dim active:scale-95 transition-all"
          >
            <View className="flex-row items-center">
              <FontAwesome name="plus" size={10} color="rgb(var(--brand-primary))" />
              <Text className="text-brand-primary font-bold text-xs ml-2 uppercase tracking-wide">Add Stage</Text>
            </View>
          </TouchableOpacity>
        )}
      </View>

      {error && (
        <View className="bg-state-danger/10 border border-state-danger/30 p-3 rounded-xl mb-3">
          <Text className="text-state-danger text-sm font-bold">{error}</Text>
        </View>
      )}

      <ScrollView 
        className="flex-1"
        showsVerticalScrollIndicator={Platform.OS === 'web'}
      >
        {/* Add Form at top */}
        {showAddForm && renderStageForm(false)}

        {/* Stage Cards */}
        {stages?.map((s, index) => (
          <View key={s.id}>
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
                  {/* Position & Color */}
                  <View className="mr-3 items-center">
                    <TouchableOpacity onPress={() => handleMoveToTop(index)} disabled={isOperationInFlight || index === 0} className="py-1 px-3 items-center justify-center">
                      <FontAwesome name="angle-double-up" size={18} color={isOperationInFlight || index === 0 ? '#1e293b' : '#64748b'} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleMoveUp(index)} disabled={isOperationInFlight || index === 0} className="py-1 px-3 items-center justify-center mb-1">
                      <FontAwesome name="caret-up" size={24} color={isOperationInFlight || index === 0 ? '#1e293b' : '#64748b'} />
                    </TouchableOpacity>
                    <View className={`w-9 h-9 rounded-lg items-center justify-center ${isOperationInFlight ? 'opacity-50' : ''}`} style={{ backgroundColor: s.color || '#6B7280' }}>
                      <Text className="text-white font-black text-sm">{s.position}</Text>
                    </View>
                    <TouchableOpacity onPress={() => handleMoveDown(index)} disabled={isOperationInFlight || index === stages.length - 1} className="py-1 px-3 items-center justify-center mt-1">
                      <FontAwesome name="caret-down" size={24} color={isOperationInFlight || index === stages.length - 1 ? '#1e293b' : '#64748b'} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleMoveToEnd(index)} disabled={isOperationInFlight || index === stages.length - 1} className="py-1 px-3 items-center justify-center">
                      <FontAwesome name="angle-double-down" size={18} color={isOperationInFlight || index === stages.length - 1 ? '#1e293b' : '#64748b'} />
                    </TouchableOpacity>
                  </View>

                  {/* Stage Info */}
                  <View className="flex-1">
                    <View className="flex-row items-center flex-wrap gap-1.5 mb-1">
                      <Text className="text-typography-main font-bold text-base">{s.name}</Text>
                      {s.is_initial && (
                        <View className="bg-state-info-dim px-1.5 py-0.5 rounded border border-state-info/20">
                          <Text className="text-state-info text-[8px] font-black uppercase">Entry</Text>
                        </View>
                      )}
                      {s.is_terminal && (
                        <View className={`px-1.5 py-0.5 rounded border ${s.terminal_type === 'success' ? 'bg-state-success-dim border-state-success/20' : 'bg-state-danger-dim border-state-danger/20'}`}>
                          <Text className={`text-[8px] font-black uppercase ${s.terminal_type === 'success' ? 'text-state-success' : 'text-state-danger'}`}>
                            {s.terminal_type || 'Terminal'}
                          </Text>
                        </View>
                      )}
                      {s.requires_submission && (
                        <View className="bg-brand-accent-dim px-1.5 py-0.5 rounded border border-brand-accent/20">
                          <Text className="text-brand-accent text-[8px] font-black uppercase">Submission</Text>
                        </View>
                      )}
                      {s.requires_timer && (
                        <View className="bg-state-warning-dim px-1.5 py-0.5 rounded border border-state-warning/20">
                          <Text className="text-state-warning text-[8px] font-black uppercase">⏱️ Timer</Text>
                        </View>
                      )}
                      {s.linked_pipeline_id && (
                        <View className="bg-brand-primary-dim px-1.5 py-0.5 rounded border border-brand-primary/20">
                          <Text className="text-brand-primary text-[8px] font-black uppercase">
                            ⚡ {pipelines.find(p => p.id === s.linked_pipeline_id)?.name || 'Linked'}
                          </Text>
                        </View>
                      )}
                      
                      {(() => {
                        const stageAutomations = automations.filter(a => a.source_stage_id === s.id || a.target_stage_id === s.id);
                        if (stageAutomations.length > 0) {
                          return (
                            <View className="bg-state-warning-dim px-1.5 py-0.5 rounded border border-state-warning/20">
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
        ))}
        <View className="h-20" />
      </ScrollView>
    </View>
  );
}

function StageActionManager({ stageId }: { stageId: string }) {
  const { stageActions, addStageAction, deleteStageAction, reorderStageActions, stages, transitions } = usePipelineEditor();
  const actions = stageActions.filter(a => a.stage_id === stageId).sort((a,b) => a.position - b.position);
  
  // Get transitions FROM this stage for the destination picker
  const availableTransitions = transitions.filter(t => t.from_stage_id === stageId);
  
  const [showAdd, setShowAdd] = useState(false);
  const [type, setType] = useState('advance');
  const [label, setLabel] = useState('');
  const [style, setStyle] = useState('neutral');
  const [role, setRole] = useState('any');
  const [requiresTimer, setRequiresTimer] = useState(false);
  const [useBus, setUseBus] = useState(false);
  const [precondition, setPrecondition] = useState('');
  const [selectedTransitionId, setSelectedTransitionId] = useState<string | null>(null);
  
  const handleAdd = async () => {
    if (!label.trim()) return;
    await addStageAction({
      stage_id: stageId,
      action_type: type,
      label: label.trim(),
      style,
      required_role: role,
      requires_timer: requiresTimer,
      use_business_hours: useBus,
      precondition: precondition || null,
      transition_id: selectedTransitionId,
    });
    setShowAdd(false);
    setLabel('');
    setSelectedTransitionId(null);
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

  const getTransitionLabel = (transId: string | null): string | null => {
    if (!transId) return null;
    const trans = transitions.find(t => t.id === transId);
    if (!trans) return null;
    const toStage = stages.find(s => s.id === trans.to_stage_id);
    return toStage?.name || 'Unknown';
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
        <View className="p-3 bg-surface-card border border-surface-border rounded-lg mb-3 shadow-md">
          <TextInput 
            placeholder="Action Label (e.g. Reject)" 
            value={label} 
            onChangeText={setLabel} 
            placeholderTextColor="rgb(var(--text-dim))" 
            className="bg-surface-background border border-surface-border rounded-md px-3 py-2 text-xs text-typography-main mb-2" 
          />
          <View className="flex-row gap-2 mb-2">
            <TextInput 
              placeholder="Type" 
              value={type} 
              onChangeText={setType} 
              placeholderTextColor="rgb(var(--text-dim))" 
              className="flex-1 bg-surface-background border border-surface-border rounded-md px-3 py-2 text-xs text-typography-main" 
            />
            <TextInput 
              placeholder="Style" 
              value={style} 
              onChangeText={setStyle} 
              placeholderTextColor="rgb(var(--text-dim))" 
              className="flex-1 bg-surface-background border border-surface-border rounded-md px-3 py-2 text-xs text-typography-main" 
            />
          </View>
          <View className="flex-row gap-2 mb-2">
            <TextInput 
              placeholder="Role" 
              value={role} 
              onChangeText={setRole} 
              placeholderTextColor="rgb(var(--text-dim))" 
              className="flex-1 bg-surface-background border border-surface-border rounded-md px-3 py-2 text-xs text-typography-main" 
            />
            <TextInput 
              placeholder="Precondition" 
              value={precondition} 
              onChangeText={setPrecondition} 
              placeholderTextColor="rgb(var(--text-dim))" 
              className="flex-1 bg-surface-background border border-surface-border rounded-md px-3 py-2 text-xs text-typography-main" 
            />
          </View>

          {/* Transition Destination Picker */}
          <Text className="text-typography-label text-[10px] font-bold uppercase tracking-wider mb-1.5">Transition Destination</Text>
          <View className="flex-row flex-wrap gap-2 mb-3">
            <TouchableOpacity
              onPress={() => setSelectedTransitionId(null)}
              className={`px-3 py-2 rounded-lg border ${!selectedTransitionId ? 'bg-brand-primary/10 border-brand-primary/30' : 'bg-surface-background border-surface-border'}`}
            >
              <Text className={`text-[10px] font-bold ${!selectedTransitionId ? 'text-brand-primary' : 'text-typography-muted'}`}>Auto (Next Stage)</Text>
            </TouchableOpacity>
            {availableTransitions.map(t => {
              const toStage = stages.find(s => s.id === t.to_stage_id);
              return (
                <TouchableOpacity
                  key={t.id}
                  onPress={() => setSelectedTransitionId(t.id)}
                  className={`px-3 py-2 rounded-lg border ${selectedTransitionId === t.id ? 'bg-brand-primary/10 border-brand-primary/30' : 'bg-surface-background border-surface-border'}`}
                >
                  <Text className={`text-[10px] font-bold ${selectedTransitionId === t.id ? 'text-brand-primary' : 'text-typography-muted'}`}>
                    → {toStage?.name || t.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {availableTransitions.length === 0 && (
            <Text className="text-typography-dim text-[10px] italic mb-2">No transitions configured from this stage. The action will auto-advance to the next stage by position.</Text>
          )}

          <View className="mb-2">
            <FlagToggle 
               label="Requires Timer" 
               desc="Forces work session for this action" 
               active={requiresTimer} 
               onToggle={() => setRequiresTimer(!requiresTimer)} 
               icon="clock-o" 
               color="#f59e0b" 
            />
            <FlagToggle 
               label="Use Business Hours" 
               desc="Filter session via business window" 
               active={useBus} 
               onToggle={() => setUseBus(!useBus)} 
               icon="calendar" 
               color="#14b8a6" 
            />
          </View>
          <TouchableOpacity 
            onPress={handleAdd} 
            disabled={!label} 
            className={`py-3 rounded-xl items-center justify-center ${label ? 'bg-brand-primary' : 'bg-surface-overlay border border-surface-border'}`}
          >
            <Text className={`text-xs font-black uppercase tracking-widest ${label ? 'text-typography-main' : 'text-typography-muted'}`}>Forge Action</Text>
          </TouchableOpacity>
        </View>
      )}
      
      {actions.map((act, idx) => (
        <View key={act.id} className="flex-row items-center border-b border-surface-border/50 py-2 last:border-0">
          <View className="flex-1">
            <Text className="text-typography-main text-xs font-bold">{act.label}</Text>
            <Text className="text-typography-dim text-[10px]">
              Type: {act.action_type} • Role: {act.required_role} • Style: {act.style} {act.requires_timer ? '• ⏱️ Timer' : ''} {act.transition_id ? `• → ${getTransitionLabel(act.transition_id)}` : '• → Auto'}
            </Text>
          </View>
          <View className="flex-row gap-1">
            <TouchableOpacity onPress={() => moveAction(idx, -1)} disabled={idx === 0} className="p-1.5 opacity-70">
              <FontAwesome name="arrow-up" size={10} color="#64748b" />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => moveAction(idx, 1)} disabled={idx === actions.length - 1} className="p-1.5 opacity-70">
              <FontAwesome name="arrow-down" size={10} color="#64748b" />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => handleDelete(act.id)} className="p-2 ml-2 bg-state-danger-dim rounded-lg border border-state-danger/20">
              <FontAwesome name="times" size={12} color="rgb(var(--state-danger))" />
            </TouchableOpacity>
          </View>
        </View>
      ))}
      {actions.length === 0 && !showAdd && <Text className="text-typography-dim text-xs text-center p-2">No actions configured. Actions will default to advancing to the next stage.</Text>}
    </View>
  );
}

function FlagToggle({ label, desc, active, onToggle, icon, color }: {
  label: string; desc: string; active: boolean; onToggle: () => void; icon: string; color: string;
}) {
  return (
    <TouchableOpacity
      onPress={onToggle}
      className={`flex-row items-center p-3 rounded-xl border ${active ? 'border-brand-primary/30 bg-brand-primary-dim' : 'border-surface-border bg-surface-background'}`}
    >
      <View className="w-8 h-8 rounded-lg items-center justify-center mr-3" style={{ backgroundColor: active ? color : 'rgb(var(--surface-overlay))', opacity: active ? 0.2 : 0.8 }}>
        <FontAwesome name={icon as any} size={14} color={active ? color : 'rgb(var(--text-dim))'} />
      </View>
      <View className="flex-1">
        <Text className={`font-bold text-sm ${active ? 'text-typography-main' : 'text-typography-muted'}`}>{label}</Text>
        <Text className="text-typography-dim text-[10px] italic">{desc}</Text>
      </View>
      <View className={`w-5 h-5 rounded-md border-2 items-center justify-center ${active ? 'bg-brand-primary border-brand-primary' : 'border-surface-border'}`}>
        {active && <FontAwesome name="check" size={10} color="rgb(var(--text-main))" />}
      </View>
    </TouchableOpacity>
  );
}
