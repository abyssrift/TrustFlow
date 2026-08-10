import { useAlert } from '@/contexts/AlertContext';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { supabase } from '@/lib/supabase';
import { FontAwesome } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  ScrollView,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import DraggableSheet from '@/components/common/DraggableSheet';
import RuleEditorModal from '@/components/admin/RuleEditorModal';
import Tooltip from '@/components/common/Tooltip';
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
      className="p-4 mb-2 rounded-xl border"
      style={{
        backgroundColor: isSelected ? colors.primary + '1A' : colors.card,
        borderColor: isSelected ? colors.primary : colors.border,
      }}
    >
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-3 flex-1">
          <View className="w-8 h-8 rounded-lg items-center justify-center border" style={{ backgroundColor: colors.background, borderColor: colors.border }}>
            <FontAwesome name={meta.icon} size={14} color={rule.is_active ? ((colors as any)[meta.colorKey] || colors.primary) : colors.textMuted} />
          </View>
          <View className="flex-1">
            <Text className="font-black text-sm" style={{ color: isSelected ? colors.textMain : colors.textMuted }} numberOfLines={1}>{rule.name}</Text>
            <Text className="text-[10px] uppercase tracking-widest" style={{ color: colors.textMuted }}>{meta.label}</Text>
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
      <View className="flex-1 items-center justify-center p-8" style={{ backgroundColor: colors.background + '4D' }}>
        <View className="p-8 rounded-3xl border border-dashed items-center" style={{ backgroundColor: colors.card, borderColor: colors.border }}>
          <View className="w-14 h-14 rounded-full items-center justify-center mb-4" style={{ backgroundColor: colors.background }}>
            <FontAwesome name="mouse-pointer" size={22} color={colors.textMuted} />
          </View>
          <Text className="text-base font-black tracking-tight" style={{ color: colors.textMain }}>Select a Rule</Text>
          <Text className="mt-2 text-center max-w-[220px] leading-5 text-xs" style={{ color: colors.textMuted }}>Choose a rule from the left to view configuration and logs.</Text>
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
    <View className="flex-1 border-l" style={{ backgroundColor: colors.card, borderColor: colors.border }}>
      {/* Header */}
      <View style={{ padding: headerPad, backgroundColor: colors.background + '80', borderColor: colors.border }} className="border-b">
        <View className="flex-row items-start justify-between">
          <View className="flex-1 mr-3">
            <View className="flex-row items-center gap-2 mb-2 flex-wrap">
              <View className="px-2 py-0.5 rounded-md border" style={{ backgroundColor: colors.primary + '1A', borderColor: colors.primary + '33' }}>
                <Text className="text-[9px] font-black uppercase tracking-wider" style={{ color: colors.primary }}>{rule.event_type}</Text>
              </View>
              <Text className="text-[10px] font-black uppercase tracking-widest" style={{ color: colors.textMuted }}>• ID {rule.id.slice(0, 8)}</Text>
            </View>
            <Text className={`${titleClass} font-black tracking-tighter leading-none mb-2`} style={{ color: colors.textMain }} numberOfLines={2}>{rule.name}</Text>
            <Text className="text-xs font-medium" style={{ color: colors.textMuted }}>{rule.description || 'No description provided.'}</Text>
          </View>

          <View className="items-end">
            <Text className="text-[9px] font-black uppercase mb-1" style={{ color: colors.textMuted }}>Status</Text>
            <View className="flex-row items-center gap-2 mb-3">
              <Text className="text-[11px] font-black" style={{ color: rule.is_active ? colors.success : colors.textMuted }}>
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
              <Tooltip label="Edit rule">
                <TouchableOpacity
                  onPress={() => onEdit(rule)}
                  className="w-10 h-10 rounded-xl border items-center justify-center"
                  style={{ backgroundColor: colors.background, borderColor: colors.border }}
                >
                  <FontAwesome name="pencil" size={14} color={colors.primary} />
                </TouchableOpacity>
              </Tooltip>
              <Tooltip label="Delete rule">
                <TouchableOpacity
                  onPress={() => onDelete(rule)}
                  className="w-10 h-10 rounded-xl border items-center justify-center"
                  style={{ backgroundColor: colors.background, borderColor: colors.border }}
                >
                  <FontAwesome name="trash-o" size={14} color={colors.danger} />
                </TouchableOpacity>
              </Tooltip>
            </View>
          </View>
        </View>
      </View>

      {/* Tabs */}
      <View className="flex-row px-5 border-b" style={{ borderColor: colors.border, backgroundColor: colors.background + '33' }}>
        {(['config', 'test', 'logs'] as const).map((tab) => (
          <TouchableOpacity
            key={tab}
            onPress={() => setActiveTab(tab)}
            className="py-4 mr-6 border-b-2"
            style={{ borderColor: activeTab === tab ? colors.primary : 'transparent' }}
          >
            <View className="flex-row items-center gap-2">
              <FontAwesome
                name={tab === 'config' ? 'sliders' : tab === 'test' ? 'flask' : 'history'}
                size={12}
                color={activeTab === tab ? colors.primary : colors.textMuted}
              />
              <Text className="font-black text-[11px] uppercase tracking-[0.15em]" style={{ color: activeTab === tab ? colors.textMain : colors.textMuted }}>
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
            <View className="p-5 rounded-2xl border" style={{ backgroundColor: colors.background + '80', borderColor: colors.border }}>
              <Text className="text-[10px] font-black uppercase tracking-widest mb-3" style={{ color: colors.textMuted }}>Recipient Logic</Text>
              <View className="flex-row flex-wrap gap-2">
                {rule.recipient_strategies.map((s) => (
                  <View key={s} className="border px-4 py-2.5 rounded-xl" style={{ backgroundColor: colors.card, borderColor: colors.border }}>
                    <View className="flex-row items-center gap-2">
                      <View className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: colors.primary }} />
                      <Text className="font-black text-xs" style={{ color: colors.textMain }}>{STRATEGY_LABELS[s] || s}</Text>
                    </View>
                    <Text className="text-[10px] mt-0.5" style={{ color: colors.textMuted }}>{STRATEGY_HELP[s] || 'Custom strategy'}</Text>
                  </View>
                ))}
              </View>

              {cfgEntries.length > 0 && (
                <View className="mt-4 pt-4 border-t" style={{ borderColor: colors.border }}>
                  <Text className="text-[10px] font-black uppercase tracking-widest mb-2" style={{ color: colors.textMuted }}>Recipient Config</Text>
                  {cfgEntries.map(([k, v]) => (
                    <View key={k} className="flex-row items-center gap-3 py-1">
                      <Text className="text-xs font-mono" style={{ fontFamily: 'monospace', color: colors.textMuted }}>{k}:</Text>
                      <Text className="text-xs font-mono" style={{ fontFamily: 'monospace', color: colors.textMain }} numberOfLines={2}>{JSON.stringify(v)}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>

            {/* Conditions + Channels */}
            <View className={isDesktop ? 'flex-row gap-4' : 'gap-4'}>
              <View className="flex-1 p-5 rounded-2xl border" style={{ backgroundColor: colors.background + '80', borderColor: colors.border }}>
                <Text className="text-[10px] font-black uppercase tracking-widest mb-3" style={{ color: colors.textMuted }}>Conditions</Text>
                {conditionEntries.length === 0 ? (
                  <View className="items-center justify-center py-6">
                    <FontAwesome name="filter" size={20} color={colors.textMuted} style={{ opacity: 0.3, marginBottom: 8 }} />
                    <Text className="text-xs font-bold" style={{ color: colors.textMuted }}>Matches every event</Text>
                  </View>
                ) : (
                  <View className="gap-1">
                    {conditionEntries.map(([k, v]) => (
                      <View key={k} className="flex-row items-center gap-2 px-3 py-2 rounded-lg border" style={{ backgroundColor: colors.card, borderColor: colors.border }}>
                        <Text className="text-[11px] font-mono" style={{ fontFamily: 'monospace', color: colors.textMuted }}>{k}</Text>
                        <Text className="text-[11px]" style={{ color: colors.textMuted }}>=</Text>
                        <Text className="text-[11px] font-mono flex-1" style={{ fontFamily: 'monospace', color: colors.textMain }} numberOfLines={1}>{JSON.stringify(v)}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>

              <View className="flex-1 p-5 rounded-2xl border" style={{ backgroundColor: colors.background + '80', borderColor: colors.border }}>
                <Text className="text-[10px] font-black uppercase tracking-widest mb-3" style={{ color: colors.textMuted }}>Channels</Text>
                <View className="flex-row gap-3 mb-3 flex-wrap">
                  {[
                    { icon: 'envelope', label: 'Email' },
                    { icon: 'mobile',   label: 'Mobile' },
                    { icon: 'globe',    label: 'Web' },
                  ].map((c) => (
                    <View key={c.label} className="items-center gap-1.5">
                      <View className="w-10 h-10 rounded-xl items-center justify-center border" style={{ backgroundColor: colors.primary + '1A', borderColor: colors.primary + '33' }}>
                        <FontAwesome name={c.icon as any} size={14} color={colors.primary} />
                      </View>
                      <Text className="text-[10px] font-bold" style={{ color: colors.textMain }}>{c.label}</Text>
                    </View>
                  ))}
                </View>
                <Text className="text-[10px] leading-4" style={{ color: colors.textMuted }}>
                  Each recipient receives this notification on the channels they have enabled in their preferences.
                </Text>
              </View>
            </View>
          </View>
        )}

        {activeTab === 'test' && (
          <View className="gap-5">
            <View className="p-5 rounded-2xl border" style={{ backgroundColor: colors.background, borderColor: colors.border }}>
              <Text className="text-base font-black mb-1" style={{ color: colors.textMain }}>Rule Simulator</Text>
              <Text className="text-xs leading-5 mb-4" style={{ color: colors.textMuted }}>
                Run server-side recipient resolution for a synthetic <Text className="font-black" style={{ color: colors.primary }}>{rule.event_type}</Text> event. No notifications are sent.
              </Text>

              <Text className="text-[10px] font-black uppercase tracking-widest mb-2" style={{ color: colors.textMuted }}>Task ID</Text>
              <TextInput
                value={simTaskId}
                onChangeText={setSimTaskId}
                placeholder="UUID — used by assignee, task_owner, watchers"
                placeholderTextColor={colors.textDim}
                autoCapitalize="none"
                autoCorrect={false}
                className="rounded-xl px-3 py-2.5 text-xs mb-3 border"
                style={{ backgroundColor: colors.background, borderColor: colors.border, color: colors.textMain }}
              />

              <Text className="text-[10px] font-black uppercase tracking-widest mb-2" style={{ color: colors.textMuted }}>Pipeline ID</Text>
              <TextInput
                value={simPipelineId}
                onChangeText={setSimPipelineId}
                placeholder="UUID — used by pipeline_members"
                placeholderTextColor={colors.textDim}
                autoCapitalize="none"
                autoCorrect={false}
                className="rounded-xl px-3 py-2.5 text-xs mb-3 border"
                style={{ backgroundColor: colors.background, borderColor: colors.border, color: colors.textMain }}
              />

              <Text className="text-[10px] font-black uppercase tracking-widest mb-2" style={{ color: colors.textMuted }}>Extra Payload (JSON)</Text>
              <TextInput
                value={simPayloadJson}
                onChangeText={setSimPayloadJson}
                multiline
                autoCapitalize="none"
                autoCorrect={false}
                placeholderTextColor={colors.textDim}
                className="rounded-xl px-3 py-2.5 text-xs font-mono border"
                style={{ minHeight: 72, fontFamily: 'monospace', backgroundColor: colors.background, borderColor: colors.border, color: colors.textMain }}
              />

              <TouchableOpacity
                onPress={runSimulation}
                disabled={testing}
                activeOpacity={0.8}
                className="mt-5 py-4 rounded-2xl items-center flex-row justify-center gap-3"
                style={{ backgroundColor: colors.primary }}
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
              <View className="p-4 rounded-2xl border" style={{ backgroundColor: colors.danger + '1A', borderColor: colors.danger + '4D' }}>
                <View className="flex-row items-start gap-3">
                  <FontAwesome name="exclamation-triangle" size={16} color={colors.danger} />
                  <View className="flex-1">
                    <Text className="font-black text-xs uppercase tracking-widest mb-1" style={{ color: colors.danger }}>Simulation Error</Text>
                    <Text className="text-xs leading-5" style={{ color: colors.textMuted }}>{simError}</Text>
                  </View>
                </View>
              </View>
            )}

            {simResult && (
              <View className="gap-4">
                <View
                  className="p-5 rounded-2xl border"
                  style={{
                    backgroundColor: (simResult.conditions_match ? colors.success : colors.warning) + '1A',
                    borderColor: (simResult.conditions_match ? colors.success : colors.warning) + '4D',
                  }}
                >
                  <View className="flex-row items-center gap-3 mb-2">
                    <View
                      className="w-9 h-9 rounded-full items-center justify-center"
                      style={{ backgroundColor: simResult.conditions_match ? colors.success : colors.warning }}
                    >
                      <FontAwesome name={simResult.conditions_match ? 'check' : 'times'} size={14} color="white" />
                    </View>
                    <View className="flex-1">
                      <Text className="font-black text-sm" style={{ color: colors.textMain }}>
                        {simResult.conditions_match ? 'Conditions matched' : 'Conditions did not match'}
                      </Text>
                      <Text className="text-[11px]" style={{ color: colors.textMuted }}>
                        {simResult.recipient_count} unique recipient{simResult.recipient_count === 1 ? '' : 's'} resolved (actor not yet excluded)
                      </Text>
                    </View>
                  </View>
                </View>

                <View className="p-5 rounded-2xl border" style={{ backgroundColor: colors.background + '80', borderColor: colors.border }}>
                  <Text className="text-[10px] font-black uppercase tracking-widest mb-3" style={{ color: colors.textMuted }}>Per-Strategy Resolution</Text>
                  {simResult.strategy_log.length === 0 ? (
                    <Text className="text-xs" style={{ color: colors.textMuted }}>No strategies evaluated.</Text>
                  ) : (
                    <View className="gap-2">
                      {simResult.strategy_log.map((s, idx) => (
                        <View key={`${s.strategy}-${idx}`} className="flex-row items-center justify-between px-3 py-2.5 rounded-lg border" style={{ backgroundColor: colors.card, borderColor: colors.border }}>
                          <View>
                            <Text className="text-xs font-black" style={{ color: colors.textMain }}>{STRATEGY_LABELS[s.strategy] || s.strategy}</Text>
                            <Text className="text-[10px]" style={{ color: colors.textMuted }}>{STRATEGY_HELP[s.strategy] || ''}</Text>
                          </View>
                          <View className="px-2.5 py-1 rounded-md" style={{ backgroundColor: colors.primary + '1A' }}>
                            <Text className="text-[10px] font-black" style={{ color: colors.primary }}>{s.resolved_count}</Text>
                          </View>
                        </View>
                      ))}
                    </View>
                  )}
                </View>

                <View className="p-5 rounded-2xl border" style={{ backgroundColor: colors.background + '80', borderColor: colors.border }}>
                  <Text className="text-[10px] font-black uppercase tracking-widest mb-3" style={{ color: colors.textMuted }}>Recipients</Text>
                  {simResult.recipients.length === 0 ? (
                    <Text className="text-xs" style={{ color: colors.textMuted }}>No users matched.</Text>
                  ) : (
                    <View className="gap-2">
                      {simResult.recipients.map((r) => (
                        <View key={r.user_id} className="flex-row items-center gap-3 px-3 py-2.5 rounded-lg border" style={{ backgroundColor: colors.card, borderColor: colors.border }}>
                          <View className="w-8 h-8 rounded-full items-center justify-center" style={{ backgroundColor: colors.primary + '1A' }}>
                            <FontAwesome name="user" size={12} color={colors.primary} />
                          </View>
                          <View className="flex-1">
                            <Text className="text-xs font-black" style={{ color: colors.textMain }} numberOfLines={1}>{r.display_name}</Text>
                            <Text className="text-[10px]" style={{ color: colors.textMuted }} numberOfLines={1}>{r.email}</Text>
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
              <Text className="text-[10px] font-black uppercase tracking-widest" style={{ color: colors.textMuted }}>
                Recent Deliveries{logs ? ` (${logs.length})` : ''}
              </Text>
              <Tooltip label="Reload delivery logs">
                <TouchableOpacity
                  onPress={loadLogs}
                  disabled={logsLoading}
                  className="px-3 py-1.5 rounded-lg border flex-row items-center gap-2"
                  style={{ backgroundColor: colors.background, borderColor: colors.border }}
                >
                  <FontAwesome name="refresh" size={10} color={colors.textMuted} />
                  <Text className="text-[10px] font-black uppercase tracking-widest" style={{ color: colors.textMuted }}>Refresh</Text>
                </TouchableOpacity>
              </Tooltip>
            </View>

            {logsLoading && (
              <View className="py-12 items-center">
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            )}

            {!logsLoading && logsError && (
              <View className="p-4 rounded-xl border" style={{ backgroundColor: colors.danger + '1A', borderColor: colors.danger + '4D' }}>
                <Text className="text-xs font-black" style={{ color: colors.danger }}>{logsError}</Text>
              </View>
            )}

            {!logsLoading && !logsError && logs && logs.length === 0 && (
              <View className="p-8 rounded-2xl border border-dashed items-center" style={{ backgroundColor: colors.background + '80', borderColor: colors.border }}>
                <FontAwesome name="inbox" size={24} color={colors.textMuted} style={{ opacity: 0.4, marginBottom: 8 }} />
                <Text className="font-black text-sm" style={{ color: colors.textMain }}>No deliveries yet</Text>
                <Text className="text-xs mt-1 text-center" style={{ color: colors.textMuted }}>This rule has not produced any notifications yet.</Text>
              </View>
            )}

            {!logsLoading && !logsError && logs && logs.map((d) => {
              const channels = d.channels_sent ?? [];
              const ok = channels.length > 0;
              return (
                <View key={d.id} className="p-4 rounded-2xl border" style={{ backgroundColor: colors.background + '80', borderColor: colors.border }}>
                  <View className="flex-row items-center justify-between mb-2">
                    <View className="flex-row items-center gap-3 flex-1">
                      <View className="w-2 h-2 rounded-full" style={{ backgroundColor: ok ? colors.success : colors.warning }} />
                      <View className="flex-1">
                        <Text className="text-xs font-black" style={{ color: colors.textMain }} numberOfLines={1}>{d.recipient_name}</Text>
                        <Text className="text-[10px]" style={{ color: colors.textMuted }}>{formatTimestamp(d.created_at)}</Text>
                      </View>
                    </View>
                    <View className="flex-row items-center gap-3 px-3 py-1.5 rounded-lg border" style={{ backgroundColor: colors.card, borderColor: colors.border }}>
                      {channels.includes('in_app')      && <FontAwesome name="bell"     size={10} color={colors.primary} />}
                      {channels.includes('email')       && <FontAwesome name="envelope" size={10} color={colors.primary} />}
                      {channels.includes('push_mobile') && <FontAwesome name="mobile"   size={12} color={colors.primary} />}
                      {channels.includes('push_web')    && <FontAwesome name="globe"    size={11} color={colors.primary} />}
                      {channels.length === 0           && <FontAwesome name="ban"      size={10} color={colors.textMuted} />}
                      <Text className="text-[9px] font-black uppercase" style={{ color: colors.textMuted }}>
                        {channels.length === 0 ? 'No channels' : `${channels.length} ch`}
                      </Text>
                    </View>
                  </View>
                  <Text className="text-xs font-bold" style={{ color: colors.textMain }} numberOfLines={1}>{d.title}</Text>
                  <Text className="text-[11px] mt-0.5" style={{ color: colors.textMuted }} numberOfLines={2}>{d.body}</Text>
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
  const isDesktop = width >= 1024;
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
        <Text className="mt-4 font-black text-xs uppercase tracking-widest" style={{ color: colors.textMuted }}>Loading Workspace</Text>
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
              className="w-full h-12 rounded-xl items-center justify-center flex-row gap-2"
              style={{ backgroundColor: colors.primary }}
            >
              <FontAwesome name="plus" size={14} color="white" />
              <Text className="text-white font-black text-xs uppercase tracking-widest">New Rule</Text>
            </TouchableOpacity>

            <View className="flex-row gap-2">
              <View className="flex-1 p-3 rounded-xl items-center border" style={{ backgroundColor: colors.card, borderColor: colors.border }}>
                <Text className="font-black text-lg" style={{ color: colors.success }}>{activeCount}</Text>
                <Text className="text-[9px] uppercase tracking-widest" style={{ color: colors.textMuted }}>Active</Text>
              </View>
              <View className="flex-1 p-3 rounded-xl items-center border" style={{ backgroundColor: colors.card, borderColor: colors.border }}>
                <Text className="font-black text-lg" style={{ color: colors.textMuted }}>{rules.length - activeCount}</Text>
                <Text className="text-[9px] uppercase tracking-widest" style={{ color: colors.textMuted }}>Paused</Text>
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

        {(() => {
          const ruleDetailsContent = (
            <View className="flex-1" style={{ backgroundColor: colors.background }}>
              <View
                className="pt-12 pb-4 px-4 border-b flex-row items-center gap-4"
                style={{ borderColor: colors.border, backgroundColor: colors.card }}
              >
                <TouchableOpacity
                  onPress={() => setSelectedId(null)}
                  className="w-10 h-10 items-center justify-center rounded-full border"
                  style={{ backgroundColor: colors.background, borderColor: colors.border }}
                >
                  <FontAwesome name="arrow-left" size={16} color={colors.textMain} />
                </TouchableOpacity>
                <Text className="font-black text-lg" style={{ color: colors.textMain }}>Rule Details</Text>
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
          );

          if (Platform.OS === 'web') {
            return (
              <DraggableSheet
                visible={!!selectedId}
                onClose={() => setSelectedId(null)}
                maxHeight="100%"
                draggable={false}
                scrollable={false}
                containerClassName=""
              >
                {ruleDetailsContent}
              </DraggableSheet>
            );
          }

          // TODO(#93-native): remove this branch once native is testable — see issue #93/#115.
          // Old raw-Modal path preserved untouched so native behavior doesn't change yet.
          return (
            <Modal visible={!!selectedId} animationType="slide" onRequestClose={() => setSelectedId(null)}>
              {ruleDetailsContent}
            </Modal>
          );
        })()}

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
    <View className="flex-1 flex-row overflow-hidden rounded-[32px] border" style={{ backgroundColor: colors.background, borderColor: colors.border }}>
      <View className="w-80 border-r" style={{ borderColor: colors.border, backgroundColor: colors.background + '66' }}>
        <View className="p-6 border-b flex-row items-center justify-between" style={{ borderColor: colors.border }}>
          <View>
            <Text className="font-black text-xl tracking-tight" style={{ color: colors.textMain }}>Notification Rules</Text>
            <Text className="text-[10px] font-bold uppercase tracking-widest mt-0.5" style={{ color: colors.textMuted }}>{rules.length} Total</Text>
          </View>
          <TouchableOpacity
            onPress={openCreate}
            className="w-10 h-10 rounded-xl items-center justify-center"
            style={{ backgroundColor: colors.primary }}
          >
            <FontAwesome name="plus" size={14} color="white" />
          </TouchableOpacity>
        </View>

        <View className="p-4 border-b flex-row gap-2" style={{ borderColor: colors.border, backgroundColor: colors.background + '99' }}>
          <View className="flex-1 p-2 rounded-lg items-center border" style={{ backgroundColor: colors.card, borderColor: colors.border }}>
            <Text className="font-black text-xs" style={{ color: colors.success }}>{activeCount}</Text>
            <Text className="text-[8px] uppercase" style={{ color: colors.textMuted }}>Active</Text>
          </View>
          <View className="flex-1 p-2 rounded-lg items-center border" style={{ backgroundColor: colors.card, borderColor: colors.border }}>
            <Text className="font-black text-xs" style={{ color: colors.textMuted }}>{rules.length - activeCount}</Text>
            <Text className="text-[8px] uppercase" style={{ color: colors.textMuted }}>Paused</Text>
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
