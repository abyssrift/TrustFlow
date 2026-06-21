import { useThemeColors } from '@/hooks/useThemeColors';
import { supabase } from '@/lib/supabase';
import { FontAwesome } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native';

// ── Types mirror rpc_filehub_analytics ───────────────────────────────────────
type Totals = {
  files_sent: number;
  total_bytes: number;
  direct_files: number;
  broadcast_files: number;
  group_files: number;
  recipients_reached: number;
  read_rate: number | null;
};
type SenderRow = { user_id: string; full_name: string | null; avatar_url: string | null; files: number; bytes: number };
type ReceiverRow = { user_id: string; full_name: string | null; avatar_url: string | null; files_received: number; bytes: number };
type ChannelRow = { channel: string; kind: 'direct' | 'broadcast' | 'group'; files: number; bytes: number };
type Analytics = {
  range_days: number;
  totals: Totals;
  top_senders: SenderRow[];
  top_receivers: ReceiverRow[];
  channels: ChannelRow[];
};

const RANGES: { label: string; days: number }[] = [
  { label: '7D', days: 7 },
  { label: '30D', days: 30 },
  { label: '90D', days: 90 },
  { label: 'All', days: 0 },
];

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function initials(name: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
}

const CHANNEL_KIND_LABEL: Record<ChannelRow['kind'], string> = {
  direct: 'Direct',
  broadcast: 'Broadcast',
  group: 'Channel',
};

