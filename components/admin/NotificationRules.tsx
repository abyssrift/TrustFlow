import { useAlert } from '@/contexts/AlertContext';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { supabase } from '@/lib/supabase';
import { FontAwesome } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Modal,
    ScrollView,
    Switch,
    Text,
    TextInput,
    TouchableOpacity,
    useWindowDimensions,
    View,
} from 'react-native';

// Types and Constants
type NotificationRule = {
  id: string;
  name: string;
  description: string | null;
  event_type: string;
  recipient_strategies: string[];
  is_active: boolean;
  created_at: string;
};

const EVENT_META: Record<string, { label: string; cat: string; icon: any; colorKey: any }> = {
  'task.assigned': { label: 'Task Assigned', cat: 'Tasks', icon: 'user-plus', colorKey: 'primary' },
  'task.commented': { label: 'New Comment', cat: 'Comments', icon: 'comment', colorKey: 'warning' },
  'task.due_soon': { label: 'Due Soon', cat: 'Deadlines', icon: 'clock-o', colorKey: 'danger' },
  'task.mentioned': { label: 'Mention', cat: 'Comments', icon: 'at', colorKey: 'warning' },
  'task.overdue': { label: 'Task Overdue', cat: 'Deadlines', icon: 'exclamation-circle', colorKey: 'danger' },
};

const STRATEGY_LABELS: Record<string, string> = {
  assignee: 'Assignees',
  task_owner: 'Owner',
  watchers: 'Watchers',
  specific_users: 'Specific Users',
};

const EVENT_TYPE_LABELS = {
  'task.assigned': { label: 'Task Assigned', category: 'Tasks' },
  'task.commented': { label: 'New Comment', category: 'Comments' },
  'task.due_soon': { label: 'Due Soon', category: 'Deadlines' },
  'task.mentioned': { label: 'User Mentioned', category: 'Comments' },
  'task.overdue': { label: 'Task Overdue', category: 'Deadlines' },
};

// ── Create Rule Modal ────────────────────────────────────────────────────────
type CreateRuleModalProps = {
  visible: boolean;
  onClose: () => void;
  onCreated: () => void;
};

