import React, { useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ActivityIndicator, Alert, Platform, ScrollView } from 'react-native';
import HorizontalScroll from '../common/HorizontalScroll';
import { FontAwesome } from '@expo/vector-icons';
import { usePipelineEditor, Stage } from '@/contexts/PipelineEditorContext';
import { useAlert } from '@/contexts/AlertContext';

const COLOR_PALETTE = [
  'var(--color-text-dim)', 'var(--color-primary)', 'var(--color-brand-secondary)', 'var(--color-brand-accent)',
  'var(--color-state-danger)', 'var(--color-danger)', 'var(--color-warning)', 'var(--color-state-warning)',
  'var(--color-success)', 'var(--color-state-success)', 'var(--color-info)', 'var(--color-state-info)',
];

export default function StageBuilder() {
  const {
    stages, loading, error, pipelines, automations, isOperationInFlight,
    stageActions,
    addStage, updateStage, deleteStage, reorderStages,
    selectedPipeline,
  } = usePipelineEditor();

  const { showAlert } = useAlert();

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingStage, setEditingStage] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formColor, setFormColor] = useState('var(--color-text-dim)');
  const [formDesc, setFormDesc] = useState('');
  const [formIsInitial, setFormIsInitial] = useState(false);
  const [formIsTerminal, setFormIsTerminal] = useState(false);
  const [formTerminalType, setFormTerminalType] = useState<'success' | 'failure' | ''>('');
  const [formRequiresSub, setFormRequiresSub] = useState(false);
  const [formRequiresTimer, setFormRequiresTimer] = useState(false);
  const [formMinTimerMinutes, setFormMinTimerMinutes] = useState(5);
  const [formUseBus, setFormUseBus] = useState(false);
  const [formLinkedPipeId, setFormLinkedPipeId] = useState<string | null>(null);
  const [formManagerRouting, setFormManagerRouting] = useState('INHERIT');
  const [formMaxEscalation, setFormMaxEscalation] = useState(3);

  const resetForm = () => {
    setFormName('');
    setFormColor('var(--color-text-dim)');
    setFormDesc('');
    setFormIsInitial(false);
    setFormIsTerminal(false);
    setFormTerminalType('');
    setFormRequiresSub(false);
    setFormRequiresTimer(false);
    setFormMinTimerMinutes(5);
    setFormUseBus(false);
    setFormLinkedPipeId(null);
    setFormManagerRouting('INHERIT');
    setFormMaxEscalation(3);
  };

  const populateForm = (s: Stage) => {
    setFormName(s.name);
    setFormColor(s.color || 'var(--color-text-dim)');
    setFormDesc(s.description || '');
    setFormIsInitial(s.is_initial);
    setFormIsTerminal(s.is_terminal);
    setFormTerminalType(s.terminal_type || '');
    setFormRequiresSub(s.requires_submission);
    setFormRequiresTimer(s.requires_timer);
    setFormMinTimerMinutes(Math.max(0, Math.round((s.min_timer_seconds ?? 300) / 60)));
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
      min_timer_seconds: formRequiresTimer ? Math.max(0, formMinTimerMinutes) * 60 : 0,
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
      min_timer_seconds: formRequiresTimer ? Math.max(0, formMinTimerMinutes) * 60 : 0,
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
      showAlert({
        title: 'Invalid Move',
        message: 'Entry Stage must remain first.',
        type: 'info'
      });
      return;
    }
    const ids = stages.map(s => s.id);
    [ids[index], ids[index - 1]] = [ids[index - 1], ids[index]];
    reorderStages(ids);
  };

  const handleMoveDown = (index: number) => {
    if (index >= stages.length - 1) return;
    if (stages[index].is_initial) {
      showAlert({
        title: 'Invalid Move',
        message: 'Entry Stage must remain first.',
        type: 'info'
      });
      return;
    }
    const ids = stages.map(s => s.id);
    [ids[index], ids[index + 1]] = [ids[index + 1], ids[index]];
    reorderStages(ids);
  };

  const handleMoveToTop = (index: number) => {
    if (index <= 0) return;
    if (stages[0]?.is_initial && !stages[index].is_initial) {
      showAlert({
        title: 'Invalid Move',
        message: 'Entry Stage must remain first.',
        type: 'info'
      });
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
      showAlert({
        title: 'Invalid Move',
        message: 'Entry Stage must remain first.',
        type: 'info'
      });
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
        placeholderTextColor="var(--color-text-dim)"
        className="bg-surface-background text-typography-main px-4 py-2.5 rounded-lg border border-surface-border mb-3"
        autoCapitalize="characters"
      />

      {/* Description */}
      <Text className="text-typography-label text-[10px] font-bold uppercase tracking-wider mb-1.5">Description</Text>
      <TextInput
        value={formDesc}
        onChangeText={setFormDesc}
        placeholder="What happens in this stage?"
        placeholderTextColor="var(--color-text-dim)"
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
          color="var(--color-info)"
        />
        <FlagToggle
          label="Requires Submission"
          desc="Workers must submit work before advancing"
          active={formRequiresSub}
          onToggle={() => setFormRequiresSub(!formRequiresSub)}
          icon="upload"
          color="var(--color-brand-accent)"
        />
        <FlagToggle
          label="Requires Timer"
          desc="Enforces time-tracking for this stage"
          active={formRequiresTimer}
          onToggle={() => setFormRequiresTimer(!formRequiresTimer)}
          icon="clock-o"
          color="var(--color-warning)"
        />
        {formRequiresTimer && (
          <View className="ml-4 pl-4 border-l-2 border-state-warning/30 py-2">
            <Text className="text-typography-label text-[10px] font-bold uppercase tracking-wider mb-1.5">
              Minimum Timer (minutes)
            </Text>
            <View className="flex-row items-center gap-3">
              <TextInput
                value={String(formMinTimerMinutes)}
                onChangeText={(v) => {
                  const n = parseInt(v.replace(/[^0-9]/g, ''), 10);
                  setFormMinTimerMinutes(isNaN(n) ? 0 : Math.min(1440, Math.max(0, n)));
                }}
                keyboardType="numeric"
                className="bg-surface-background text-typography-main px-4 py-2 rounded-lg border border-surface-border text-sm font-bold w-24 text-center"
              />
              <Text className="text-typography-dim text-[11px] flex-1 italic">
                {formMinTimerMinutes === 0
                  ? 'Gate disabled — workers can advance with no recorded time.'
                  : `Workers must accrue ${formMinTimerMinutes} min of timer (or declare manual time) before advancing.`}
              </Text>
            </View>
          </View>
        )}
        <FlagToggle
          label="Use Business Hours"
          desc="Calculates duration only during Sun-Thu 09:00-17:00"
          active={formUseBus}
          onToggle={() => setFormUseBus(!formUseBus)}
          icon="calendar"
          color="var(--color-state-success)"
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
          color="var(--color-state-warning)"
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
               placeholderTextColor="var(--color-text-dim)"
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
            <ActivityIndicator color="var(--color-brand-on-primary)" size="small" />
          ) : (
            <Text className="text-brand-on-primary font-black text-sm uppercase tracking-wide">{isEdit ? 'Update' : 'Add Stage'}</Text>
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
                    <Text className="text-brand-on-primary font-bold text-sm">Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View className="bg-surface-card p-4 rounded-2xl border border-surface-border mb-3">
                <View className="flex-row items-center">
                  {/* Position & Color */}
                  <View className="mr-3 items-center">
                    <TouchableOpacity onPress={() => handleMoveToTop(index)} disabled={isOperationInFlight || index === 0} className="py-1 px-3 items-center justify-center">
                      <FontAwesome name="angle-double-up" size={18} color={isOperationInFlight || index === 0 ? 'var(--color-surface-overlay)' : 'var(--color-text-dim)'} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleMoveUp(index)} disabled={isOperationInFlight || index === 0} className="py-1 px-3 items-center justify-center mb-1">
                      <FontAwesome name="caret-up" size={24} color={isOperationInFlight || index === 0 ? 'var(--color-surface-overlay)' : 'var(--color-text-dim)'} />
                    </TouchableOpacity>
                    <View className={`w-9 h-9 rounded-lg items-center justify-center ${isOperationInFlight ? 'opacity-50' : ''}`} style={{ backgroundColor: s.color || 'var(--color-text-dim)' }}>
                      <Text className="text-brand-on-primary font-black text-sm">{s.position}</Text>
                    </View>
                    <TouchableOpacity onPress={() => handleMoveDown(index)} disabled={isOperationInFlight || index === stages.length - 1} className="py-1 px-3 items-center justify-center mt-1">
                      <FontAwesome name="caret-down" size={24} color={isOperationInFlight || index === stages.length - 1 ? 'var(--color-surface-overlay)' : 'var(--color-text-dim)'} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleMoveToEnd(index)} disabled={isOperationInFlight || index === stages.length - 1} className="py-1 px-3 items-center justify-center">
                      <FontAwesome name="angle-double-down" size={18} color={isOperationInFlight || index === stages.length - 1 ? 'var(--color-surface-overlay)' : 'var(--color-text-dim)'} />
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
                      <FontAwesome name="pencil" size={12} color="var(--color-text-dim)" />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => setConfirmDeleteId(s.id)}
                      className="p-2 rounded-lg border border-surface-border bg-surface-background"
                    >
                      <FontAwesome name="trash-o" size={12} color="var(--color-text-dim)" />
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
                <FontAwesome name="chevron-down" size={8} color="var(--color-text-dim)" />
              </View>
            )}
          </View>
        ))}
        <View className="h-20" />
      </ScrollView>
    </View>
  );
}