export default function FileHubAnalytics({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const c = useThemeColors();
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Analytics | null>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const { data: res, error: err } = await supabase.rpc('rpc_filehub_analytics', { p_days: days });
      if (cancelled) return;
      if (err) {
        setError(err.message);
        setData(null);
      } else {
        setData(res as Analytics);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [visible, days]);

  const totals = data?.totals;
  const channelMax = useMemo(
    () => Math.max(1, ...(data?.channels || []).map(ch => ch.files)),
    [data]
  );

  const statCards = totals ? [
    { label: 'Files Sent', value: String(totals.files_sent ?? 0), icon: 'paper-plane', color: c.primary },
    { label: 'Total Volume', value: formatBytes(totals.total_bytes ?? 0), icon: 'database', color: c.accent },
    { label: 'People Reached', value: String(totals.recipients_reached ?? 0), icon: 'users', color: c.success },
    { label: 'Read Rate', value: totals.read_rate == null ? '—' : `${Math.round(totals.read_rate * 100)}%`, icon: 'check-circle', color: c.warning },
  ] : [];

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}>
        <View
          className="w-full rounded-3xl overflow-hidden border"
          style={{ maxWidth: 760, maxHeight: '92%', backgroundColor: c.background, borderColor: c.border }}
        >
          {/* Header */}
          <View className="px-7 pt-6 pb-4 flex-row items-start justify-between border-b" style={{ borderColor: c.border }}>
            <View>
              <Text className="text-[9px] font-black uppercase tracking-[0.3em] mb-1" style={{ color: c.primary }}>Intelligence Hub</Text>
              <Text className="text-2xl font-black tracking-tight" style={{ color: c.textMain }}>File Hub Analytics</Text>
              <Text className="text-xs font-medium mt-0.5" style={{ color: c.textMuted }}>Usage across your company</Text>
            </View>
            <TouchableOpacity onPress={onClose} className="h-10 w-10 items-center justify-center rounded-full border" style={{ borderColor: c.border, backgroundColor: c.card }}>
              <FontAwesome name="times" size={16} color={c.textMuted} />
            </TouchableOpacity>
          </View>

          {/* Range selector */}
          <View className="px-7 pt-4 flex-row items-center gap-2">
            {RANGES.map(r => {
              const active = r.days === days;
              return (
                <TouchableOpacity
                  key={r.days}
                  onPress={() => setDays(r.days)}
                  className="px-4 py-1.5 rounded-lg border"
                  style={{
                    backgroundColor: active ? c.primary + '1A' : c.card,
                    borderColor: active ? c.primary : c.border,
                  }}
                >
                  <Text className="text-xs font-black uppercase tracking-wider" style={{ color: active ? c.primary : c.textMuted }}>{r.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {loading ? (
            <View className="items-center justify-center py-20">
              <ActivityIndicator size="large" color={c.primary} />
            </View>
          ) : error ? (
            <View className="items-center justify-center py-20 px-8">
              <FontAwesome name="exclamation-triangle" size={22} color={c.warning} />
              <Text className="text-sm font-bold mt-3 text-center" style={{ color: c.textMuted }}>{error}</Text>
            </View>
          ) : (
            <ScrollView className="px-7 py-5" contentContainerStyle={{ paddingBottom: 28 }} showsVerticalScrollIndicator={false}>
              {/* Stat cards */}
              <View className="flex-row flex-wrap gap-3">
                {statCards.map(s => (
                  <View
                    key={s.label}
                    className="rounded-2xl border p-4"
                    style={{ flexGrow: 1, flexBasis: 150, backgroundColor: c.card, borderColor: c.border }}
                  >
                    <View className="flex-row items-center gap-2 mb-2">
                      <FontAwesome name={s.icon as any} size={12} color={s.color} />
                      <Text className="text-[9px] font-black uppercase tracking-widest" style={{ color: c.textMuted }}>{s.label}</Text>
                    </View>
                    <Text className="text-2xl font-black tracking-tight" style={{ color: c.textMain }}>{s.value}</Text>
                  </View>
                ))}
              </View>

              {/* Channels ranking */}
              <Section title="Communication Channels" icon="sitemap" color={c.primary} colors={c}>
                {(data?.channels || []).length === 0 ? (
                  <Empty colors={c} label="No channel activity in this period" />
                ) : (
                  <View className="gap-3">
                    {data!.channels.map((ch, i) => (
                      <View key={`${ch.kind}-${ch.channel}-${i}`}>
                        <View className="flex-row items-center justify-between mb-1.5">
                          <View className="flex-row items-center gap-2 flex-1 pr-3">
                            <View className="px-2 py-0.5 rounded-md" style={{ backgroundColor: c.primary + '1A' }}>
                              <Text className="text-[8px] font-black uppercase tracking-wider" style={{ color: c.primary }}>{CHANNEL_KIND_LABEL[ch.kind]}</Text>
                            </View>
                            <Text numberOfLines={1} className="text-sm font-bold flex-1" style={{ color: c.textMain }}>{ch.channel}</Text>
                          </View>
                          <Text className="text-xs font-black" style={{ color: c.textMain }}>{ch.files}</Text>
                          <Text className="text-[10px] font-medium ml-2 w-16 text-right" style={{ color: c.textMuted }}>{formatBytes(ch.bytes)}</Text>
                        </View>
                        <View className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: c.border }}>
                          <View style={{ width: `${Math.max(4, (ch.files / channelMax) * 100)}%`, height: '100%', backgroundColor: c.primary, borderRadius: 999 }} />
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </Section>

              {/* Top senders + receivers */}
              <View className="flex-row flex-wrap gap-5">
                <View style={{ flexGrow: 1, flexBasis: 280 }}>
                  <Section title="Top Senders" icon="upload" color={c.accent} colors={c}>
                    <PeopleList rows={(data?.top_senders || []).map(s => ({ id: s.user_id, name: s.full_name, primary: `${s.files} file${s.files === 1 ? '' : 's'}`, secondary: formatBytes(s.bytes) }))} colors={c} accent={c.accent} />
                  </Section>
                </View>
                <View style={{ flexGrow: 1, flexBasis: 280 }}>
                  <Section title="Top Receivers" icon="download" color={c.success} colors={c}>
                    <PeopleList rows={(data?.top_receivers || []).map(s => ({ id: s.user_id, name: s.full_name, primary: `${s.files_received} file${s.files_received === 1 ? '' : 's'}`, secondary: formatBytes(s.bytes) }))} colors={c} accent={c.success} />
                  </Section>
                </View>
              </View>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ── Small presentational helpers ──────────────────────────────────────────────
function Section({ title, icon, color, colors, children }: { title: string; icon: string; color: string; colors: ReturnType<typeof useThemeColors>; children: React.ReactNode }) {
  return (
    <View className="mt-6">
      <View className="flex-row items-center gap-2 mb-3">
        <FontAwesome name={icon as any} size={12} color={color} />
        <Text className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: colors.textMuted }}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

function Empty({ colors, label }: { colors: ReturnType<typeof useThemeColors>; label: string }) {
  return (
    <View className="py-6 items-center">
      <Text className="text-xs font-medium" style={{ color: colors.textMuted }}>{label}</Text>
    </View>
  );
}

function PeopleList({ rows, colors, accent }: { rows: { id: string; name: string | null; primary: string; secondary: string }[]; colors: ReturnType<typeof useThemeColors>; accent: string }) {
  if (rows.length === 0) return <Empty colors={colors} label="No activity yet" />;
  return (
    <View className="gap-2">
      {rows.map((r, i) => (
        <View key={r.id} className="flex-row items-center rounded-2xl border p-3" style={{ backgroundColor: colors.card, borderColor: colors.border }}>
          <Text className="text-[10px] font-black w-5" style={{ color: colors.textDim }}>{i + 1}</Text>
          <View className="w-9 h-9 rounded-full items-center justify-center mr-3" style={{ backgroundColor: accent + '22' }}>
            <Text className="text-[11px] font-black" style={{ color: accent }}>{initials(r.name)}</Text>
          </View>
          <Text numberOfLines={1} className="flex-1 text-sm font-bold" style={{ color: colors.textMain }}>{r.name || 'Unknown'}</Text>
          <View className="items-end">
            <Text className="text-xs font-black" style={{ color: colors.textMain }}>{r.primary}</Text>
            <Text className="text-[10px] font-medium" style={{ color: colors.textMuted }}>{r.secondary}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}