function CreateRuleModal({ visible, onClose, onCreated }: CreateRuleModalProps) {
  const { showAlert } = useAlert();
  const colors = useThemeColors();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [eventType, setEventType] = useState('task.assigned');
  const [strategies, setStrategies] = useState<string[]>(['assignee']);
  const [saving, setSaving] = useState(false);

  const knownEventTypes = Object.keys(EVENT_META);
  const availableStrategies = Object.keys(STRATEGY_LABELS);

  const toggleStrategy = (s: string) => {
    setStrategies((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );
  };

  const submit = async () => {
    if (!name.trim()) {
      showAlert('Validation', 'Rule name is required.');
      return;
    }
    if (strategies.length === 0) {
      showAlert('Validation', 'Select at least one recipient strategy.');
      return;
    }
    setSaving(true);
    const { error } = await supabase.rpc('rpc_create_notification_rule', {
      p_name: name.trim(),
      p_description: description.trim() || null,
      p_event_type: eventType,
      p_conditions: {},
      p_recipient_strategies: strategies,
      p_recipient_config: {},
      p_channels_override: null,
    });
    setSaving(false);
    if (error) {
      showAlert('Error', error.message || 'Failed to create rule.');
    } else {
      setName('');
      setDescription('');
      setEventType('task.assigned');
      setStrategies(['assignee']);
      onCreated();
      onClose();
    }
  };

  return (
    <Modal visible={visible} animationType="fade" transparent>
      <View className="flex-1 items-center justify-center bg-black/60 p-6">
        <View className="bg-surface-card w-full max-w-md rounded-3xl p-8 border border-surface-border shadow-2xl">
          <View className="flex-row items-center justify-between mb-8">
            <Text className="text-typography-main font-black text-2xl tracking-tight">New Rule</Text>
            <TouchableOpacity onPress={onClose} className="w-8 h-8 bg-surface-background rounded-full items-center justify-center border border-surface-border">
              <FontAwesome name="times" size={14} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          {/* Name */}
          <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-2">Rule Name *</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="e.g. Notify on Assignment"
            placeholderTextColor={colors.textDim}
            className="bg-surface-background border border-surface-border rounded-xl px-4 py-3.5 text-typography-main text-sm mb-5 focus:border-brand-primary"
          />

          {/* Event Type */}
          <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-2">Trigger Event</Text>
          <View className="flex-row flex-wrap gap-2 mb-5">
            {knownEventTypes.map((et) => (
              <TouchableOpacity
                key={et}
                onPress={() => setEventType(et)}
                className={`px-3 py-2 rounded-xl border ${
                  eventType === et ? 'bg-brand-primary border-brand-primary' : 'bg-surface-background border-surface-border'
                }`}
              >
                <Text className={`text-[10px] font-black ${eventType === et ? 'text-white' : 'text-typography-muted'}`}>
                  {EVENT_META[et]?.label ?? et}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Strategies */}
          <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-2">Notify Recipients</Text>
          <View className="flex-row flex-wrap gap-2 mb-8">
            {availableStrategies.map((s) => (
              <TouchableOpacity
                key={s}
                onPress={() => toggleStrategy(s)}
                className={`px-3 py-2 rounded-xl border ${
                  strategies.includes(s) ? 'bg-brand-primary/10 border-brand-primary' : 'bg-surface-background border-surface-border'
                }`}
              >
                <Text className={`text-[10px] font-black ${strategies.includes(s) ? 'text-brand-primary' : 'text-typography-muted'}`}>
                  {STRATEGY_LABELS[s]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity
            onPress={submit}
            disabled={saving}
            className="bg-brand-primary py-4 rounded-2xl items-center shadow-lg shadow-brand-primary/20"
          >
            {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text className="text-white font-black uppercase tracking-widest text-xs">Create Notification Rule</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ── Shared Sub-Components ───────────────────────────────────────────────────

const RuleListItem = ({ rule, isSelected, onSelect, onToggle }: { rule: NotificationRule, isSelected: boolean, onSelect: () => void, onToggle: any }) => {
  const colors = useThemeColors();
  const meta = EVENT_META[rule.event_type] || { label: rule.event_type, icon: 'bell', colorKey: 'textMuted' };
  return (
    <TouchableOpacity 
      onPress={onSelect}
      activeOpacity={0.7}
      className={`p-4 mb-2 rounded-xl border transition-all ${isSelected ? 'bg-brand-primary/10 border-brand-primary' : 'bg-surface-card border-surface-border hover:bg-surface-overlay'}`}
    >
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-3 flex-1">
          <View className={`w-8 h-8 rounded-lg items-center justify-center bg-surface-background border border-surface-border shadow-sm`}>
            <FontAwesome name={meta.icon} size={14} color={rule.is_active ? (colors[meta.colorKey] || colors.primary) : colors.textMuted} />
          </View>
          <View className="flex-1">
            <Text className={`font-black text-sm truncate ${isSelected ? 'text-typography-main' : 'text-typography-muted'}`}>{rule.name}</Text>
            <Text className="text-[10px] text-typography-muted uppercase tracking-widest">{meta.label}</Text>
          </View>
        </View>
        <Switch 
          value={rule.is_active} 
          onValueChange={(v) => onToggle(rule.id, v)}
          trackColor={{ false: colors.border, true: colors.primary }}
          thumbColor="#fff"
          style={{ transform: [{ scaleX: 0.75 }, { scaleY: 0.75 }] }}
        />
      </View>
    </TouchableOpacity>
  );
};

const RuleInspector = ({ rule, onToggle }: { rule: NotificationRule | null, onToggle: any }) => {
  const colors = useThemeColors();
  const [activeTab, setActiveTab] = useState<'config' | 'test' | 'logs'>('config');
  const [testing, setTesting] = useState(false);
  const [testLogs, setTestLogs] = useState<string[]>([]);
  const [testSummary, setTestSummary] = useState<{ matchedRules?: number; recipients?: string[] } | null>(null);
  const [simTaskId, setSimTaskId] = useState<string>('');
  const [simPipelineId, setSimPipelineId] = useState<string>('');
  const [simMentionedUserId, setSimMentionedUserId] = useState<string>('');

  if (!rule) return (
    <View className="flex-1 items-center justify-center p-12 bg-surface-background/30">
      <View className="bg-surface-card p-10 rounded-[40px] border border-dashed border-surface-border items-center">
        <View className="w-16 h-16 bg-surface-background rounded-full items-center justify-center mb-6">
          <FontAwesome name="mouse-pointer" size={24} color={colors.textMuted} />
        </View>
        <Text className="text-typography-main text-lg font-black tracking-tight">Select a Rule</Text>
        <Text className="text-typography-muted mt-2 text-center max-w-[200px] leading-5">Choose a rule from the left to view configuration and logs.</Text>
      </View>
    </View>
  );

  return (
    <View className="flex-1 bg-surface-card border-l border-surface-border">
      {/* Header */}
      <View className="p-8 border-b border-surface-border flex-row items-center justify-between bg-surface-background/50">
        <View className="flex-1 mr-4">
          <View className="flex-row items-center gap-2 mb-2">
            <View className="bg-brand-primary/10 px-2 py-0.5 rounded-md border border-brand-primary/20">
              <Text className="text-brand-primary text-[9px] font-black uppercase tracking-wider">{rule.event_type}</Text>
            </View>
            <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">• RULE ID {rule.id.slice(0,8)}</Text>
          </View>
          <Text className="text-typography-main text-4xl font-black tracking-tighter leading-none mb-2">{rule.name}</Text>
          <Text className="text-typography-muted text-sm font-medium">{rule.description || 'No additional details provided for this rule.'}</Text>
        </View>
        
        <View className="flex-row items-center gap-3">
          <View className="items-end mr-2">
            <Text className="text-typography-muted text-[9px] font-black uppercase mb-1">Status</Text>
            <View className="flex-row items-center gap-2">
              <Text className={`text-[11px] font-black ${rule.is_active ? 'text-state-success' : 'text-typography-muted'}`}>
                {rule.is_active ? 'ACTIVE' : 'PAUSED'}
              </Text>
              <Switch 
                value={rule.is_active} 
                onValueChange={(v) => onToggle(rule.id, v)}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor="#fff"
              />
            </View>
          </View>
          <TouchableOpacity className="bg-surface-background w-12 h-12 rounded-2xl border border-surface-border items-center justify-center hover:bg-state-danger/10">
            <FontAwesome name="trash" size={16} color={colors.danger} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Tabs */}
      <View className="flex-row px-8 border-b border-surface-border bg-surface-background/20">
        {['config', 'test', 'logs'].map((tab) => (
          <TouchableOpacity 
            key={tab} 
            onPress={() => setActiveTab(tab as any)}
            className={`py-5 mr-10 border-b-2 transition-all ${activeTab === tab ? 'border-brand-primary' : 'border-transparent'}`}
          >
            <View className="flex-row items-center gap-2">
              <FontAwesome 
                name={tab === 'config' ? 'sliders' : tab === 'test' ? 'flask' : 'history'} 
                size={12} 
                color={activeTab === tab ? colors.primary : colors.textMuted} 
              />
              <Text className={`font-black text-[11px] uppercase tracking-[0.15em] ${activeTab === tab ? 'text-typography-main' : 'text-typography-muted'}`}>
                {tab === 'config' ? 'Configuration' : tab === 'test' ? 'Playground' : 'Activity Logs'}
              </Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ padding: 32 }} showsVerticalScrollIndicator={false}>
        {activeTab === 'config' && (
          <View className="gap-8">
            <View className="bg-surface-background/50 p-6 rounded-3xl border border-surface-border">
              <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-4">Recipient Logic</Text>
              <View className="flex-row flex-wrap gap-3">
                {rule.recipient_strategies.map(s => (
                  <View key={s} className="bg-surface-card border border-surface-border px-5 py-3 rounded-2xl shadow-sm">
                    <View className="flex-row items-center gap-2">
                      <View className="w-1.5 h-1.5 rounded-full bg-brand-primary" />
                      <Text className="text-typography-main font-black text-sm">{STRATEGY_LABELS[s] || s}</Text>
                    </View>
                    <Text className="text-typography-muted text-[10px] mt-1 font-medium">Automatic Routing</Text>
                  </View>
                ))}
              </View>
            </View>

            <View className="flex-row gap-6">
               <View className="flex-1 bg-surface-background/50 p-6 rounded-3xl border border-surface-border">
                  <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-4">Conditions</Text>
                  <View className="items-center justify-center py-8">
                    <FontAwesome name="filter" size={24} color={colors.textMuted} className="opacity-20 mb-3" />
                    <Text className="text-typography-muted text-xs font-bold">No custom filters applied</Text>
                  </View>
               </View>
               <View className="flex-1 bg-surface-background/50 p-6 rounded-3xl border border-surface-border">
                  <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-4">Channels</Text>
                  <View className="flex-row gap-4">
                    <View className="items-center gap-2">
                      <View className="w-10 h-10 bg-brand-primary/10 rounded-xl items-center justify-center border border-brand-primary/20">
                        <FontAwesome name="envelope" size={14} color={colors.primary} />
                      </View>
                      <Text className="text-typography-main text-[10px] font-bold">Email</Text>
                    </View>
                    <View className="items-center gap-2">
                      <View className="w-10 h-10 bg-brand-primary/10 rounded-xl items-center justify-center border border-brand-primary/20">
                        <FontAwesome name="bell" size={14} color={colors.primary} />
                      </View>
                      <Text className="text-typography-main text-[10px] font-bold">In-App</Text>
                    </View>
                  </View>
               </View>
            </View>
          </View>
        )}

        {activeTab === 'test' && (
          <View>
            <View className="bg-surface-background p-8 rounded-[32px] border border-surface-border mb-8 overflow-hidden">
              <View className="absolute top-0 right-0 p-8 opacity-5">
                <FontAwesome name="flask" size={120} color={colors.primary} />
              </View>
              <Text className="text-typography-main text-xl font-black mb-2">Rule Simulator</Text>
              <Text className="text-typography-muted text-sm leading-6 max-w-md">
                Trigger a virtual <Text className="text-brand-primary font-black">{rule.event_type}</Text> event. This will simulate the notification flow without actually sending messages to users.
              </Text>
              
              <View className="mt-6">
                <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-2">Simulation Payload (dev)</Text>
                <View className="flex-row gap-2 mb-4">
                  <TextInput
                    placeholder="Task ID (optional)"
                    value={simTaskId}
                    onChangeText={setSimTaskId}
                    placeholderTextColor={colors.textDim}
                    className="flex-1 bg-surface-background border border-surface-border rounded-xl px-3 py-2 text-typography-main text-sm"
                  />
                  <TextInput
                    placeholder="Mentioned User ID (optional)"
                    value={simMentionedUserId}
                    onChangeText={setSimMentionedUserId}
                    placeholderTextColor={colors.textDim}
                    className="w-48 bg-surface-background border border-surface-border rounded-xl px-3 py-2 text-typography-main text-sm"
                  />
                </View>
                <TextInput
                  placeholder="Pipeline ID (optional)"
                  value={simPipelineId}
                  onChangeText={setSimPipelineId}
                  placeholderTextColor={colors.textDim}
                  className="mb-4 bg-surface-background border border-surface-border rounded-xl px-3 py-2 text-typography-main text-sm"
                />

                <TouchableOpacity 
                  onPress={async () => {
                  setTesting(true);
                  setTestLogs([]);
                  setTestSummary(null);
                  try {
                    // Run client-side detailed simulation (best-effort; some reads may be restricted by RLS)
                    const logs: string[] = [];
                    logs.push(`Starting simulation for event: ${rule.event_type}`);

                    // 1. Load rule details (we already have rule object)
                    logs.push(`Loaded rule: ${rule.name} (id=${rule.id})`);

                    // 2. Show conditions
                    logs.push(`Conditions: ${JSON.stringify(rule.conditions || {})}`);

                    // 2b. Determine event payload from user inputs or rule conditions
                    const payload: any = {};
                    const taskIdFromRule = (rule.conditions && (rule.conditions as any).task_id) || null;
                    const taskId = simTaskId || taskIdFromRule || null;
                    const pipelineId = simPipelineId || (rule.conditions && (rule.conditions as any).pipeline_id) || null;
                    const mentionedUserId = simMentionedUserId || null;
                    if (taskId) payload.task_id = taskId;
                    if (pipelineId) payload.pipeline_id = pipelineId;
                    if (mentionedUserId) payload.mentioned_user_id = mentionedUserId;
                    logs.push(`Using payload: ${JSON.stringify(payload)}`);

                    // 3. Attempt to resolve recipients per strategy
                    const resolved = new Set<string>();
                    for (const strategy of rule.recipient_strategies) {
                      logs.push(`Resolving strategy: ${strategy}`);
                      try {
                        if (strategy === 'specific_users') {
                          // Use recipient_config if present
                          const config = rule.recipient_config || {} as any;
                          const ids = (config.user_ids as string[] | undefined) || [];
                          if (ids.length) {
                            ids.forEach((id) => resolved.add(id));
                            logs.push(`  specific_users -> explicit ids: ${ids.join(', ')}`);
                          } else {
                            logs.push('  specific_users -> no explicit ids; would rely on event payload (server-only)');
                          }
                        } else if (strategy === 'assignee') {
                          // Try to read task_assignments for the entity_id if available in rule.conditions (best-effort)
                          const taskId = payload.task_id || (rule.conditions && (rule.conditions as any).task_id) || null;
                          if (!taskId) {
                            logs.push('  assignee -> no task_id available to resolve (client simulation requires a task id)');
                          } else {
                            const { data, error } = await supabase
                              .from('task_assignments')
                              .select('assignee_user_id')
                              .eq('task_id', taskId)
                              .not('assignee_user_id', 'is', null);
                            if (error) {
                              logs.push(`  assignee -> DB read failed: ${error.message}`);
                            } else {
                              const ids = (data ?? []).map((r: any) => r.assignee_user_id);
                              ids.forEach((id: string) => resolved.add(id));
                              logs.push(`  assignee -> resolved: ${ids.join(', ') || 'none'}`);
                            }
                          }
                        } else if (strategy === 'task_owner') {
                          const taskId = payload.task_id || (rule.conditions && (rule.conditions as any).task_id) || null;
                          if (!taskId) {
                            logs.push('  task_owner -> no task_id available to resolve');
                          } else {
                            const { data, error } = await supabase
                              .from('tasks')
                              .select('created_by')
                              .eq('id', taskId)
                              .single();
                            if (error) {
                              logs.push(`  task_owner -> DB read failed: ${error.message}`);
                            } else if (data?.created_by) {
                              resolved.add(data.created_by);
                              logs.push(`  task_owner -> resolved: ${data.created_by}`);
                            } else {
                              logs.push('  task_owner -> no owner found');
                            }
                          }
                        } else if (strategy === 'watchers') {
                          const taskId = payload.task_id || (rule.conditions && (rule.conditions as any).task_id) || null;
                          if (!taskId) {
                            logs.push('  watchers -> no task_id available to resolve');
                          } else {
                            const { data, error } = await supabase
                              .from('entity_watchers')
                              .select('user_id')
                              .eq('entity_type', 'task')
                              .eq('entity_id', taskId);
                            if (error) {
                              logs.push(`  watchers -> DB read failed (likely RLS): ${error.message}`);
                            } else {
                              const ids = (data ?? []).map((r: any) => r.user_id);
                              ids.forEach((id: string) => resolved.add(id));
                              logs.push(`  watchers -> resolved: ${ids.join(', ') || 'none'}`);
                            }
                          }
                        } else {
                          logs.push(`  ${strategy} -> resolution logic not available in client simulation`);
                        }
                      } catch (err: any) {
                        logs.push(`  ${strategy} -> unexpected error: ${err?.message || String(err)}`);
                      }
                    }

                    // 4. Exclude actor (unknown in client simulation)
                    logs.push('Excluding actor: (not available in client simulation)');

                    // 5. Build content preview
                    const title = rule.event_type === 'task.mentioned' ? 'You Were Mentioned' : `Event: ${rule.event_type}`;
                    logs.push(`Built preview title: ${title}`);

                    // 6. Summary
                    setTestSummary({ matchedRules: 1, recipients: [...resolved] });
                    logs.push(`Simulation complete — ${resolved.size} recipient(s) resolved (client-side)`);
                    setTestLogs(logs);
                  } catch (err: any) {
                    setTestLogs((prev) => [...prev, `Simulation error: ${err?.message || String(err)}`]);
                  } finally {
                    setTesting(false);
                  }
                }}
                activeOpacity={0.8}
                className="mt-8 bg-brand-primary py-5 rounded-2xl items-center flex-row justify-center gap-3 premium-shadow"
              >
                {testing ? <ActivityIndicator color="white" size="small" /> : <FontAwesome name="bolt" size={14} color="white" />}
                <Text className="text-white font-black uppercase tracking-[0.2em] text-xs">Run Live Simulation</Text>
              </TouchableOpacity>
            </View>
            
            {testing && (
              <View className="bg-surface-card p-6 rounded-2xl border border-surface-border">
                <Text className="text-typography-main font-black">Running simulation…</Text>
                <Text className="text-typography-muted text-xs mt-2">This runs a best-effort, client-side simulation and may be limited by DB row-level security.</Text>
              </View>
            )}

            {!testing && testSummary && (
              <View className="bg-state-success/10 border border-state-success/20 p-6 rounded-2xl">
                <View className="flex-row items-start gap-4">
                  <View className="w-10 h-10 rounded-full bg-state-success items-center justify-center">
                    <FontAwesome name="check" size={16} color="white" />
                  </View>
                  <View className="flex-1">
                    <Text className="text-typography-main font-black text-base">Simulation Complete</Text>
                    <Text className="text-typography-muted text-xs mt-1 leading-5">The client-side simulation resolved <Text className="text-state-success font-bold">{testSummary.recipients?.length ?? 0}</Text> recipient(s).</Text>
                    <Text className="text-typography-muted text-xs mt-2">Details:</Text>
                    <View className="mt-2">
                      {testLogs.map((l, i) => (
                        <Text key={i} className="text-typography-muted text-[12px]">• {l}</Text>
                      ))}
                    </View>
                  </View>
                </View>
              </View>
            )}
          </View>
          </View>
        )}

        {activeTab === 'logs' && (
          <View className="gap-3">
            {[1,2,3,4,5].map(i => (
              <View key={i} className="flex-row items-center justify-between p-5 bg-surface-background/50 rounded-2xl border border-surface-border">
                <View className="flex-row items-center gap-4">
                  <View className="w-2 h-2 rounded-full bg-state-success shadow-sm shadow-state-success" />
                  <View>
                    <Text className="text-typography-main text-xs font-black">Delivery Success</Text>
                    <Text className="text-typography-muted text-[10px] font-medium mt-0.5">May 08, 2026 • 04:{10 + i} AM</Text>
                  </View>
                </View>
                <View className="flex-row items-center gap-4 bg-surface-card px-4 py-2 rounded-xl border border-surface-border">
                  <View className="flex-row gap-3">
                    <FontAwesome name="envelope" size={10} color={colors.primary} />
                    <FontAwesome name="mobile" size={12} color={colors.primary} />
                  </View>
                  <View className="w-px h-3 bg-surface-border" />
                  <Text className="text-typography-muted text-[10px] font-black tracking-tighter">3 RCVP</Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────

export default function NotificationRules() {
  const colors = useThemeColors();
  const { width } = useWindowDimensions();
  const isDesktop = width > 1024;
  const { hasPermission, initialized } = useAuth();
  const { showAlert } = useAlert();
  
  const [rules, setRules] = useState<NotificationRule[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const activeRule = useMemo(() => rules.find(r => r.id === selectedId) || null, [rules, selectedId]);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('notification_rules').select('*').order('created_at', { ascending: true });
    if (!error && data) {
      setRules(data as NotificationRule[]);
      if (isDesktop && data.length > 0 && !selectedId) {
        setSelectedId(data[0].id);
      }
    }
    setLoading(false);
  };

  useEffect(() => { 
    if (initialized) load(); 
  }, [initialized]);

  const handleToggle = async (id: string, active: boolean) => {
    // Optimistic update
    setRules(prev => prev.map(r => r.id === id ? { ...r, is_active: active } : r));
    
    const { error } = await supabase.rpc('rpc_toggle_notification_rule', { 
      p_rule_id: id, 
      p_is_active: active 
    });
    
    if (error) {
      showAlert('Error', error.message);
      load(); // Rollback
    }
  };

  if (loading) return (
    <View className="py-40 items-center justify-center">
      <ActivityIndicator size="large" color={colors.primary} />
      <Text className="text-typography-muted mt-4 font-black text-xs uppercase tracking-widest">Loading Workspace</Text>
    </View>
  );

  // Stats for the top row (can be kept or moved)
  const activeCount = rules.filter(r => r.is_active).length;

  if (!isDesktop) {
    return (
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
         {/* Simple List for Mobile */}
         <View className="px-4 py-4 gap-4">
           <TouchableOpacity 
             onPress={() => setShowCreate(true)}
             className="w-full h-12 bg-brand-primary rounded-xl items-center justify-center shadow-lg shadow-brand-primary/20 flex-row gap-2"
           >
             <FontAwesome name="plus" size={14} color="white" />
             <Text className="text-white font-black text-xs uppercase tracking-widest">New Rule</Text>
           </TouchableOpacity>
          {rules.map(r => (
            <RuleListItem 
              key={r.id} 
              rule={r} 
              isSelected={false} 
              onSelect={() => setSelectedId(r.id)} 
              onToggle={handleToggle} 
            />
          ))}
         </View>
         
         <Modal visible={!!selectedId} animationType="slide" onRequestClose={() => setSelectedId(null)}>
           <View className="flex-1 bg-surface-background">
             <View className="pt-12 pb-4 px-4 border-b border-surface-border flex-row items-center gap-4 bg-surface-card">
               <TouchableOpacity onPress={() => setSelectedId(null)} className="w-10 h-10 items-center justify-center bg-surface-background rounded-full border border-surface-border">
                 <FontAwesome name="arrow-left" size={16} color={colors.textMain} />
               </TouchableOpacity>
               <Text className="text-typography-main font-black text-lg">Rule Details</Text>
             </View>
             <RuleInspector rule={activeRule} onToggle={handleToggle} />
           </View>
         </Modal>

         <CreateRuleModal 
           visible={showCreate} 
           onClose={() => setShowCreate(false)} 
           onCreated={load} 
         />
      </ScrollView>
    );
  }

  return (
    <View className="flex-1 flex-row bg-surface-background overflow-hidden rounded-[32px] border border-surface-border">
      {/* Sidebar - Rules Explorer */}
      <View className="w-80 border-r border-surface-border bg-surface-background/40">
        <View className="p-6 border-b border-surface-border flex-row items-center justify-between">
          <View>
            <Text className="text-typography-main font-black text-xl tracking-tight">Notification Rules</Text>
            <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-widest mt-0.5">{rules.length} Total</Text>
          </View>
          <TouchableOpacity 
            onPress={() => setShowCreate(true)}
            className="w-10 h-10 bg-brand-primary rounded-xl items-center justify-center shadow-lg shadow-brand-primary/20"
          >
            <FontAwesome name="plus" size={14} color="white" />
          </TouchableOpacity>
        </View>

        <View className="p-4 bg-surface-background/60 border-b border-surface-border flex-row gap-2">
            <View className="flex-1 bg-surface-card p-2 rounded-lg items-center border border-surface-border">
              <Text className="text-state-success font-black text-xs">{activeCount}</Text>
              <Text className="text-typography-muted text-[8px] uppercase">Active</Text>
            </View>
            <View className="flex-1 bg-surface-card p-2 rounded-lg items-center border border-surface-border">
              <Text className="text-typography-muted font-black text-xs">{rules.length - activeCount}</Text>
              <Text className="text-typography-muted text-[8px] uppercase">Paused</Text>
            </View>
        </View>

        <ScrollView className="flex-1 p-4" showsVerticalScrollIndicator={false}>
          {rules.map(r => (
            <RuleListItem 
              key={r.id} 
              rule={r} 
              isSelected={selectedId === r.id} 
              onSelect={() => setSelectedId(r.id)} 
              onToggle={handleToggle} 
            />
          ))}
        </ScrollView>
      </View>

      {/* Main Content Area - Inspector */}
      <View className="flex-1">
        <RuleInspector rule={activeRule} onToggle={handleToggle} />
      </View>

      <CreateRuleModal 
        visible={showCreate} 
        onClose={() => setShowCreate(false)} 
        onCreated={load} 
      />
    </View>
  );
}