const ACTION_TYPES = [
  { id: 'advance',        label: 'Advance Stage',       desc: 'Move task to next stage via a transition' },
  { id: 'submit_work',    label: 'Submit Work',          desc: 'Open the submission form for the worker' },
  { id: 'review_approve', label: 'Approve Submission',   desc: 'Mark pending submission as approved' },
  { id: 'review_revise',  label: 'Request Revision',     desc: 'Send submission back for revision' },
  { id: 'review_reject',  label: 'Reject Submission',    desc: 'Hard-reject the submission' },
];

const ACTION_STYLES = [
  { id: 'neutral', color: 'var(--color-text-dim)' },
  { id: 'success', color: 'var(--color-success)' },
  { id: 'warning', color: 'var(--color-warning)' },
  { id: 'danger',  color: 'var(--color-danger)' },
  { id: 'primary', color: 'var(--color-brand-primary)' },
];

function StageActionManager({ stageId }: { stageId: string }) {
  const { stageActions, addStageAction, updateStageAction, deleteStageAction, reorderStageActions, stages, transitions } = usePipelineEditor();
  const actions = stageActions.filter(a => a.stage_id === stageId).sort((a, b) => a.position - b.position);
  const availableTransitions = transitions.filter(t => t.from_stage_id === stageId);

  const blankForm = () => ({
    type: 'advance', label: '', style: 'neutral', role: 'any',
    requiresTimer: false, useBus: false, precondition: '', transitionId: null as string | null,
  });

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(blankForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const patch = (fields: Partial<typeof form>) => setForm(prev => ({ ...prev, ...fields }));

  const startEdit = (act: typeof actions[0]) => {
    setForm({
      type: act.action_type,
      label: act.label,
      style: act.style,
      role: act.required_role,
      requiresTimer: act.requires_timer,
      useBus: act.use_business_hours,
      precondition: act.precondition || '',
      transitionId: act.transition_id,
    });
    setEditingId(act.id);
    setShowAdd(false);
  };

  const handleAdd = async () => {
    if (!form.label.trim()) return;
    await addStageAction({
      stage_id: stageId,
      action_type: form.type,
      label: form.label.trim(),
      style: form.style,
      required_role: form.role,
      requires_timer: form.requiresTimer,
      use_business_hours: form.useBus,
      precondition: form.precondition || null,
      transition_id: form.transitionId,
    });
    setShowAdd(false);
    setForm(blankForm());
  };

  const handleUpdate = async () => {
    if (!editingId || !form.label.trim()) return;
    await updateStageAction(editingId, {
      action_type: form.type,
      label: form.label.trim(),
      style: form.style as any,
      required_role: form.role,
      requires_timer: form.requiresTimer,
      use_business_hours: form.useBus,
      precondition: form.precondition || null,
      transition_id: form.transitionId,
    });
    setEditingId(null);
    setForm(blankForm());
  };

  const handleDelete = async (id: string) => {
    await deleteStageAction(id);
    setConfirmDeleteId(null);
  };

  const moveAction = (index: number, dir: number) => {
    if (index + dir < 0 || index + dir >= actions.length) return;
    const next = [...actions];
    [next[index], next[index + dir]] = [next[index + dir], next[index]];
    reorderStageActions(stageId, next.map(a => a.id));
  };

  const getTransitionLabel = (transId: string | null) => {
    if (!transId) return null;
    const trans = transitions.find(t => t.id === transId);
    if (!trans) return null;
    return stages.find(s => s.id === trans.to_stage_id)?.name || 'Unknown';
  };

  const renderForm = (isEdit: boolean) => (
    <View className="p-3 bg-surface-card border border-brand-primary/30 rounded-xl mb-3">
      <Text className="text-typography-label text-[10px] font-bold uppercase tracking-wider mb-1.5">Label</Text>
      <TextInput
        placeholder="e.g. Approve, Reject, Start Work"
        value={form.label}
        onChangeText={v => patch({ label: v })}
        placeholderTextColor="rgb(var(--text-dim))"
        className="bg-surface-background border border-surface-border rounded-md px-3 py-2 text-xs text-typography-main mb-3"
      />

      <Text className="text-typography-label text-[10px] font-bold uppercase tracking-wider mb-1.5">Action Type</Text>
      <View className="flex-col gap-1 mb-3">
        {ACTION_TYPES.map(t => (
          <TouchableOpacity
            key={t.id}
            onPress={() => patch({ type: t.id })}
            className={`flex-row items-center px-3 py-2 rounded-lg border ${form.type === t.id ? 'bg-brand-primary/10 border-brand-primary/30' : 'bg-surface-background border-surface-border'}`}
          >
            <View className={`w-2.5 h-2.5 rounded-full mr-2.5 border-2 ${form.type === t.id ? 'bg-brand-primary border-brand-primary' : 'border-surface-border'}`} />
            <View className="flex-1">
              <Text className={`text-[11px] font-bold ${form.type === t.id ? 'text-brand-primary' : 'text-typography-muted'}`}>{t.label}</Text>
              <Text className="text-typography-dim text-[9px]">{t.desc}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>

      <Text className="text-typography-label text-[10px] font-bold uppercase tracking-wider mb-1.5">Visual Style</Text>
      <View className="flex-row gap-2 mb-3">
        {ACTION_STYLES.map(s => (
          <TouchableOpacity
            key={s.id}
            onPress={() => patch({ style: s.id })}
            className={`flex-1 py-2 rounded-lg border items-center ${form.style === s.id ? 'border-brand-primary bg-brand-primary/10' : 'border-surface-border bg-surface-background'}`}
          >
            <View className="w-3 h-3 rounded-full mb-1" style={{ backgroundColor: s.color }} />
            <Text className={`text-[8px] font-bold capitalize ${form.style === s.id ? 'text-brand-primary' : 'text-typography-dim'}`}>{s.id}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text className="text-typography-label text-[10px] font-bold uppercase tracking-wider mb-1.5">Transition Destination</Text>
      <View className="flex-row flex-wrap gap-1.5 mb-3">
        <TouchableOpacity
          onPress={() => patch({ transitionId: null })}
          className={`px-3 py-1.5 rounded-lg border ${!form.transitionId ? 'bg-brand-primary/10 border-brand-primary/30' : 'bg-surface-background border-surface-border'}`}
        >
          <Text className={`text-[10px] font-bold ${!form.transitionId ? 'text-brand-primary' : 'text-typography-muted'}`}>Auto</Text>
        </TouchableOpacity>
        {availableTransitions.map(t => {
          const toStage = stages.find(s => s.id === t.to_stage_id);
          return (
            <TouchableOpacity
              key={t.id}
              onPress={() => patch({ transitionId: t.id })}
              className={`px-3 py-1.5 rounded-lg border ${form.transitionId === t.id ? 'bg-brand-primary/10 border-brand-primary/30' : 'bg-surface-background border-surface-border'}`}
            >
              <Text className={`text-[10px] font-bold ${form.transitionId === t.id ? 'text-brand-primary' : 'text-typography-muted'}`}>→ {toStage?.name || t.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {availableTransitions.length === 0 && (
        <Text className="text-typography-dim text-[10px] italic mb-2">No transitions from this stage — action will use positional auto-advance.</Text>
      )}

      <TextInput
        placeholder="Precondition (optional)"
        value={form.precondition}
        onChangeText={v => patch({ precondition: v })}
        placeholderTextColor="rgb(var(--text-dim))"
        className="bg-surface-background border border-surface-border rounded-md px-3 py-2 text-xs text-typography-main mb-2"
      />

      <View className="mb-2 gap-1">
        <FlagToggle label="Requires Timer" desc="Forces work session for this action" active={form.requiresTimer} onToggle={() => patch({ requiresTimer: !form.requiresTimer })} icon="clock-o" color="var(--color-warning)" />
        <FlagToggle label="Use Business Hours" desc="Filter session via business window" active={form.useBus} onToggle={() => patch({ useBus: !form.useBus })} icon="calendar" color="var(--color-state-success)" />
      </View>

      <View className="flex-row gap-2 mt-1">
        <TouchableOpacity
          onPress={() => { isEdit ? setEditingId(null) : setShowAdd(false); setForm(blankForm()); }}
          className="flex-1 py-2.5 rounded-xl border border-surface-border bg-surface-background items-center"
        >
          <Text className="text-typography-muted font-bold text-xs">Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={isEdit ? handleUpdate : handleAdd}
          disabled={!form.label.trim()}
          className={`flex-1 py-2.5 rounded-xl items-center ${form.label.trim() ? 'bg-brand-primary' : 'bg-surface-overlay border border-surface-border'}`}
        >
          <Text className={`text-xs font-black uppercase tracking-widest ${form.label.trim() ? 'text-brand-on-primary' : 'text-typography-muted'}`}>
            {isEdit ? 'Save Changes' : 'Forge Action'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View className="mb-4 p-4 rounded-xl bg-surface-background border border-surface-border">
      <View className="flex-row justify-between items-center mb-3">
        <Text className="text-typography-main font-bold text-sm">Stage Actions ({actions.length})</Text>
        {!showAdd && !editingId && (
          <TouchableOpacity onPress={() => { setForm(blankForm()); setShowAdd(true); }}>
            <Text className="text-brand-primary text-xs font-bold">+ Add Action</Text>
          </TouchableOpacity>
        )}
      </View>

      {showAdd && renderForm(false)}

      {actions.map((act, idx) => (
        <View key={act.id}>
          {editingId === act.id ? (
            renderForm(true)
          ) : confirmDeleteId === act.id ? (
            <View className="bg-state-danger/5 border border-state-danger/30 rounded-lg p-3 mb-1">
              <Text className="text-typography-main text-xs font-bold mb-2">Remove "{act.label}"?</Text>
              <View className="flex-row gap-2">
                <TouchableOpacity onPress={() => setConfirmDeleteId(null)} className="flex-1 py-1.5 rounded-lg border border-surface-border bg-surface-background items-center">
                  <Text className="text-typography-muted text-xs font-bold">Keep</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleDelete(act.id)} className="flex-1 py-1.5 rounded-lg bg-state-danger items-center">
                  <Text className="text-brand-on-primary text-xs font-bold">Remove</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View className="flex-row items-center border-b border-surface-border/50 py-2 last:border-0">
              <View className="flex-1">
                <View className="flex-row items-center gap-1.5">
                  <View className="w-2 h-2 rounded-full" style={{ backgroundColor: ACTION_STYLES.find(s => s.id === act.style)?.color || 'var(--color-text-dim)' }} />
                  <Text className="text-typography-main text-xs font-bold">{act.label}</Text>
                </View>
                <Text className="text-typography-dim text-[10px] mt-0.5">
                  {ACTION_TYPES.find(t => t.id === act.action_type)?.label || act.action_type}
                  {act.requires_timer ? ' • ⏱️' : ''}
                  {act.transition_id ? ` • → ${getTransitionLabel(act.transition_id) || '?'}` : ' • Auto'}
                </Text>
              </View>
              <View className="flex-row gap-1 items-center">
                <TouchableOpacity onPress={() => moveAction(idx, -1)} disabled={idx === 0} className="p-1.5 opacity-70">
                  <FontAwesome name="arrow-up" size={10} color="#64748b" />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => moveAction(idx, 1)} disabled={idx === actions.length - 1} className="p-1.5 opacity-70">
                  <FontAwesome name="arrow-down" size={10} color="#64748b" />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => startEdit(act)} className="p-1.5 bg-surface-card rounded-lg border border-surface-border ml-1">
                  <FontAwesome name="pencil" size={10} color="#64748b" />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setConfirmDeleteId(act.id)} className="p-1.5 bg-state-danger-dim rounded-lg border border-state-danger/20">
                  <FontAwesome name="times" size={10} color="rgb(var(--state-danger))" />
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      ))}
      {actions.length === 0 && !showAdd && (
        <Text className="text-typography-dim text-xs text-center p-2">No actions configured. Tasks will auto-advance to the next stage.</Text>
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
