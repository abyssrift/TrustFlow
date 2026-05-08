import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Switch,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  TextInput,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { FontAwesome } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useAlert } from '@/contexts/AlertContext';

type NotificationRule = {
  id: string;
  name: string;
  description: string | null;
  event_type: string;
  conditions: Record<string, any>;
  recipient_strategies: string[];
  recipient_config: Record<string, any>;
  channels_override: Record<string, any> | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

// Human-readable labels for known event types
const EVENT_TYPE_LABELS: Record<string, { label: string; category: string; icon: React.ComponentProps<typeof FontAwesome>['name'] }> = {
  'task.created':          { label: 'Task Created',         category: 'Tasks',     icon: 'plus-square' },
  'task.assigned':         { label: 'Task Assigned',        category: 'Tasks',     icon: 'user-plus' },
  'task.stage_transition': { label: 'Stage Transition',     category: 'Tasks',     icon: 'exchange' },
  'task.status_changed':   { label: 'Status Changed',       category: 'Tasks',     icon: 'refresh' },
  'task.completed':        { label: 'Task Completed',       category: 'Tasks',     icon: 'check-circle' },
  'task.commented':        { label: 'New Comment',          category: 'Comments',  icon: 'comment' },
  'task.mentioned':        { label: 'User Mentioned',       category: 'Comments',  icon: 'at' },
  'task.due_soon':         { label: 'Due Within 24h',       category: 'Deadlines', icon: 'clock-o' },
  'task.overdue':          { label: 'Task Overdue',         category: 'Deadlines', icon: 'exclamation-circle' },
  'pipeline.member_added': { label: 'Member Added',         category: 'Workspace', icon: 'users' },
  'pipeline.archived':     { label: 'Pipeline Archived',    category: 'Workspace', icon: 'archive' },
};

const STRATEGY_LABELS: Record<string, string> = {
  assignee:         'Assignees',
  task_owner:       'Task Owner',
  pipeline_members: 'Pipeline Members',
  watchers:         'Watchers',
  specific_users:   'Specific Users',
  role:             'By Role',
};

// ── Create Rule Modal ────────────────────────────────────────────────────────
type CreateRuleModalProps = {
  visible: boolean;
  onClose: () => void;
  onCreated: () => void;
};

function CreateRuleModal({ visible, onClose, onCreated }: CreateRuleModalProps) {
  const { showAlert } = useAlert();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [eventType, setEventType] = useState('task.assigned');
  const [strategies, setStrategies] = useState<string[]>(['assignee']);
  const [saving, setSaving] = useState(false);

  const knownEventTypes = Object.keys(EVENT_TYPE_LABELS);
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
    <Modal visible={visible} animationType="slide" transparent>
      <View className="flex-1 justify-end bg-black/50">
        <View className="bg-surface-card rounded-t-3xl px-5 pt-6 pb-10 border-t border-surface-border">
          <View className="flex-row items-center justify-between mb-6">
            <Text className="text-typography-main font-black text-xl">New Rule</Text>
            <TouchableOpacity onPress={onClose} className="p-2">
              <FontAwesome name="times" size={18} className="text-typography-muted" />
            </TouchableOpacity>
          </View>

          {/* Name */}
          <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-1.5">
            Rule Name *
          </Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="e.g. Notify assignees on stage move"
            placeholderTextColor="var(--color-text-dim)"
            className="bg-surface-background border border-surface-border rounded-xl px-4 py-3 text-typography-main text-sm mb-4"
          />

          {/* Description */}
          <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-1.5">
            Description
          </Text>
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="Optional description..."
            placeholderTextColor="var(--color-text-dim)"
            className="bg-surface-background border border-surface-border rounded-xl px-4 py-3 text-typography-main text-sm mb-4"
          />

          {/* Event Type */}
          <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-2">
            Trigger Event
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-4 -mx-1">
            {knownEventTypes.map((et) => (
              <TouchableOpacity
                key={et}
                onPress={() => setEventType(et)}
                className={`px-3 py-2 rounded-xl border mr-2 mx-1 ${
                  eventType === et
                    ? 'bg-brand-primary border-brand-primary'
                    : 'bg-surface-background border-surface-border'
                }`}
              >
                <Text
                  className={`text-[10px] font-black ${
                    eventType === et ? 'text-white' : 'text-typography-muted'
                  }`}
                >
                  {EVENT_TYPE_LABELS[et]?.label ?? et}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Strategies */}
          <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-2">
            Notify
          </Text>
          <View className="flex-row flex-wrap gap-2 mb-6">
            {availableStrategies.map((s) => (
              <TouchableOpacity
                key={s}
                onPress={() => toggleStrategy(s)}
                className={`px-3 py-2 rounded-xl border ${
                  strategies.includes(s)
                    ? 'bg-brand-primary/10 border-brand-primary/40'
                    : 'bg-surface-background border-surface-border'
                }`}
              >
                <Text
                  className={`text-[10px] font-black ${
                    strategies.includes(s)
                      ? 'text-brand-primary'
                      : 'text-typography-muted'
                  }`}
                >
                  {STRATEGY_LABELS[s]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity
            onPress={submit}
            disabled={saving}
            className="bg-brand-primary py-4 rounded-2xl items-center active:opacity-80"
          >
            {saving ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text className="text-white font-black uppercase tracking-widest text-[11px]">
                Create Rule
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ── Rule Card ────────────────────────────────────────────────────────────────
function RuleCard({
  rule,
  onToggle,
}: {
  rule: NotificationRule;
  onToggle: (id: string, active: boolean) => void;
}) {
  const meta = EVENT_TYPE_LABELS[rule.event_type];
  const categoryClasses = meta?.category === 'Tasks'
    ? { bg: 'bg-brand-primary/10', border: 'border-brand-primary/20', text: 'text-brand-primary' }
    : meta?.category === 'Comments'
    ? { bg: 'bg-state-warning/10', border: 'border-[var(--color-warning)]/20', text: 'text-state-warning' }
    : meta?.category === 'Deadlines'
    ? { bg: 'bg-state-danger/10', border: 'border-state-danger/20', text: 'text-state-danger' }
    : { bg: 'bg-surface-overlay', border: 'border-surface-border', text: 'text-typography-muted' };

  return (
    <View className="bg-surface-card border border-surface-border rounded-2xl p-4 mb-3">
      <View className="flex-row items-start justify-between">
        <View className="flex-1 mr-3">
          {/* Category tag */}
          <View className="flex-row items-center gap-2 mb-2">
            <View
              className={`px-2 py-0.5 rounded-full border ${categoryClasses.bg} ${categoryClasses.border}`}
            >
              <Text
                className={`text-[9px] font-black uppercase tracking-widest ${categoryClasses.text}`}
              >
                {meta?.category ?? 'General'}
              </Text>
            </View>
            <Text className="text-typography-muted text-[10px]">{rule.event_type}</Text>
          </View>

          <Text className="text-typography-main font-black text-base mb-1">
            {rule.name}
          </Text>
          {rule.description && (
            <Text className="text-typography-muted text-xs leading-4 mb-2">
              {rule.description}
            </Text>
          )}

          {/* Strategies */}
          <View className="flex-row flex-wrap gap-1.5 mt-1">
            {rule.recipient_strategies.map((s) => (
              <View
                key={s}
                className="bg-surface-background px-2 py-0.5 rounded-lg border border-surface-border"
              >
                <Text className="text-typography-muted text-[9px] font-bold">
                  {STRATEGY_LABELS[s] ?? s}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* Toggle */}
        <Switch
          value={rule.is_active}
          onValueChange={(val) => onToggle(rule.id, val)}
          trackColor={{
            false: 'var(--color-border)',
            true: 'var(--color-primary)',
          }}
          thumbColor="#fff"
        />
      </View>
    </View>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────────
export default function NotificationRules() {
  const router = useRouter();
  const { hasPermission, initialized } = useAuth();
  const { showAlert } = useAlert();
  const [rules, setRules] = useState<NotificationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('notification_rules')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) {
      showAlert('Error', error.message);
    } else {
      setRules((data ?? []) as NotificationRule[]);
    }
    setLoading(false);
  };

  const canManage = hasPermission('manage_notifications') || hasPermission('role.manage');

  useEffect(() => {
    if (initialized) {
      if (canManage) {
        load();
      } else {
        setLoading(false);
      }
    }
  }, [initialized]);

  const handleToggle = async (id: string, active: boolean) => {
    setRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, is_active: active } : r))
    );
    const { error } = await supabase.rpc('rpc_toggle_notification_rule', {
      p_rule_id: id,
      p_is_active: active,
    });
    if (error) {
      showAlert('Error', error.message);
      setRules((prev) =>
        prev.map((r) => (r.id === id ? { ...r, is_active: !active } : r))
      );
    }
  };

  if (!initialized || loading) {
    return (
      <View className="py-20 items-center justify-center">
        <ActivityIndicator size="large" color="var(--color-primary)" />
        <Text className="text-typography-muted mt-4 font-bold text-sm">
          Loading rules...
        </Text>
      </View>
    );
  }

  if (!canManage) {
    return (
      <View className="flex-1 bg-surface-background items-center justify-center p-6">
        <View className="bg-state-danger/10 p-8 rounded-[40px] mb-8 border border-dashed border-state-danger/20">
          <FontAwesome name="lock" size={48} className="text-state-danger" />
        </View>
        <Text className="text-typography-main font-black text-2xl text-center tracking-tight">
          Access Restricted
        </Text>
        <Text className="text-typography-muted text-center mt-2 leading-6 max-w-sm">
          The <Text className="text-brand-primary font-black">manage_notifications</Text> permission is required to configure rules.
        </Text>
      </View>
    );
  }

  // Group rules by category
  const grouped: Record<string, NotificationRule[]> = {};
  for (const rule of rules) {
    const cat = EVENT_TYPE_LABELS[rule.event_type]?.category ?? 'Other';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(rule);
  }

  const activeCount = rules.filter((r) => r.is_active).length;

  return (
    <View className="flex-1">
      {/* Stats row */}
        <View className="flex-row gap-3 px-2">
          <View className="bg-surface-background flex-1 rounded-xl px-3 py-2.5 border border-surface-border">
            <Text className="text-typography-main font-black text-lg">{rules.length}</Text>
            <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-wider">
              Total Rules
            </Text>
          </View>
          <View className="bg-state-success/10 flex-1 rounded-xl px-3 py-2.5 border border-[var(--color-success)]/20">
            <Text className="text-state-success font-black text-lg">{activeCount}</Text>
            <Text className="text-state-success/70 text-[10px] font-bold uppercase tracking-wider">
              Active
            </Text>
          </View>
          <View className="bg-surface-background flex-1 rounded-xl px-3 py-2.5 border border-surface-border">
            <Text className="text-typography-muted font-black text-lg">
              {rules.length - activeCount}
            </Text>
            <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-wider">
              Paused
            </Text>
          </View>
        </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 48 }}
      >
        {rules.length === 0 ? (
          <View className="items-center justify-center py-20 px-8">
            <View className="bg-brand-primary/10 p-6 rounded-full mb-6 border border-brand-primary/20">
              <FontAwesome name="bell-slash-o" size={36} className="text-brand-primary" />
            </View>
            <Text className="text-typography-main font-black text-xl text-center mb-2">
              No Rules Yet
            </Text>
            <Text className="text-typography-muted text-sm text-center leading-6">
              Create your first notification rule to start routing events to your team.
            </Text>
          </View>
        ) : (
          Object.entries(grouped).map(([category, categoryRules]) => (
            <View key={category}>
              <View className="px-4 mt-6 mb-3 flex-row items-center gap-2">
                <FontAwesome
                  name={
                    category === 'Tasks'
                      ? 'check-square-o'
                      : category === 'Comments'
                      ? 'comments'
                      : category === 'Deadlines'
                      ? 'clock-o'
                      : 'bell'
                  }
                  size={11}
                  className="text-typography-muted"
                />
                <Text className="text-[10px] font-black uppercase tracking-[0.2em] text-typography-muted">
                  {category}
                </Text>
                <View className="bg-surface-border px-2 py-0.5 rounded-full">
                  <Text className="text-typography-muted text-[9px] font-bold">
                    {categoryRules.length}
                  </Text>
                </View>
              </View>
              <View className="px-4">
                {categoryRules.map((rule) => (
                  <RuleCard key={rule.id} rule={rule} onToggle={handleToggle} />
                ))}
              </View>
            </View>
          ))
        )}

        {/* Add Rule Button */}
        <View className="px-4 mt-6">
          <TouchableOpacity
            onPress={() => setShowCreate(true)}
            className="flex-row items-center justify-center bg-brand-primary/10 border border-brand-primary/30 rounded-2xl py-4 gap-2"
          >
            <FontAwesome name="plus" size={13} className="text-brand-primary" />
            <Text className="text-brand-primary font-black text-sm uppercase tracking-widest text-[11px]">
              Add Rule
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <CreateRuleModal
        visible={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={load}
      />
    </View>
  );
}

