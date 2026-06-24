import React, { useState, useMemo } from 'react';
import { View, Text, TouchableOpacity, TextInput, ActivityIndicator, Alert, ScrollView, Switch, Platform } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { usePipelineEditor, Stage } from '@/contexts/PipelineEditorContext';
import { useAlert } from '@/contexts/AlertContext';
import GraphCanvas from './graph/GraphCanvas';
import { useThemeColors } from '@/hooks/useThemeColors';

const COLOR_PALETTE = [
  '#64748b', '#3b82f6', '#6366f1', '#8b5cf6',
  '#ec4899', '#ef4444', '#f59e0b', '#fbbf24',
  '#22c55e', '#14b8a6', '#06b6d4', '#f97316',
];

export default function StageBuilder() {
  const colors = useThemeColors();
  const {
    stages, loading, error, pipelines, isOperationInFlight,
    addStage, updateStage, deleteStage, reorderStages,
    transitions, updateTransition, deleteTransition,
    selectedPipeline, permissions,
    stageActions, updateStageAction, deleteStageAction,
  } = usePipelineEditor();

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingStageId, setEditingStageId] = useState<string | null>(null);
  const [editingActionId, setEditingActionId] = useState<string | null>(null);
  const [actionForm, setActionForm] = useState({ label: '', style: 'primary', requires_timer: false, required_role: 'any' });
  const [editingTransitionId, setEditingTransitionId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'graph' | 'list'>('graph');
  const [showPermPicker, setShowPermPicker] = useState(false);

  // Form state
  const [formState, setFormState] = useState({
    name: '',
    color: '#64748b',
    description: '',
    is_initial: false,
    is_terminal: false,
    terminal_type: '' as 'success' | 'failure' | '',
    requires_submission: false,
    requires_timer: false,
    min_timer_minutes: 5,
    use_business_hours: false,
    linked_pipeline_id: null as string | null,
    manager_routing_rule: 'INHERIT',
    max_escalation_depth: 3,
    reassign_on_entry: false,
  });

  const [transForm, setTransForm] = useState({
    label: '',
    required_permission: '',
    transition_type: '',
  });

  const resetForm = () => {
    setFormState({
      name: '',
      color: '#6366f1',
      description: '',
      is_initial: false,
      is_terminal: false,
      terminal_type: '',
      requires_submission: false,
      requires_timer: false,
      min_timer_minutes: 5,
      use_business_hours: false,
      linked_pipeline_id: null,
      manager_routing_rule: 'INHERIT',
      max_escalation_depth: 3,
      reassign_on_entry: false,
    });
    setShowPermPicker(false);
  };

  const populateForm = (s: Stage) => {
    setFormState({
      name: s.name,
      color: s.color || '#64748b',
      description: s.description || '',
      is_initial: s.is_initial,
      is_terminal: s.is_terminal,
      terminal_type: s.terminal_type || '',
      requires_submission: s.requires_submission,
      requires_timer: s.requires_timer,
      min_timer_minutes: Math.max(0, Math.round((s.min_timer_seconds ?? 300) / 60)),
      use_business_hours: s.use_business_hours,
      linked_pipeline_id: s.linked_pipeline_id,
      manager_routing_rule: s.manager_routing_rule || 'INHERIT',
      max_escalation_depth: s.max_escalation_depth || 3,
      reassign_on_entry: s.reassign_on_entry,
    });
  };

  const populateTransForm = (t: any) => {
    setTransForm({
      label: t.label || '',
      required_permission: t.required_permission || '',
      transition_type: t.transition_type || '',
    });
  };

  const handleSave = async () => {
    if (!formState.name.trim()) return;
    
    const { min_timer_minutes, ...rest } = formState;
    const payload = {
      ...rest,
      name: formState.name.trim().toUpperCase(),
      terminal_type: formState.is_terminal ? (formState.terminal_type || 'success') : null,
      min_timer_seconds: formState.requires_timer ? Math.max(0, min_timer_minutes) * 60 : 0,
    };

    if (editingStageId) {
      const success = await updateStage(editingStageId, payload as any);
      if (success) setEditingStageId(null);
    } else {
      const id = await addStage(payload as any);
      if (id) {
        setShowAddForm(false);
        resetForm();
      }
    }
  };

  const handleTransSave = async () => {
    if (!editingTransitionId) return;
    const success = await updateTransition(
      editingTransitionId, 
      transForm.label, 
      transForm.required_permission,
      transForm.transition_type
    );
    if (success) setEditingTransitionId(null);
  };

  const { showAlert, showConfirm } = useAlert();

  const handleDelete = (id: string) => {
    showConfirm(
      'Delete Stage',
      'Are you sure? This will remove all transitions and metadata associated with this stage.',
      () => deleteStage(id),
      undefined,
      'Delete',
      'Cancel'
    );
  };

  return (
    <View className="flex-1 bg-surface-background">
      {/* Header */}
      <View className="px-6 py-4 border-b border-surface-border flex-row items-center justify-between">
        <View>
          <Text className="text-typography-main text-xl font-black">Pipeline Builder</Text>
          <Text className="text-typography-muted text-xs">Design your workflow logic and stage properties</Text>
        </View>

        <View className="flex-row items-center gap-4">
          {/* View Toggle */}
          <View className="flex-row bg-surface-card border border-surface-border p-1 rounded-xl">
            <TouchableOpacity 
              onPress={() => setViewMode('graph')}
              className={`px-3 py-1.5 rounded-lg flex-row items-center gap-2 transition-all ${viewMode === 'graph' ? 'bg-brand-primary shadow-sm' : 'hover:bg-surface-overlay active:scale-95'}`}
            >
              <FontAwesome name="th-large" size={12} color={viewMode === 'graph' ? 'white' : colors.textMuted} />
              <Text className={`text-xs font-bold ${viewMode === 'graph' ? 'text-white' : 'text-typography-muted'}`}>Canvas</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              onPress={() => setViewMode('list')}
              className={`px-3 py-1.5 rounded-lg flex-row items-center gap-2 transition-all ${viewMode === 'list' ? 'bg-brand-primary shadow-sm' : 'hover:bg-surface-overlay active:scale-95'}`}
            >
              <FontAwesome name="list" size={12} color={viewMode === 'list' ? 'white' : colors.textMuted} />
              <Text className={`text-xs font-bold ${viewMode === 'list' ? 'text-white' : 'text-typography-muted'}`}>List</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            onPress={() => { resetForm(); setShowAddForm(true); setEditingStageId(null); setEditingTransitionId(null); }}
            className="bg-brand-primary hover:bg-brand-primary-hover active:bg-brand-primary-active px-4 py-2 rounded-xl flex-row items-center gap-2 shadow-lg transition-all active:scale-95"
          >
            <FontAwesome name="plus" size={12} color="white" />
            <Text className="text-white font-black text-xs uppercase tracking-wider">Add Stage</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Main Content */}
      <View className="flex-1 flex-row">
        <View className="flex-1 overflow-hidden">
          {viewMode === 'graph' ? (
            <GraphCanvas 
              onEditStage={(s) => { populateForm(s); setEditingStageId(s.id); setEditingTransitionId(null); setShowAddForm(false); }}
              onDeleteStage={handleDelete}
              onEditTransition={(id) => { 
                const t = transitions.find(x => x.id === id);
                if (t) {
                  populateTransForm(t);
                  setEditingTransitionId(id);
                  setEditingStageId(null);
                  setShowAddForm(false);
                }
              }}
            />
          ) : (
            <ScrollView className="p-6">
               {stages.map((s) => (
                 <TouchableOpacity 
                   key={s.id}
                   onPress={() => { populateForm(s); setEditingStageId(s.id); setEditingTransitionId(null); setShowAddForm(false); }}
                   className="bg-surface-card border border-surface-border p-4 rounded-2xl mb-3 flex-row items-center justify-between"
                 >
                   <View className="flex-row items-center gap-4">
                     <View className="w-10 h-10 rounded-xl items-center justify-center border border-white/20" style={{ backgroundColor: s.color || colors.primary }}>
                        <Text className="text-white font-black">{s.position}</Text>
                     </View>
                     <View>
                        <Text className="text-typography-main font-bold">{s.name}</Text>
                        <Text className="text-typography-muted text-xs">{s.description || 'No description'}</Text>
                     </View>
                   </View>
                   <FontAwesome name="chevron-right" size={12} color={colors.textMuted} />
                 </TouchableOpacity>
               ))}
            </ScrollView>
          )}
        </View>

        {/* Side Panel (Editor) */}
        {(editingStageId || showAddForm) && (
          <View className="w-96 bg-surface-card border-l border-surface-border shadow-2xl">
            <View className="px-6 py-4 border-b border-surface-border flex-row justify-between items-center bg-surface-background/50">
              <Text className="text-typography-main font-black uppercase tracking-widest text-xs">
                {editingStageId ? 'Edit Stage' : 'New Stage'}
              </Text>
              <TouchableOpacity 
                onPress={() => { setEditingStageId(null); setShowAddForm(false); }}
                className="p-2 hover:bg-surface-overlay rounded-lg transition-all"
              >
                 <FontAwesome name="times" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <ScrollView className="p-6">
              {/* Basic Info */}
              <Section label="Identification">
                <Input 
                  label="Stage Name"
                  placeholder="e.g. REVIEWING"
                  value={formState.name}
                  onChangeText={(val: string) => setFormState(prev => ({ ...prev, name: val }))}
                />
                <Input 
                  label="Description"
                  placeholder="Describe the objective..."
                  value={formState.description}
                  onChangeText={(val: string) => setFormState(prev => ({ ...prev, description: val }))}
                  multiline
                />
                <Text className="text-typography-muted text-[10px] font-bold uppercase mb-2">Theme Color</Text>
                <View className="flex-row flex-wrap gap-2 mb-6">
                  {COLOR_PALETTE.map(c => (
                    <TouchableOpacity
                      key={c}
                      onPress={() => setFormState(prev => ({ ...prev, color: c }))}
                      className={`w-8 h-8 rounded-lg border-2 transition-all ${formState.color === c ? 'border-typography-main scale-110 shadow-lg' : 'border-transparent opacity-60 hover:opacity-100'}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </View>
              </Section>

              {/* Behavior & Logic */}
              <Section label="Logic & Guards">
                <Toggle 
                  label="Entry Point"
                  desc="Tasks enter the pipeline here"
                  active={formState.is_initial}
                  onToggle={(val: boolean) => setFormState(prev => ({ ...prev, is_initial: val }))}
                />
                <Toggle 
                  label="Terminal Stage"
                  desc="Task cannot advance further"
                  active={formState.is_terminal}
                  onToggle={(val: boolean) => setFormState(prev => ({ ...prev, is_terminal: val }))}
                />
                {formState.is_terminal && (
                   <View className="ml-4 pl-4 border-l border-surface-border mb-4 flex-row gap-2">
                      <TouchableOpacity 
                        onPress={() => setFormState(prev => ({ ...prev, terminal_type: 'success' }))}
                        className={`flex-1 p-2 rounded-lg items-center border ${formState.terminal_type === 'success' ? 'bg-state-success/10 border-state-success' : 'border-surface-border'}`}
                      >
                         <Text className={`text-[10px] font-bold ${formState.terminal_type === 'success' ? 'text-state-success' : 'text-typography-muted'}`}>SUCCESS</Text>
                      </TouchableOpacity>
                      <TouchableOpacity 
                        onPress={() => setFormState(prev => ({ ...prev, terminal_type: 'failure' }))}
                        className={`flex-1 p-2 rounded-lg items-center border ${formState.terminal_type === 'failure' ? 'bg-state-danger/10 border-state-danger' : 'border-surface-border'}`}
                      >
                         <Text className={`text-[10px] font-bold ${formState.terminal_type === 'failure' ? 'text-state-danger' : 'text-typography-muted'}`}>FAILURE</Text>
                      </TouchableOpacity>
                   </View>
                )}
                <Toggle
                  label="Submission Required"
                  desc="Force data upload before exit"
                  active={formState.requires_submission}
                  onToggle={(val: boolean) => setFormState(prev => ({ ...prev, requires_submission: val }))}
                />
                {selectedPipeline?.assignment_mode !== 'manual' && (
                  <Toggle
                    label="Re-assign on Entry"
                    desc="Re-evaluates and may change the assignee every time a task enters this stage — including manually assigned tasks"
                    active={formState.reassign_on_entry}
                    onToggle={(val: boolean) => setFormState(prev => ({ ...prev, reassign_on_entry: val }))}
                  />
                )}
              </Section>

              {/* Time Management */}
              <Section label="Time Management">
                 <Toggle
                    label="Focus Timer"
                    desc="Task requires active work session"
                    active={formState.requires_timer}
                    onToggle={(val: boolean) => setFormState(prev => ({ ...prev, requires_timer: val }))}
                 />
                 {formState.requires_timer && (
                   <View className="ml-4 pl-4 border-l-2 border-state-warning/30 mb-4">
                     <Text className="text-typography-muted text-[10px] font-bold uppercase mb-1.5">Minimum Timer (minutes)</Text>
                     <View className="flex-row items-center gap-3">
                       <TextInput
                         className="bg-surface-background border border-surface-border p-3 rounded-lg text-typography-main text-sm font-bold w-24 text-center"
                         keyboardType="numeric"
                         value={String(formState.min_timer_minutes)}
                         onChangeText={(v) => {
                           const n = parseInt(v.replace(/[^0-9]/g, ''), 10);
                           setFormState(prev => ({ ...prev, min_timer_minutes: isNaN(n) ? 0 : Math.min(1440, Math.max(0, n)) }));
                         }}
                       />
                       <Text className="text-typography-dim text-[11px] flex-1 italic leading-tight">
                         {formState.min_timer_minutes === 0
                           ? 'Gate disabled — workers can advance with no recorded time.'
                           : `Workers must accrue ${formState.min_timer_minutes} min of timer (or declare manual time) before advancing.`}
                       </Text>
                     </View>
                   </View>
                 )}
                 <Toggle
                    label="Business Hours"
                    desc="Only count official working time"
                    active={formState.use_business_hours}
                    onToggle={(val: boolean) => setFormState(prev => ({ ...prev, use_business_hours: val }))}
                 />
              </Section>

              {/* Advanced Routing */}
              <Section label="SLA & Escalation">
                <Input 
                  label="Manager Routing"
                  placeholder="INHERIT, TEAM_LEAD, etc."
                  value={formState.manager_routing_rule}
                  onChangeText={(val: string) => setFormState(prev => ({ ...prev, manager_routing_rule: val }))}
                />
                <View className="mb-4">
                  <Text className="text-typography-muted text-[10px] font-bold uppercase mb-1">Max Escalation Depth</Text>
                  <TextInput 
                    className="bg-surface-background border border-surface-border p-3 rounded-lg text-typography-main font-bold"
                    keyboardType="numeric"
                    value={String(formState.max_escalation_depth)}
                    onChangeText={(val) => setFormState(prev => ({ ...prev, max_escalation_depth: parseInt(val) || 0 }))}
                  />
                </View>
              </Section>

              {/* ── Actions & Conditionals ── */}
              <Section label="Actions & Conditionals" last>
                <Text className="text-typography-muted text-[10px] leading-relaxed mb-3">
                  Buttons shown on task cards. Canvas connections auto-generate actions. Multiple actions create branching choices.
                </Text>

                {(() => {
                  const stageActionList = stageActions
                    .filter((a: any) => a.stage_id === editingStageId && a.is_active !== false)
                    .sort((a: any, b: any) => a.position - b.position);

                  if (stageActionList.length === 0) {
                    return (
                      <View className="py-5 items-center bg-surface-background rounded-xl border border-dashed border-surface-border mb-3">
                        <FontAwesome name="share-alt" size={20} color={colors.textDim} />
                        <Text className="text-typography-dim text-xs font-bold mt-2">No Actions Yet</Text>
                        <Text className="text-typography-dim text-[10px] mt-1 text-center px-4">Draw connections from this stage on the canvas to create action buttons</Text>
                      </View>
                    );
                  }

                  return stageActionList.map((action: any) => {
                    const linkedTrans = transitions.find((t: any) => t.id === action.transition_id);
                    const targetStage = linkedTrans ? stages.find((s: any) => s.id === linkedTrans.to_stage_id) : null;
                    const isExpanded = editingActionId === action.id;
                    const isCanvas = !!action.transition_id;

                    const styleMeta: Record<string, { ring: string; text: string; bg: string }> = {
                      primary: { ring: 'border-brand-primary/40', text: 'text-brand-primary', bg: 'bg-brand-primary/10' },
                      success: { ring: 'border-state-success/40', text: 'text-state-success', bg: 'bg-state-success/10' },
                      warning: { ring: 'border-state-warning/40', text: 'text-state-warning', bg: 'bg-state-warning/10' },
                      danger:  { ring: 'border-state-danger/40',  text: 'text-state-danger',  bg: 'bg-state-danger/10'  },
                      neutral: { ring: 'border-surface-border',    text: 'text-typography-muted', bg: 'bg-surface-overlay' },
                    };
                    const sm = styleMeta[action.style] || styleMeta.neutral;

                    return (
                      <View key={action.id} className="mb-2">
                        {/* Row */}
                        <TouchableOpacity
                          onPress={() => {
                            if (isExpanded) { setEditingActionId(null); return; }
                            setEditingActionId(action.id);
                            setActionForm({ label: action.label, style: action.style || 'primary', requires_timer: action.requires_timer, required_role: action.required_role || 'any' });
                          }}
                          className={`p-3 rounded-xl border flex-row items-center justify-between ${
                            isExpanded ? 'border-brand-primary/40 bg-brand-primary/5' : 'border-surface-border bg-surface-background'
                          }`}
                        >
                          <View className="flex-1 flex-row items-center gap-2 flex-wrap">
                            <View className={`px-2 py-0.5 rounded-md border ${sm.bg} ${sm.ring}`}>
                              <Text className={`text-[9px] font-black uppercase tracking-wide ${sm.text}`}>{action.label}</Text>
                            </View>
                            {targetStage && (
                              <View className="flex-row items-center gap-1">
                                <FontAwesome name="long-arrow-right" size={8} color={colors.textDim} />
                                <View className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: targetStage.color || '#6B7280' }} />
                                <Text className="text-typography-dim text-[10px] font-bold">{targetStage.name}</Text>
                              </View>
                            )}
                            {action.requires_timer && <FontAwesome name="clock-o" size={9} color={colors.warning} />}
                            {!isCanvas && (
                              <View className="bg-surface-overlay px-1.5 py-0.5 rounded">
                                <Text className="text-typography-dim text-[8px] uppercase font-bold">Custom</Text>
                              </View>
                            )}
                          </View>
                          <FontAwesome name={isExpanded ? 'chevron-up' : 'chevron-down'} size={9} color={colors.textDim} />
                        </TouchableOpacity>

                        {/* Inline Editor */}
                        {isExpanded && (
                          <View className="mt-1 ml-2 p-4 bg-surface-card border border-brand-primary/20 rounded-xl">
                            {/* Label */}
                            <Text className="text-typography-label text-[9px] font-black uppercase tracking-wider mb-1">Label</Text>
                            <TextInput
                              value={actionForm.label}
                              onChangeText={(v) => setActionForm(prev => ({ ...prev, label: v }))}
                              className="bg-surface-background border border-surface-border p-2.5 rounded-lg text-typography-main text-xs mb-3"
                              placeholderTextColor={colors.textDim}
                            />

                            {/* Style */}
                            <Text className="text-typography-label text-[9px] font-black uppercase tracking-wider mb-1.5">Button Style</Text>
                            <View className="flex-row gap-1.5 mb-3">
                              {(['primary', 'success', 'warning', 'danger', 'neutral'] as const).map(s => {
                                const m = styleMeta[s];
                                const active = actionForm.style === s;
                                return (
                                  <TouchableOpacity
                                    key={s}
                                    onPress={() => setActionForm(prev => ({ ...prev, style: s }))}
                                    className={`flex-1 py-1.5 rounded-lg items-center border ${
                                      active ? `${m.bg} ${m.ring}` : 'border-surface-border'
                                    }`}
                                  >
                                    <Text className={`text-[8px] font-black uppercase ${
                                      active ? m.text : 'text-typography-dim'
                                    }`}>{s}</Text>
                                  </TouchableOpacity>
                                );
                              })}
                            </View>

                            {/* Requires Timer */}
                            <Toggle
                              label="Requires Timer"
                              desc="User must have an active work session to use this action"
                              active={actionForm.requires_timer}
                              onToggle={(v: boolean) => setActionForm(prev => ({ ...prev, requires_timer: v }))}
                            />

                            {/* Buttons */}
                            <View className="flex-row gap-2 mt-1">
                              <TouchableOpacity
                                onPress={() => setEditingActionId(null)}
                                className="flex-1 py-2 rounded-xl border border-surface-border items-center bg-surface-background"
                              >
                                <Text className="text-typography-muted text-[10px] font-bold uppercase">Cancel</Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                onPress={async () => {
                                  await updateStageAction(action.id, {
                                    label: actionForm.label,
                                    style: actionForm.style,
                                    requires_timer: actionForm.requires_timer,
                                    required_role: actionForm.required_role,
                                  });
                                  setEditingActionId(null);
                                }}
                                disabled={loading}
                                className="flex-1 py-2 rounded-xl bg-brand-primary items-center"
                              >
                                {loading
                                  ? <ActivityIndicator size="small" color="white" />
                                  : <Text className="text-white text-[10px] font-black uppercase">Save</Text>
                                }
                              </TouchableOpacity>
                              {!isCanvas && (
                                <TouchableOpacity
                                  onPress={async () => { await deleteStageAction(action.id); setEditingActionId(null); }}
                                  className="p-2 rounded-xl border border-state-danger/30 bg-state-danger/5 items-center justify-center"
                                >
                                  <FontAwesome name="trash-o" size={12} color={colors.danger} />
                                </TouchableOpacity>
                              )}
                            </View>
                            {isCanvas && (
                              <Text className="text-typography-dim text-[9px] mt-2 text-center">
                                Canvas-driven — delete the connection on the canvas to remove
                              </Text>
                            )}
                          </View>
                        )}
                      </View>
                    );
                  });
                })()}
              </Section>

              <View className="h-20" />
            </ScrollView>

            {/* Footer Actions */}
            <View className="p-6 border-t border-surface-border bg-surface-background/50 gap-3">
               <TouchableOpacity 
                 onPress={handleSave}
                 disabled={loading || !formState.name}
                 className={`w-full py-3 rounded-xl items-center shadow-lg transition-all active:scale-[0.98] ${formState.name ? 'bg-brand-primary hover:bg-brand-primary-hover active:bg-brand-primary-active' : 'bg-brand-primary/20 opacity-50'}`}
               >
                 {loading ? <ActivityIndicator color="white" /> : (
                   <Text className="text-white font-black uppercase tracking-widest text-xs">
                     {editingStageId ? 'Update Stage' : 'Create Stage'}
                   </Text>
                 )}
               </TouchableOpacity>

               {editingStageId && (
                 <TouchableOpacity 
                   onPress={() => handleDelete(editingStageId)}
                   disabled={loading}
                   className="w-full py-3 rounded-xl items-center border border-state-danger bg-state-danger/5 hover:bg-state-danger/10 transition-all active:scale-[0.98]"
                 >
                   <Text className="text-state-danger font-black uppercase tracking-widest text-[10px]">
                     Delete Stage
                   </Text>
                 </TouchableOpacity>
               )}
            </View>
          </View>
        )}

        {/* Transition Editor Panel */}
        {editingTransitionId && (
          <View className="w-96 bg-surface-card border-l border-surface-border shadow-2xl">
            <View className="px-6 py-4 border-b border-surface-border flex-row justify-between items-center bg-surface-background/50">
              <Text className="text-typography-main font-black uppercase tracking-widest text-xs">
                Edit Connection
              </Text>
              <TouchableOpacity 
                onPress={() => setEditingTransitionId(null)}
                className="p-2 hover:bg-surface-overlay rounded-lg transition-all"
              >
                 <FontAwesome name="times" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <ScrollView className="p-6">
              <Section label="Display">
                <Input 
                  label="Label / Action Name"
                  placeholder="e.g. APPROVE"
                  value={transForm.label}
                  onChangeText={(val: string) => setTransForm(prev => ({ ...prev, label: val }))}
                />
                <Text className="text-typography-muted text-[10px] leading-relaxed mb-4">
                  This label appears on the transition line and is often used as the button text for users in this stage.
                </Text>
              </Section>

              <Section label="Logic & Security">
                <Text className="text-typography-muted text-[10px] font-bold uppercase mb-1.5">Required Permission</Text>
                <TouchableOpacity
                  onPress={() => setShowPermPicker(!showPermPicker)}
                  className="bg-surface-background px-4 py-3 rounded-lg border border-surface-border mb-2 flex-row items-center justify-between hover:border-brand-primary/40 transition-all"
                >
                  <Text className={`text-sm ${transForm.required_permission ? 'text-typography-main font-bold' : 'text-typography-dim'}`}>
                    {transForm.required_permission ? (permissions.find(p => p.key === transForm.required_permission)?.label || transForm.required_permission) : 'Anyone can trigger'}
                  </Text>
                  <FontAwesome name={showPermPicker ? 'chevron-up' : 'chevron-down'} size={10} color={colors.textDim} />
                </TouchableOpacity>

                {showPermPicker && (
                  <View className="bg-surface-background border border-surface-border rounded-lg mb-4 max-h-48 overflow-hidden shadow-xl">
                    <ScrollView nestedScrollEnabled>
                      <TouchableOpacity
                        onPress={() => { setTransForm(prev => ({ ...prev, required_permission: '' })); setShowPermPicker(false); }}
                        className="px-4 py-3 border-b border-surface-border hover:bg-surface-overlay transition-all"
                      >
                        <Text className="text-typography-muted text-xs italic">No restriction (anyone)</Text>
                      </TouchableOpacity>
                      {permissions.map(p => (
                        <TouchableOpacity
                          key={p.key}
                          onPress={() => { setTransForm(prev => ({ ...prev, required_permission: p.key })); setShowPermPicker(false); }}
                          className={`px-4 py-3 border-b border-surface-border hover:bg-surface-overlay transition-all ${transForm.required_permission === p.key ? 'bg-brand-primary/10' : ''}`}
                        >
                          <Text className="text-typography-main text-sm font-medium">{p.label}</Text>
                          <Text className="text-typography-dim text-[10px]">{p.key}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                )}

                <Text className="text-typography-muted text-[10px] font-bold uppercase mb-1.5 mt-4">Visual Style</Text>
                <View className="flex-row gap-2 mb-4">
                  {[
                    { id: 'neutral', icon: 'circle-o', color: colors.textMuted },
                    { id: 'success', icon: 'check-circle', color: colors.success },
                    { id: 'warning', icon: 'exclamation-circle', color: colors.warning },
                    { id: 'danger', icon: 'times-circle', color: colors.danger }
                  ].map(t => (
                    <TouchableOpacity
                      key={t.id}
                      onPress={() => setTransForm(prev => ({ ...prev, transition_type: t.id }))}
                      className={`flex-1 p-3 rounded-xl border items-center justify-center transition-all ${transForm.transition_type === t.id ? 'border-brand-primary bg-brand-primary/10' : 'border-surface-border bg-surface-background'}`}
                    >
                      <FontAwesome name={t.icon as any} size={14} color={t.color} />
                      <Text className={`text-[10px] font-bold mt-1 capitalize ${transForm.transition_type === t.id ? 'text-brand-primary' : 'text-typography-dim'}`}>
                        {t.id}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View className="bg-brand-primary/5 p-4 rounded-xl border border-brand-primary/20">
                   <View className="flex-row items-center gap-2 mb-2">
                      <FontAwesome name="info-circle" size={14} color={colors.primary} />
                      <Text className="text-brand-primary font-bold text-xs">Branching Logic</Text>
                   </View>
                   <Text className="text-typography-muted text-[10px] leading-tight">
                     If a stage has multiple output lines, the system follows the one matching the user's clicked **Action** or the first **Automation** rule that evaluates to true.
                   </Text>
                </View>
              </Section>
            </ScrollView>

            <View className="p-6 border-t border-surface-border bg-surface-background/50 gap-3">
               <TouchableOpacity 
                 onPress={handleTransSave}
                 disabled={loading}
                 className="w-full py-3 rounded-xl items-center bg-brand-primary hover:bg-brand-primary-hover active:bg-brand-primary-active shadow-lg transition-all active:scale-[0.98]"
               >
                 {loading ? <ActivityIndicator color="white" /> : (
                   <Text className="text-white font-black uppercase tracking-widest text-xs">
                     Update Connection
                   </Text>
                 )}
               </TouchableOpacity>

               <TouchableOpacity 
                 onPress={() => { deleteTransition(editingTransitionId); setEditingTransitionId(null); }}
                 disabled={loading}
                 className="w-full py-3 rounded-xl items-center border border-state-danger bg-state-danger/5 hover:bg-state-danger/10 transition-all active:scale-[0.98]"
               >
                 <Text className="text-state-danger font-black uppercase tracking-widest text-[10px]">
                   Remove Connection
                 </Text>
               </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

function Section({ label, children, last }: { label: string, children: any, last?: boolean }) {
  const colors = useThemeColors();
  return (
    <View className={`mb-8 ${last ? '' : 'border-b border-surface-border pb-6'}`}>
      <Text className="text-typography-label text-[10px] font-black uppercase tracking-tighter mb-4 opacity-50">{label}</Text>
      {children}
    </View>
  );
}

function Input({ label, ...props }: any) {
  const colors = useThemeColors();
  return (
    <View className="mb-4">
      <Text className="text-typography-muted text-[10px] font-bold uppercase mb-1">{label}</Text>
      <TextInput 
        className="bg-surface-background border border-surface-border p-3 rounded-lg text-typography-main text-sm focus:border-brand-primary/40 transition-all"
        placeholderTextColor={colors.textDim}
        {...props}
      />
    </View>
  );
}

function Toggle({ label, desc, active, onToggle }: any) {
  const colors = useThemeColors();
  return (
    <View className="flex-row items-center justify-between mb-4">
      <View className="flex-1 pr-4">
        <Text className="text-typography-main font-bold text-sm">{label}</Text>
        <Text className="text-typography-muted text-[10px] leading-tight">{desc}</Text>
      </View>
      <Switch 
        value={active}
        onValueChange={onToggle}
        trackColor={{ false: '#334155', true: colors.primary }}
        thumbColor="white"
      />
    </View>
  );
}
