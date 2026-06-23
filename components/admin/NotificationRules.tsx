import { useAlert } from '@/contexts/AlertContext';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { supabase } from '@/lib/supabase';
import { FontAwesome } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import RuleEditorModal from '@/components/admin/RuleEditorModal';
import {
  EVENT_META,
  NotificationRule,
  STRATEGY_HELP,
  STRATEGY_LABELS,
} from '@/lib/notificationRuleConstants';

type Delivery = {
  id: string;
  user_id: string;
  recipient_name: string;
  title: string;
  body: string;
  channels_sent: string[] | null;
  read_at: string | null;
  created_at: string;
};

type SimulationResult = {
  rule_id: string;
  event_type: string;
  conditions_match: boolean;
  strategy_log: { strategy: string; resolved_count: number; user_ids: string[] }[];
  recipients: { user_id: string; display_name: string; email: string }[];
  recipient_count: number;
};

// ── Rule list item ────────────────────────────────────────────────────
const RuleListItem = ({
  rule, isSelected, onSelect, onToggle,
}: {
  rule: NotificationRule;
  isSelected: boolean;
  onSelect: () => void;
  onToggle: (id: string, active: boolean) => void;
}) => {
  const colors = useThemeColors();
  const meta = EVENT_META[rule.event_type] || { label: rule.event_type, icon: 'bell', colorKey: 'textMuted' };
  return (
    <TouchableOpacity
      onPress={onSelect}
      activeOpacity={0.7}
      className={`p-4 mb-2 rounded-xl border ${isSelected ? 'bg-brand-primary/10 border-brand-primary' : 'bg-surface-card border-surface-border'}`}
    >
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-3 flex-1">
          <View className="w-8 h-8 rounded-lg items-center justify-center bg-surface-background border border-surface-border">
            <FontAwesome name={meta.icon} size={14} color={rule.is_active ? ((colors as any)[meta.colorKey] || colors.primary) : colors.textMuted} />
          </View>
          <View className="flex-1">
            <Text className={`font-black text-sm ${isSelected ? 'text-typography-main' : 'text-typography-muted'}`} numberOfLines={1}>{rule.name}</Text>
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

// ── Rule inspector ───────────────────────────────────────────────────
const RuleInspector = ({
  rule, isDesktop, onToggle, onEdit, onDelete,
}: {
  rule: NotificationRule | null;
  isDesktop: boolean;
  onToggle: (id: string, active: boolean) => void;
  onEdit: (rule: NotificationRule) => void;
  onDelete: (rule: NotificationRule) => void;
}) => {
  const colors = useThemeColors();
  const [activeTab, setActiveTab] = useState<'config' | 'test' | 'logs'>('config');

  // Playground state
  const [testing, setTesting] = useState(false);
  const [simTaskId, setSimTaskId] = useState('');
  const [simPipelineId, setSimPipelineId] = useState('');
  const [simPayloadJson, setSimPayloadJson] = useState('{}');
  const [simResult, setSimResult] = useState<SimulationResult | null>(null);
  const [simError, setSimError] = useState<string | null>(null);

  // Logs state
  const [logs, setLogs] = useState<Delivery[] | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);

  // Reset tab-specific state when rule changes
  useEffect(() => {
    setActiveTab('config');
    setSimResult(null);
    setSimError(null);
    setSimTaskId('');
    setSimPipelineId('');
    setSimPayloadJson('{}');
    setLogs(null);
    setLogsError(null);
  }, [rule?.id]);

  const loadLogs = useCallback(async () => {
    if (!rule) return;
    setLogsLoading(true);
    setLogsError(null);
    const { data, error } = await supabase.rpc('rpc_list_rule_deliveries', {
      p_event_type: rule.event_type,
      p_limit: 50,
    });
    setLogsLoading(false);
    if (error) {
      setLogsError(error.message);
      setLogs([]);
    } else {
      setLogs((data ?? []) as Delivery[]);
    }
  }, [rule?.id, rule?.event_type]);

  useEffect(() => {
    if (activeTab === 'logs' && logs === null) loadLogs();
  }, [activeTab, logs, loadLogs]);

  const runSimulation = async () => {
    if (!rule) return;
    setTesting(true);
    setSimError(null);
    setSimResult(null);

    // Build payload from convenience inputs + JSON
    let extra: Record<string, unknown> = {};
    const trimmed = simPayloadJson.trim();
    if (trimmed) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          extra = parsed as Record<string, unknown>;
        } else {
          setSimError('Payload JSON must be an object');
          setTesting(false);
          return;
        }
      } catch (e: any) {
        setSimError(`Payload JSON: ${e?.message || 'invalid JSON'}`);
        setTesting(false);
        return;
      }
    }
    const payload: Record<string, unknown> = { ...extra };
    if (simTaskId.trim())     payload.task_id = simTaskId.trim();
    if (simPipelineId.trim()) payload.pipeline_id = simPipelineId.trim();

    const { data, error } = await supabase.rpc('rpc_simulate_notification_rule', {
      p_rule_id: rule.id,
      p_payload: payload,
    });
    setTesting(false);
    if (error) {
      setSimError(error.message);
    } else {
      setSimResult(data as SimulationResult);
    }
  };

  if (!rule) {
    return (
      <View className="flex-1 items-center justify-center p-8 bg-surface-background/30">
        <View className="bg-surface-card p-8 rounded-3xl border border-dashed border-surface-border items-center">
          <View className="w-14 h-14 bg-surface-background rounded-full items-center justify-center mb-4">
            <FontAwesome name="mouse-pointer" size={22} color={colors.textMuted} />
          </View>
          <Text className="text-typography-main text-base font-black tracking-tight">Select a Rule</Text>
          <Text className="text-typography-muted mt-2 text-center max-w-[220px] leading-5 text-xs">Choose a rule from the left to view configuration and logs.</Text>
        </View>
      </View>
    );
  }

  const meta = EVENT_META[rule.event_type] || { label: rule.event_type };
  const conditionEntries = Object.entries(rule.conditions ?? {});
  const cfgEntries = Object.entries(rule.recipient_config ?? {});

  const headerPad = isDesktop ? 32 : 20;
  const contentPad = isDesktop ? 32 : 20;
  const titleClass = isDesktop ? 'text-3xl' : 'text-xl';

  return (
    <View className="flex-1 bg-surface-card border-l border-surface-border">
      {/* Header */}
      <View style={{ padding: headerPad }} className="border-b border-surface-border bg-surface-background/50">
        <View className="flex-row items-start justify-between">
          <View className="flex-1 mr-3">
            <View className="flex-row items-center gap-2 mb-2 flex-wrap">
              <View className="bg-brand-primary/10 px-2 py-0.5 rounded-md border border-brand-primary/20">
                <Text className="text-brand-primary text-[9px] font-black uppercase tracking-wider">{rule.event_type}</Text>
              </View>
              <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">• ID {rule.id.slice(0, 8)}</Text>
            </View>
            <Text className={`text-typography-main ${titleClass} font-black tracking-tighter leading-none mb-2`} numberOfLines={2}>{rule.name}</Text>
            <Text className="text-typography-muted text-xs font-medium">{rule.description || 'No description provided.'}</Text>
          </View>

          <View className="items-end">
            <Text className="text-typography-muted text-[9px] font-black uppercase mb-1">Status</Text>
            <View className="flex-row items-center gap-2 mb-3">
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
            <View className="flex-row gap-2">
              <TouchableOpacity
                onPress={() => onEdit(rule)}
                className="bg-surface-background w-10 h-10 rounded-xl border border-surface-border items-center justify-center"
              >
                <FontAwesome name="pencil" size={14} color={colors.primary} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => onDelete(rule)}
                className="bg-surface-background w-10 h-10 rounded-xl border border-surface-border items-center justify-center"
              >
                <FontAwesome name="trash" size={14} color={colors.danger} />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>

      {/* Tabs */}
      <View className="flex-row px-5 border-b border-surface-border bg-surface-background/20">
        {(['config', 'test', 'logs'] as const).map((tab) => (
          <TouchableOpacity
            key={tab}
            onPress={() => setActiveTab(tab)}
            className={`py-4 mr-6 border-b-2 ${activeTab === tab ? 'border-brand-primary' : 'border-transparent'}`}
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

      <ScrollView className="flex-1" contentContainerStyle={{ padding: contentPad }} showsVerticalScrollIndicator={false}>
        {activeTab === 'config' && (
          <View className="gap-5">
            {/* Recipient Logic */}
            <View className="bg-surface-background/50 p-5 rounded-2xl border border-surface-border">
              <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-3">Recipient Logic</Text>
              <View className="flex-row flex-wrap gap-2">
                {rule.recipient_strategies.map((s) => (
                  <View key={s} className="bg-surface-card border border-surface-border px-4 py-2.5 rounded-xl">
                    <View className="flex-row items-center gap-2">
                      <View className="w-1.5 h-1.5 rounded-full bg-brand-primary" />
                      <Text className="text-typography-main font-black text-xs">{STRATEGY_LABELS[s] || s}</Text>
                    </View>
                    <Text className="text-typography-muted text-[10px] mt-0.5">{STRATEGY_HELP[s] || 'Custom strategy'}</Text>
                  </View>
                ))}
              </View>

              {cfgEntries.length > 0 && (
                <View className="mt-4 pt-4 border-t border-surface-border">
                  <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-2">Recipient Config</Text>
                  {cfgEntries.map(([k, v]) => (
                    <View key={k} className="flex-row items-center gap-3 py-1">
                      <Text className="text-typography-muted text-xs font-mono" style={{ fontFamily: 'monospace' }}>{k}:</Text>
                      <Text className="text-typography-main text-xs font-mono" style={{ fontFamily: 'monospace' }} numberOfLines={2}>{JSON.stringify(v)}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>

            {/* Conditions + Channels */}
            <View className={isDesktop ? 'flex-row gap-4' : 'gap-4'}>
              <View className="flex-1 bg-surface-background/50 p-5 rounded-2xl border border-surface-border">
                <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-3">Conditions</Text>
                {conditionEntries.length === 0 ? (
                  <View className="items-center justify-center py-6">
                    <FontAwesome name="filter" size={20} color={colors.textMuted} style={{ opacity: 0.3, marginBottom: 8 }} />
                    <Text className="text-typography-muted text-xs font-bold">Matches every event</Text>
                  </View>
                ) : (
                  <View className="gap-1">
                    {conditionEntries.map(([k, v]) => (
                      <View key={k} className="flex-row items-center gap-2 bg-surface-card px-3 py-2 rounded-lg border border-surface-border">
                        <Text className="text-typography-muted text-[11px] font-mono" style={{ fontFamily: 'monospace' }}>{k}</Text>
                        <Text className="text-typography-muted text-[11px]">=</Text>
                        <Text className="text-typography-main text-[11px] font-mono flex-1" style={{ fontFamily: 'monospace' }} numberOfLines={1}>{JSON.stringify(v)}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>

              <View className="flex-1 bg-surface-background/50 p-5 rounded-2xl border border-surface-border">
                <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-3">Channels</Text>
                <View className="flex-row gap-3 mb-3 flex-wrap">
                  {[
                    { icon: 'envelope', label: 'Email' },
                    { icon: 'mobile',   label: 'Mobile' },
                    { icon: 'globe',    label: 'Web' },
                  ].map((c) => (
                    <View key={c.label} className="items-center gap-1.5">
                      <View className="w-10 h-10 bg-brand-primary/10 rounded-xl items-center justify-center border border-brand-primary/20">
                        <FontAwesome name={c.icon as any} size={14} color={colors.primary} />
                      </View>
                      <Text className="text-typography-main text-[10px] font-bold">{c.label}</Text>
                    </View>
                  ))}
                </View>
                <Text className="text-typography-muted text-[10px] leading-4">
                  Each recipient receives this notification on the channels they have enabled in their preferences.
                </Text>
              </View>
            </View>
          </View>
        )}

        {activeTab === 'test' && (
          <View className="gap-5">
            <View className="bg-surface-background p-5 rounded-2xl border border-surface-border">
              <Text className="text-typography-main text-base font-black mb-1">Rule Simulator</Text>
              <Text className="text-typography-muted text-xs leading-5 mb-4">
                Run server-side recipient resolution for a synthetic <Text className="text-brand-primary font-black">{rule.event_type}</Text> event. No notifications are sent.
              </Text>

              <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-2">Task ID</Text>
              <TextInput
                value={simTaskId}
                onChangeText={setSimTaskId}
                placeholder="UUID — used by assignee, task_owner, watchers"
                placeholderTextColor={colors.textDim}
                autoCapitalize="none"
                autoCorrect={false}
                className="bg-surface-background border border-surface-border rounded-xl px-3 py-2.5 text-typography-main text-xs mb-3"
              />

              <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-2">Pipeline ID</Text>
              <TextInput
                value={simPipelineId}
                onChangeText={setSimPipelineId}
                placeholder="UUID — used by pipeline_members"
                placeholderTextColor={colors.textDim}
                autoCapitalize="none"
                autoCorrect={false}
                className="bg-surface-background border border-surface-border rounded-xl px-3 py-2.5 text-typography-main text-xs mb-3"
              />

              <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-2">Extra Payload (JSON)</Text>
              <TextInput
                value={simPayloadJson}
                onChangeText={setSimPayloadJson}
                multiline
                autoCapitalize="none"
                autoCorrect={false}
                placeholderTextColor={colors.textDim}
                className="bg-surface-background border border-surface-border rounded-xl px-3 py-2.5 text-typography-main text-xs font-mono"
                style={{ minHeight: 72, fontFamily: 'monospace' }}
              />

              <TouchableOpacity
                onPress={runSimulation}
                disabled={testing}
                activeOpacity={0.8}
                className="mt-5 bg-brand-primary py-4 rounded-2xl items-center flex-row justify-center gap-3"
              >
                {testing ? (
                  <ActivityIndicator color="white" size="small" />
                ) : (
                  <FontAwesome name="bolt" size={14} color="white" />
                )}
                <Text className="text-white font-black uppercase tracking-[0.2em] text-xs">
                  {testing ? 'Simulating…' : 'Run Simulation'}
                </Text>
              </TouchableOpacity>
            </View>

            {simError && (
              <View className="bg-state-danger/10 border border-state-danger/30 p-4 rounded-2xl">
                <View className="flex-row items-start gap-3">
                  <FontAwesome name="exclamation-triangle" size={16} color={colors.danger} />
                  <View className="flex-1">
                    <Text className="text-state-danger font-black text-xs uppercase tracking-widest mb-1">Simulation Error</Text>
                    <Text className="text-typography-muted text-xs leading-5">{simError}</Text>
                  </View>
                </View>
              </View>
            )}

            {simResult && (
              <View className="gap-4">
                <View className={`p-5 rounded-2xl border ${simResult.conditions_match ? 'bg-state-success/10 border-state-success/30' : 'bg-state-warning/10 border-state-warning/30'}`}>
                  <View className="flex-row items-center gap-3 mb-2">
                    <View className={`w-9 h-9 rounded-full items-center justify-center ${simResult.conditions_match ? 'bg-state-success' : 'bg-state-warning'}`}>
                      <FontAwesome name={simResult.conditions_match ? 'check' : 'times'} size={14} color="white" />
                    </View>
                    <View className="flex-1">
                      <Text className="text-typography-main font-black text-sm">
                        {simResult.conditions_match ? 'Conditions matched' : 'Conditions did not match'}
                      </Text>
                      <Text className="text-typography-muted text-[11px]">
                        {simResult.recipient_count} unique recipient{simResult.recipient_count === 1 ? '' : 's'} resolved (actor not yet excluded)
                      </Text>
                    </View>
                  </View>
                </View>

                <View className="bg-surface-background/50 p-5 rounded-2xl border border-surface-border">
                  <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-3">Per-Strategy Resolution</Text>
                  {simResult.strategy_log.length === 0 ? (
                    <Text className="text-typography-muted text-xs">No strategies evaluated.</Text>
                  ) : (
                    <View className="gap-2">
                      {simResult.strategy_log.map((s, idx) => (
                        <View key={`${s.strategy}-${idx}`} className="flex-row items-center justify-between bg-surface-card px-3 py-2.5 rounded-lg border border-surface-border">
                          <View>
                            <Text className="text-typography-main text-xs font-black">{STRATEGY_LABELS[s.strategy] || s.strategy}</Text>
                            <Text className="text-typography-muted text-[10px]">{STRATEGY_HELP[s.strategy] || ''}</Text>
                          </View>
                          <View className="bg-brand-primary/10 px-2.5 py-1 rounded-md">
                            <Text className="text-brand-primary text-[10px] font-black">{s.resolved_count}</Text>
                          </View>
                        </View>
                      ))}
                    </View>
                  )}
                </View>

                <View className="bg-surface-background/50 p-5 rounded-2xl border border-surface-border">
                  <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-3">Recipients</Text>
                  {simResult.recipients.length === 0 ? (
                    <Text className="text-typography-muted text-xs">No users matched.</Text>
                  ) : (
                    <View className="gap-2">
                      {simResult.recipients.map((r) => (
                        <View key={r.user_id} className="flex-row items-center gap-3 bg-surface-card px-3 py-2.5 rounded-lg border border-surface-border">
                          <View className="w-8 h-8 rounded-full bg-brand-primary/10 items-center justify-center">
                            <FontAwesome name="user" size={12} color={colors.primary} />
                          </View>
                          <View className="flex-1">
                            <Text className="text-typography-main text-xs font-black" numberOfLines={1}>{r.display_name}</Text>
                            <Text className="text-typography-muted text-[10px]" numberOfLines={1}>{r.email}</Text>
                          </View>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              </View>
            )}
          </View>
        )}

        {activeTab === 'logs' && (
          <View className="gap-3">
            <View className="flex-row items-center justify-between mb-2">
              <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">
                Recent Deliveries{logs ? ` (${logs.length})` : ''}
              </Text>
              <TouchableOpacity
                onPress={loadLogs}
                disabled={logsLoading}
                className="bg-surface-background px-3 py-1.5 rounded-lg border border-surface-border flex-row items-center gap-2"
              >
                <FontAwesome name="refresh" size={10} color={colors.textMuted} />
                <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">Refresh</Text>
              </TouchableOpacity>
            </View>

            {logsLoading && (
              <View className="py-12 items-center">
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            )}

            {!logsLoading && logsError && (
              <View className="bg-state-danger/10 border border-state-danger/30 p-4 rounded-xl">
                <Text className="text-state-danger text-xs font-black">{logsError}</Text>
              </View>
            )}

            {!logsLoading && !logsError && logs && logs.length === 0 && (
              <View className="bg-surface-background/50 p-8 rounded-2xl border border-dashed border-surface-border items-center">
                <FontAwesome name="inbox" size={24} color={colors.textMuted} style={{ opacity: 0.4, marginBottom: 8 }} />
                <Text className="text-typography-main font-black text-sm">No deliveries yet</Text>
                <Text className="text-typography-muted text-xs mt-1 text-center">This rule has not produced any notifications yet.</Text>
              </View>
            )}

            {!logsLoading && !logsError && logs && logs.map((d) => {
              const channels = d.channels_sent ?? [];
              const ok = channels.length > 0;
              return (
                <View key={d.id} className="p-4 bg-surface-background/50 rounded-2xl border border-surface-border">
                  <View className="flex-row items-center justify-between mb-2">
                    <View className="flex-row items-center gap-3 flex-1">
                      <View className={`w-2 h-2 rounded-full ${ok ? 'bg-state-success' : 'bg-state-warning'}`} />
                      <View className="flex-1">
                        <Text className="text-typography-main text-xs font-black" numberOfLines={1}>{d.recipient_name}</Text>
                        <Text className="text-typography-muted text-[10px]">{formatTimestamp(d.created_at)}</Text>
                      </View>
                    </View>
                    <View className="flex-row items-center gap-3 bg-surface-card px-3 py-1.5 rounded-lg border border-surface-border">
                      {channels.includes('in_app')      && <FontAwesome name="bell"     size={10} color={colors.primary} />}
                      {channels.includes('email')       && <FontAwesome name="envelope" size={10} color={colors.primary} />}
                      {channels.includes('push_mobile') && <FontAwesome name="mobile"   size={12} color={colors.primary} />}
                      {channels.includes('push_web')    && <FontAwesome name="globe"    size={11} color={colors.primary} />}
                      {channels.length === 0           && <FontAwesome name="ban"      size={10} color={colors.textMuted} />}
                      <Text className="text-typography-muted text-[9px] font-black uppercase">
                        {channels.length === 0 ? 'No channels' : `${channels.length} ch`}
                      </Text>
                    </View>
                  </View>
                  <Text className="text-typography-main text-xs font-bold" numberOfLines={1}>{d.title}</Text>
                  <Text className="text-typography-muted text-[11px] mt-0.5" numberOfLines={2}>{d.body}</Text>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
};

// ── Helpers ───────────────────────────────────────────────────────────
function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

// ── Main Component ────────────────────────────────────────────────────
export default function NotificationRules() {
  const colors = useThemeColors();
  const { width } = useWindowDimensions();
  const isDesktop = width > 1024;
  const { initialized } = useAuth();
  const { showAlert, showConfirm } = useAlert();

  const [rules, setRules] = useState<NotificationRule[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editorTarget, setEditorTarget] = useState<NotificationRule | null>(null);
  const [editorOpen, setEditorOpen] = useState<'closed' | 'create' | 'edit'>('closed');

  const activeRule = useMemo(
    () => rules.find((r) => r.id === selectedId) || null,
    [rules, selectedId]
  );

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('notification_rules')
      .select('*')
      .order('created_at', { ascending: true });
    if (!error && data) {
      const cast = data as NotificationRule[];
      setRules(cast);
      if (isDesktop && cast.length > 0) {
        setSelectedId((curr) => curr ?? cast[0].id);
      }
    }
    setLoading(false);
  }, [isDesktop]);

  useEffect(() => {
    if (initialized) load();
  }, [initialized, load]);

  const handleToggle = async (id: string, active: boolean) => {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, is_active: active } : r)));
    const { error } = await supabase.rpc('rpc_toggle_notification_rule', {
      p_rule_id: id,
      p_is_active: active,
    });
    if (error) {
      showAlert('Error', error.message);
      load();
    }
  };

  const handleDelete = (rule: NotificationRule) => {
    showConfirm(
      'Delete Rule',
      `Are you sure you want to delete "${rule.name}"? This cannot be undone.`,
      async () => {
        const { error } = await supabase.rpc('rpc_delete_notification_rule', { p_rule_id: rule.id });
        if (error) {
          showAlert('Error', error.message);
          return;
        }
        if (selectedId === rule.id) setSelectedId(null);
        load();
      },
      undefined,
      'Delete',
      'Cancel'
    );
  };

  const openCreate = () => { setEditorTarget(null); setEditorOpen('create'); };
  const openEdit   = (rule: NotificationRule) => { setEditorTarget(rule); setEditorOpen('edit'); };
  const closeEditor = () => { setEditorOpen('closed'); setEditorTarget(null); };

  if (loading) {
    return (
      <View className="py-40 items-center justify-center">
        <ActivityIndicator size="large" color={colors.primary} />
        <Text className="text-typography-muted mt-4 font-black text-xs uppercase tracking-widest">Loading Workspace</Text>
      </View>
    );
  }

  const activeCount = rules.filter((r) => r.is_active).length;

  if (!isDesktop) {
    return (
      <View className="flex-1">
        <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
          <View className="px-4 py-4 gap-4">
            <TouchableOpacity
              onPress={openCreate}
              className="w-full h-12 bg-brand-primary rounded-xl items-center justify-center flex-row gap-2"
            >
              <FontAwesome name="plus" size={14} color="white" />
              <Text className="text-white font-black text-xs uppercase tracking-widest">New Rule</Text>
            </TouchableOpacity>

            <View className="flex-row gap-2">
              <View className="flex-1 bg-surface-card p-3 rounded-xl items-center border border-surface-border">
                <Text className="text-state-success font-black text-lg">{activeCount}</Text>
                <Text className="text-typography-muted text-[9px] uppercase tracking-widest">Active</Text>
              </View>
              <View className="flex-1 bg-surface-card p-3 rounded-xl items-center border border-surface-border">
                <Text className="text-typography-muted font-black text-lg">{rules.length - activeCount}</Text>
                <Text className="text-typography-muted text-[9px] uppercase tracking-widest">Paused</Text>
              </View>
            </View>

            {rules.map((r) => (
              <RuleListItem
                key={r.id}
                rule={r}
                isSelected={false}
                onSelect={() => setSelectedId(r.id)}
                onToggle={handleToggle}
              />
            ))}
          </View>
        </ScrollView>

        <Modal visible={!!selectedId} animationType="slide" onRequestClose={() => setSelectedId(null)}>
          <View className="flex-1 bg-surface-background">
            <View className="pt-12 pb-4 px-4 border-b border-surface-border flex-row items-center gap-4 bg-surface-card">
              <TouchableOpacity
                onPress={() => setSelectedId(null)}
                className="w-10 h-10 items-center justify-center bg-surface-background rounded-full border border-surface-border"
              >
                <FontAwesome name="arrow-left" size={16} color={colors.textMain} />
              </TouchableOpacity>
              <Text className="text-typography-main font-black text-lg">Rule Details</Text>
            </View>
            <RuleInspector
              rule={activeRule}
              isDesktop={false}
              onToggle={handleToggle}
              onEdit={openEdit}
              onDelete={(r) => {
                handleDelete(r);
              }}
            />
          </View>
        </Modal>

        <RuleEditorModal
          visible={editorOpen !== 'closed'}
          existing={editorOpen === 'edit' ? editorTarget : null}
          onClose={closeEditor}
          onSaved={load}
        />
      </View>
    );
  }

  return (
    <View className="flex-1 flex-row bg-surface-background overflow-hidden rounded-[32px] border border-surface-border">
      <View className="w-80 border-r border-surface-border bg-surface-background/40">
        <View className="p-6 border-b border-surface-border flex-row items-center justify-between">
          <View>
            <Text className="text-typography-main font-black text-xl tracking-tight">Notification Rules</Text>
            <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-widest mt-0.5">{rules.length} Total</Text>
          </View>
          <TouchableOpacity
            onPress={openCreate}
            className="w-10 h-10 bg-brand-primary rounded-xl items-center justify-center"
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
          {rules.map((r) => (
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

      <View className="flex-1">
        <RuleInspector
          rule={activeRule}
          isDesktop={true}
          onToggle={handleToggle}
          onEdit={openEdit}
          onDelete={handleDelete}
        />
      </View>

      <RuleEditorModal
        visible={editorOpen !== 'closed'}
        existing={editorOpen === 'edit' ? editorTarget : null}
        onClose={closeEditor}
        onSaved={load}
      />
    </View>
  );
}
