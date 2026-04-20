import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, ActivityIndicator } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { usePipelineEditor } from '@/contexts/PipelineEditorContext';

const CONDITION_TYPES = [
  { value: 'overdue', label: 'Overdue', desc: 'Task past its due date', icon: 'clock-o', color: '#ef4444' },
  { value: 'idle', label: 'Idle', desc: 'Task not updated for X hours', icon: 'pause-circle', color: '#f59e0b' },
  { value: 'due_soon', label: 'Due Soon', desc: 'Task approaching due date', icon: 'bell', color: '#3b82f6' },
];

export default function AutomationEditor() {
  const {
    stages, automations, loading, error,
    createAutomation, updateAutomation, deleteAutomation,
  } = usePipelineEditor();

  const [showAdd, setShowAdd] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Form state
  const [formSource, setFormSource] = useState('');
  const [formTarget, setFormTarget] = useState('');
  const [formCondition, setFormCondition] = useState('overdue');
  const [formInterval, setFormInterval] = useState(60);
  const [formPriority, setFormPriority] = useState(0);
  const [formIdleHours, setFormIdleHours] = useState('24');
  const [formBufferMins, setFormBufferMins] = useState('0');

  const resetForm = () => {
    setFormSource('');
    setFormTarget('');
    setFormCondition('overdue');
    setFormInterval(60);
    setFormPriority(0);
    setFormIdleHours('24');
    setFormBufferMins('0');
  };

  const stageName = (id: string) => stages.find(s => s.id === id)?.name || '—';
  const stageColor = (id: string) => stages.find(s => s.id === id)?.color || '#6B7280';

  const handleCreate = async () => {
    if (!formSource || !formTarget) return;
    const params: Record<string, string> = {};
    if (formCondition === 'idle') params.idle_hours = formIdleHours;
    if (formCondition === 'overdue' || formCondition === 'due_soon') params.buffer_minutes = formBufferMins;

    await createAutomation({
      source_stage_id: formSource,
      target_stage_id: formTarget,
      condition_type: formCondition,
      check_interval_minutes: formInterval,
      priority: formPriority,
      params,
    });
    resetForm();
    setShowAdd(false);
  };

  const handleToggleActive = async (a: typeof automations[0]) => {
    await updateAutomation(a.id, { is_active: !a.is_active });
  };

  const handleDelete = async (id: string) => {
    await deleteAutomation(id);
    setConfirmDeleteId(null);
  };

  const conditionInfo = (type: string) => CONDITION_TYPES.find(c => c.value === type) || CONDITION_TYPES[0];

  return (
    <View className="flex-1">
      <View className="flex-row items-center justify-between mb-4">
        <View>
          <Text className="text-typography-main text-lg font-black">Automations</Text>
          <Text className="text-typography-muted text-xs">
            {automations.length} rule{automations.length !== 1 ? 's' : ''} • Heartbeat: 1 min
          </Text>
        </View>
        {!showAdd && (
          <TouchableOpacity
            onPress={() => { resetForm(); setShowAdd(true); }}
            className="bg-brand-primary-dim px-4 py-2 rounded-xl border border-brand-primary/20 active:bg-brand-primary-dim active:scale-95 transition-all"
          >
            <View className="flex-row items-center">
              <FontAwesome name="plus" size={10} color="rgb(var(--brand-primary))" />
              <Text className="text-brand-primary font-bold text-xs ml-2 uppercase tracking-wide">Add Rule</Text>
            </View>
          </TouchableOpacity>
        )}
      </View>

      {error && (
        <View className="bg-state-danger-dim border border-state-danger/20 p-3 rounded-xl mb-3">
          <Text className="text-state-danger text-sm font-bold">{error}</Text>
        </View>
      )}

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Add Form */}
        {showAdd && (
          <View className="bg-surface-card p-4 rounded-2xl border border-brand-primary/40 mb-4">
            <Text className="text-typography-main font-bold text-base mb-4">New Automation Rule</Text>

            {/* Condition Type */}
            <Text className="text-typography-label text-[10px] font-bold uppercase tracking-wider mb-2">Condition</Text>
            <View className="gap-2 mb-4">
              {CONDITION_TYPES.map(ct => (
                <TouchableOpacity
                  key={ct.value}
                  onPress={() => setFormCondition(ct.value)}
                  className={`flex-row items-center p-3 rounded-xl border ${formCondition === ct.value ? 'bg-brand-primary-dim border-brand-primary/30' : 'border-surface-border bg-surface-background'}`}
                >
                  <View className="w-8 h-8 rounded-lg items-center justify-center mr-3" style={{ backgroundColor: ct.color, opacity: 0.2 }}>
                    <FontAwesome name={ct.icon as any} size={14} color={ct.color} />
                  </View>
                  <View className="flex-1">
                    <Text className={`font-bold text-sm ${formCondition === ct.value ? 'text-typography-main' : 'text-typography-muted'}`}>
                      {ct.label}
                    </Text>
                    <Text className="text-typography-dim text-[10px]">{ct.desc}</Text>
                  </View>
                  <View className={`w-5 h-5 rounded-full border-2 items-center justify-center ${formCondition === ct.value ? 'bg-brand-primary border-brand-primary' : 'border-surface-border'}`}>
                    {formCondition === ct.value && <View className="w-2 h-2 rounded-full bg-white" />}
                  </View>
                </TouchableOpacity>
              ))}
            </View>

            {/* Source & Target Stages */}
            <View className="flex-row gap-3 mb-4">
              <View className="flex-1">
                <Text className="text-typography-label text-[10px] font-bold uppercase tracking-wider mb-2">When in stage</Text>
                <View className="gap-1.5">
                  {stages.filter(s => !s.is_terminal).map(s => (
                    <TouchableOpacity
                      key={s.id}
                      onPress={() => setFormSource(s.id)}
                      className={`px-3 py-2 rounded-lg border ${formSource === s.id ? 'bg-brand-primary-dim border-brand-primary/30' : 'border-surface-border bg-surface-background'}`}
                    >
                      <View className="flex-row items-center">
                        <View className="w-2 h-2 rounded-full mr-2" style={{ backgroundColor: s.color || '#6B7280' }} />
                        <Text className={`text-xs font-bold ${formSource === s.id ? 'text-brand-primary' : 'text-typography-muted'}`}>
                          {s.name}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              <View className="flex-1">
                <Text className="text-typography-label text-[10px] font-bold uppercase tracking-wider mb-2">Move to stage</Text>
                <View className="gap-1.5">
                  {stages.filter(s => s.id !== formSource).map(s => (
                    <TouchableOpacity
                      key={s.id}
                      onPress={() => setFormTarget(s.id)}
                      className={`px-3 py-2 rounded-lg border ${formTarget === s.id ? 'bg-brand-primary-dim border-brand-primary/30' : 'border-surface-border bg-surface-background'}`}
                    >
                      <View className="flex-row items-center">
                        <View className="w-2 h-2 rounded-full mr-2" style={{ backgroundColor: s.color || '#6B7280' }} />
                        <Text className={`text-xs font-bold ${formTarget === s.id ? 'text-brand-primary' : 'text-typography-muted'}`}>
                          {s.name}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>

            {/* Condition Params */}
            {formCondition === 'idle' && (
              <View className="mb-4">
                <Text className="text-typography-label text-[10px] font-bold uppercase tracking-wider mb-1.5">Idle Threshold (hours)</Text>
                <View className="flex-row items-center bg-surface-background rounded-lg border border-surface-border px-3 py-2">
                  <TouchableOpacity onPress={() => setFormIdleHours(String(Math.max(1, parseInt(formIdleHours) - 1)))}>
                    <FontAwesome name="minus-circle" size={16} color="#64748b" />
                  </TouchableOpacity>
                  <Text className="mx-4 text-typography-main font-bold text-lg">{formIdleHours}h</Text>
                  <TouchableOpacity onPress={() => setFormIdleHours(String(parseInt(formIdleHours) + 1))}>
                    <FontAwesome name="plus-circle" size={16} color="#64748b" />
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {(formCondition === 'overdue' || formCondition === 'due_soon') && (
              <View className="mb-4">
                <Text className="text-typography-label text-[10px] font-bold uppercase tracking-wider mb-1.5">Buffer (minutes)</Text>
                <View className="flex-row items-center bg-surface-background rounded-lg border border-surface-border px-3 py-2">
                  <TouchableOpacity onPress={() => setFormBufferMins(String(Math.max(0, parseInt(formBufferMins) - 5)))}>
                    <FontAwesome name="minus-circle" size={16} color="#64748b" />
                  </TouchableOpacity>
                  <Text className="mx-4 text-typography-main font-bold text-lg">{formBufferMins}m</Text>
                  <TouchableOpacity onPress={() => setFormBufferMins(String(parseInt(formBufferMins) + 5))}>
                    <FontAwesome name="plus-circle" size={16} color="#64748b" />
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Interval & Priority */}
            <View className="flex-row gap-3 mb-4">
              <View className="flex-1">
                <Text className="text-typography-label text-[10px] font-bold uppercase tracking-wider mb-1.5">Check Every</Text>
                <View className="flex-row items-center bg-surface-background rounded-lg border border-surface-border px-3 py-2">
                  <TouchableOpacity onPress={() => setFormInterval(Math.max(1, formInterval - 10))}>
                    <FontAwesome name="minus-circle" size={14} color="#64748b" />
                  </TouchableOpacity>
                  <Text className="mx-3 text-typography-main font-bold">{formInterval}m</Text>
                  <TouchableOpacity onPress={() => setFormInterval(formInterval + 10)}>
                    <FontAwesome name="plus-circle" size={14} color="#64748b" />
                  </TouchableOpacity>
                </View>
              </View>
              <View className="flex-1">
                <Text className="text-typography-label text-[10px] font-bold uppercase tracking-wider mb-1.5">Priority</Text>
                <View className="flex-row items-center bg-surface-background rounded-lg border border-surface-border px-3 py-2">
                  <TouchableOpacity onPress={() => setFormPriority(Math.max(0, formPriority - 1))}>
                    <FontAwesome name="minus-circle" size={14} color="#64748b" />
                  </TouchableOpacity>
                  <Text className="mx-3 text-typography-main font-bold">{formPriority}</Text>
                  <TouchableOpacity onPress={() => setFormPriority(formPriority + 1)}>
                    <FontAwesome name="plus-circle" size={14} color="#64748b" />
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            <View className="flex-row gap-3">
              <TouchableOpacity
                onPress={() => { setShowAdd(false); resetForm(); }}
                className="flex-1 bg-surface-background py-3 rounded-xl border border-surface-border items-center h-12 justify-center"
              >
                <Text className="text-typography-muted font-bold text-sm">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleCreate}
                className="flex-1 bg-brand-primary py-3 rounded-xl items-center h-12 justify-center"
                disabled={!formSource || !formTarget || loading}
              >
                {loading ? (
                  <ActivityIndicator color="rgb(var(--text-main))" size="small" />
                ) : (
                  <Text className="text-typography-main font-black text-sm uppercase tracking-wide">Create Rule</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Automation Cards */}
        {automations.map(a => {
          const cInfo = conditionInfo(a.condition_type);
          return (
            <View key={a.id}>
              {confirmDeleteId === a.id ? (
                <View className="bg-surface-card p-3 rounded-2xl border border-state-danger/40 mb-3">
                  <Text className="text-typography-main text-sm font-bold mb-2">Delete this automation rule?</Text>
                  <View className="flex-row gap-3">
                    <TouchableOpacity
                      onPress={() => setConfirmDeleteId(null)}
                      className="flex-1 bg-surface-background py-2 rounded-xl border border-surface-border items-center"
                    >
                      <Text className="text-typography-muted font-bold text-xs">Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => handleDelete(a.id)}
                      className="flex-1 bg-state-danger py-2 rounded-xl items-center"
                    >
                      <Text className="text-white font-bold text-xs">Delete</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <View className={`bg-surface-card p-4 rounded-2xl border mb-3 ${a.is_active ? 'border-surface-border' : 'border-state-warning/30 opacity-60'}`}>
                  <View className="flex-row items-center mb-3">
                    {/* Condition Badge */}
                    <View className="w-9 h-9 rounded-xl items-center justify-center mr-3" style={{ backgroundColor: cInfo.color + '20' }}>
                      <FontAwesome name={cInfo.icon as any} size={16} color={cInfo.color} />
                    </View>

                    <View className="flex-1">
                      <View className="flex-row items-center gap-2 flex-wrap">
                        <Text className="text-typography-main font-bold text-sm">{cInfo.label}</Text>
                        {!a.is_active && (
                          <View className="bg-state-warning-dim px-1.5 py-0.5 rounded border border-state-warning/20">
                            <Text className="text-state-warning text-[8px] font-black uppercase">Paused</Text>
                          </View>
                        )}
                        {a.failure_count > 0 && (
                          <View className="bg-state-danger-dim px-1.5 py-0.5 rounded border border-state-danger/20">
                            <Text className="text-state-danger text-[8px] font-black uppercase">{a.failure_count} fails</Text>
                          </View>
                        )}
                      </View>
                      <View className="flex-row items-center mt-0.5">
                        <View className="w-2 h-2 rounded-full mr-1" style={{ backgroundColor: stageColor(a.source_stage_id) }} />
                        <Text className="text-typography-dim text-[10px] font-bold">{stageName(a.source_stage_id)}</Text>
                        <FontAwesome name="long-arrow-right" size={8} color="#334155" style={{ marginHorizontal: 4 }} />
                        <View className="w-2 h-2 rounded-full mr-1" style={{ backgroundColor: stageColor(a.target_stage_id) }} />
                        <Text className="text-typography-dim text-[10px] font-bold">{stageName(a.target_stage_id)}</Text>
                      </View>
                    </View>

                    {/* Actions */}
                    <View className="flex-row items-center gap-2">
                      <TouchableOpacity
                        onPress={() => handleToggleActive(a)}
                        className={`w-10 h-6 rounded-full flex-row items-center px-0.5 ${a.is_active ? 'bg-brand-primary justify-end' : 'bg-surface-overlay justify-start'}`}
                      >
                        <View className="w-5 h-5 rounded-full bg-white" />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => setConfirmDeleteId(a.id)}
                        className="p-2 rounded-lg border border-surface-border bg-surface-background"
                      >
                        <FontAwesome name="trash-o" size={10} color="#64748b" />
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* Params summary */}
                  <View className="flex-row gap-3 flex-wrap">
                    <View className="bg-surface-background px-2.5 py-1.5 rounded-lg border border-surface-border">
                      <Text className="text-typography-dim text-[9px] uppercase font-bold">Interval</Text>
                      <Text className="text-typography-main text-xs font-bold">{a.check_interval_minutes}m</Text>
                    </View>
                    <View className="bg-surface-background px-2.5 py-1.5 rounded-lg border border-surface-border">
                      <Text className="text-typography-dim text-[9px] uppercase font-bold">Priority</Text>
                      <Text className="text-typography-main text-xs font-bold">{a.priority}</Text>
                    </View>
                    {a.params && Object.entries(a.params).map(([k, v]) => (
                      <View key={k} className="bg-surface-background px-2.5 py-1.5 rounded-lg border border-surface-border">
                        <Text className="text-typography-dim text-[9px] uppercase font-bold">{k.replace('_', ' ')}</Text>
                        <Text className="text-typography-main text-xs font-bold">{v}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </View>
          );
        })}

        {automations.length === 0 && !showAdd && (
          <View className="py-16 items-center">
            <FontAwesome name="bolt" size={40} color="#1e293b" />
            <Text className="text-typography-muted text-base font-bold mt-4">No Automation Rules</Text>
            <Text className="text-typography-dim text-sm mt-1 text-center px-8">
              Create rules to automatically move tasks when conditions like overdue or idle are met.
            </Text>
          </View>
        )}
        <View className="h-20" />
      </ScrollView>
    </View>
  );
}
