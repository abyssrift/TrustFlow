import React, { useState, useMemo } from 'react';
import { View, Text, TouchableOpacity, TextInput, ActivityIndicator, Alert, ScrollView, Switch } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { usePipelineEditor, Stage } from '@/contexts/PipelineEditorContext';
import GraphCanvas from './graph/GraphCanvas';

const COLOR_PALETTE = [
  '#64748b', '#3b82f6', '#6366f1', '#8b5cf6',
  '#ec4899', '#ef4444', '#f59e0b', '#fbbf24',
  '#22c55e', '#14b8a6', '#06b6d4', '#f97316',
];

export default function StageBuilder() {
  const {
    stages, loading, error, pipelines, isOperationInFlight,
    addStage, updateStage, deleteStage, reorderStages,
    selectedPipeline,
  } = usePipelineEditor();

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingStageId, setEditingStageId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'graph' | 'list'>('graph');

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
    use_business_hours: false,
    linked_pipeline_id: null as string | null,
    manager_routing_rule: 'INHERIT',
    max_escalation_depth: 3,
  });

  const resetForm = () => {
    setFormState({
      name: '',
      color: '#64748b',
      description: '',
      is_initial: false,
      is_terminal: false,
      terminal_type: '',
      requires_submission: false,
      requires_timer: false,
      use_business_hours: false,
      linked_pipeline_id: null,
      manager_routing_rule: 'INHERIT',
      max_escalation_depth: 3,
    });
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
      use_business_hours: s.use_business_hours,
      linked_pipeline_id: s.linked_pipeline_id,
      manager_routing_rule: s.manager_routing_rule || 'INHERIT',
      max_escalation_depth: s.max_escalation_depth || 3,
    });
  };

  const handleSave = async () => {
    if (!formState.name.trim()) return;
    
    const payload = {
      ...formState,
      name: formState.name.trim().toUpperCase(),
      terminal_type: formState.is_terminal ? (formState.terminal_type || 'success') : null,
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

  const handleDelete = (id: string) => {
    Alert.alert(
      'Delete Stage',
      'Are you sure? This will remove all transitions and metadata associated with this stage.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => deleteStage(id) }
      ]
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
              className={`px-3 py-1.5 rounded-lg flex-row items-center gap-2 ${viewMode === 'graph' ? 'bg-brand-primary' : ''}`}
            ><FontAwesome name="th-large" size={12} color={viewMode === 'graph' ? 'white' : '#94a3b8'} /><Text className={`text-xs font-bold ${viewMode === 'graph' ? 'text-white' : 'text-typography-muted'}`}>Canvas</Text></TouchableOpacity>
            <TouchableOpacity 
              onPress={() => setViewMode('list')}
              className={`px-3 py-1.5 rounded-lg flex-row items-center gap-2 ${viewMode === 'list' ? 'bg-brand-primary' : ''}`}
            ><FontAwesome name="list" size={12} color={viewMode === 'list' ? 'white' : '#94a3b8'} /><Text className={`text-xs font-bold ${viewMode === 'list' ? 'text-white' : 'text-typography-muted'}`}>List</Text></TouchableOpacity>
          </View>

          <TouchableOpacity
            onPress={() => { resetForm(); setShowAddForm(true); }}
            className="bg-brand-primary px-4 py-2 rounded-xl flex-row items-center gap-2 shadow-lg"
          ><FontAwesome name="plus" size={12} color="white" /><Text className="text-white font-black text-xs uppercase tracking-wider">Add Stage</Text></TouchableOpacity>
        </View>
      </View>

      {/* Main Content */}
      <View className="flex-1 flex-row">
        <View className="flex-1 overflow-hidden">
          {viewMode === 'graph' ? (
            <GraphCanvas 
              onEditStage={(s) => { populateForm(s); setEditingStageId(s.id); }}
              onDeleteStage={handleDelete}
            />
          ) : (
            <ScrollView className="p-6">
               {stages.map((s) => (
                 <TouchableOpacity 
                   key={s.id}
                   onPress={() => { populateForm(s); setEditingStageId(s.id); }}
                   className="bg-surface-card border border-surface-border p-4 rounded-2xl mb-3 flex-row items-center justify-between"
                 >
                   <View className="flex-row items-center gap-4">
                     <View className="w-10 h-10 rounded-xl items-center justify-center" style={{ backgroundColor: s.color || '#64748b' }}>
                        <Text className="text-white font-black">{s.position}</Text>
                     </View>
                     <View>
                        <Text className="text-typography-main font-bold">{s.name}</Text>
                        <Text className="text-typography-muted text-xs">{s.description || 'No description'}</Text>
                     </View>
                   </View>
                   <FontAwesome name="chevron-right" size={12} color="rgb(var(--text-muted))" />
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
              <TouchableOpacity onPress={() => { setEditingStageId(null); setShowAddForm(false); }}>
                 <FontAwesome name="times" size={16} color="rgb(var(--text-muted))" />
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
                      className={`w-8 h-8 rounded-lg border-2 ${formState.color === c ? 'border-typography-main' : 'border-transparent'}`}
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
              </Section>

              {/* Time Management */}
              <Section label="Time Management">
                 <Toggle 
                    label="Focus Timer"
                    desc="Task requires active work session"
                    active={formState.requires_timer}
                    onToggle={(val: boolean) => setFormState(prev => ({ ...prev, requires_timer: val }))}
                 />
                 <Toggle 
                    label="Business Hours"
                    desc="Only count official working time"
                    active={formState.use_business_hours}
                    onToggle={(val: boolean) => setFormState(prev => ({ ...prev, use_business_hours: val }))}
                 />
              </Section>

              {/* Advanced Routing */}
              <Section label="SLA & Escalation" last>
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

              <View className="h-20" />
            </ScrollView>

            {/* Footer Actions */}
            <View className="p-6 border-t border-surface-border bg-surface-background/50 flex-row gap-3">
               <TouchableOpacity 
                 onPress={handleSave}
                 disabled={loading || !formState.name}
                 className={`flex-1 py-3 rounded-xl items-center shadow-lg ${formState.name ? 'bg-brand-primary' : 'bg-brand-primary-disabled'}`}
               >
                 {loading ? <ActivityIndicator color="white" /> : (
                   <Text className="text-white font-black uppercase tracking-widest text-xs">
                     {editingStageId ? 'Update Stage' : 'Create Stage'}
                   </Text>
                 )}
               </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

function Section({ label, children, last }: { label: string, children: any, last?: boolean }) {
  return (
    <View className={`mb-8 ${last ? '' : 'border-b border-surface-border pb-6'}`}>
      <Text className="text-typography-label text-[10px] font-black uppercase tracking-tighter mb-4 opacity-50">{label}</Text>
      {children}
    </View>
  );
}

function Input({ label, ...props }: any) {
  return (
    <View className="mb-4">
      <Text className="text-typography-muted text-[10px] font-bold uppercase mb-1">{label}</Text>
      <TextInput 
        className="bg-surface-background border border-surface-border p-3 rounded-lg text-typography-main text-sm"
        placeholderTextColor="#64748b"
        {...props}
      />
    </View>
  );
}

function Toggle({ label, desc, active, onToggle }: any) {
  return (
    <View className="flex-row items-center justify-between mb-4">
      <View className="flex-1 pr-4">
        <Text className="text-typography-main font-bold text-sm">{label}</Text>
        <Text className="text-typography-muted text-[10px] leading-tight">{desc}</Text>
      </View>
      <Switch 
        value={active}
        onValueChange={onToggle}
        trackColor={{ false: '#334155', true: 'rgb(var(--brand-primary))' }}
        thumbColor="white"
      />
    </View>
  );
}
