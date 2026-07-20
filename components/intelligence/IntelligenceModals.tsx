import AppModal from '@/components/common/AppModal';
import { FontAwesome } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { useThemeColors } from '@/hooks/useThemeColors';
import { Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { IntelligencePicker } from './IntelligenceCommon';

import PremiumCalendarPicker from '@/components/common/PremiumCalendarPicker';

export const TargetCreationModal = ({ visible, onClose, onConfirm, pipelines, stages }: any) => {
  const colors = useThemeColors();
  const [type, setType] = useState('performance');
  const [p, setP] = useState<string | null>(null);
  const [s, setS] = useState<string | null>(null);
  const [activeGoal, setActiveGoal] = useState('3600');
  const [lifeGoal, setLifeGoal] = useState('86400');
  const [quantity, setQuantity] = useState('100');
  const [deadline, setDeadline] = useState<Date | null>(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
  const filteredStages = stages.filter((stage: any) => stage.pipeline_id === p);
  return (
    <AppModal
      visible={visible}
      onClose={onClose}
      dismissOnBackdrop={false}
      containerClassName="w-full max-w-4xl rounded-[40px] overflow-hidden premium-shadow"
    >
      <View className="p-10 border-b" style={{ borderColor: colors.border }}>
        <Text className="text-3xl font-black tracking-tight mb-2" style={{ color: colors.textMain }}>Define Objective</Text>
        <Text className="font-medium" style={{ color: colors.textMuted }}>Establish benchmarks for team performance tracking</Text>
      </View>
      <ScrollView className="p-10 max-h-[600px]">
        <Text className="text-[10px] font-black uppercase tracking-[0.2em] mb-4" style={{ color: colors.textMuted }}>Objective Classification</Text>
        <View className="flex-row p-2 rounded-2xl mb-8 border" style={{ backgroundColor: colors.background, borderColor: colors.border }}>
          {['performance', 'volume'].map(t => (
            <TouchableOpacity
              key={t}
              onPress={() => setType(t)}
              className={`flex-1 py-4 rounded-xl items-center ${type === t ? 'premium-shadow' : ''}`}
              style={{ backgroundColor: type === t ? colors.primary : 'transparent' }}
            >
              <Text className="font-black text-[10px] uppercase tracking-widest" style={{ color: type === t ? 'white' : colors.textMuted }}>{t}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View className="flex-row gap-8 mb-8">
          <View className="flex-1">
            <Text className="text-[10px] font-black uppercase tracking-[0.2em] mb-4" style={{ color: colors.textMuted }}>Strategic Pipeline</Text>
            <IntelligencePicker items={pipelines} selectedId={p} onSelect={(id: string) => { setP(id); setS(null); }} />
          </View>
          <View className="flex-1">
            <Text className="text-[10px] font-black uppercase tracking-[0.2em] mb-4" style={{ color: colors.textMuted }}>Target Node</Text>
            <IntelligencePicker items={filteredStages} selectedId={s} onSelect={setS} disabled={!p} />
          </View>
        </View>
        <Text className="text-[10px] font-black uppercase tracking-[0.2em] mb-4" style={{ color: colors.textMuted }}>Boundary Parameters</Text>
        {type === 'performance' ? (
          <View className="flex-row gap-8">
            <View className="flex-1">
              <Text className="text-[10px] font-bold mb-3" style={{ color: colors.textMuted }}>Target Active Latency (Seconds)</Text>
              <TextInput value={activeGoal} onChangeText={setActiveGoal} keyboardType="numeric" className="border p-5 rounded-2xl font-black text-lg" style={{ backgroundColor: colors.background, borderColor: colors.border, color: colors.textMain }} />
            </View>
            <View className="flex-1">
              <Text className="text-[10px] font-bold mb-3" style={{ color: colors.textMuted }}>Max Life-Cycle (Seconds)</Text>
              <TextInput value={lifeGoal} onChangeText={setLifeGoal} keyboardType="numeric" className="border p-5 rounded-2xl font-black text-lg" style={{ backgroundColor: colors.background, borderColor: colors.border, color: colors.textMain }} />
            </View>
          </View>
        ) : (
          <View className="gap-8">
            <View>
              <Text className="text-[10px] font-bold mb-3" style={{ color: colors.textMuted }}>Tasks (Quota)</Text>
              <TextInput value={quantity} onChangeText={setQuantity} keyboardType="numeric" className="border p-5 rounded-2xl font-black text-lg" style={{ backgroundColor: colors.background, borderColor: colors.border, color: colors.textMain }} />
            </View>
            <View>
              <Text className="text-[10px] font-bold mb-3" style={{ color: colors.textMuted }}>Expiration Deadline</Text>
              <PremiumCalendarPicker
                selectedDate={deadline?.toISOString() || null}
                onSelect={(date) => setDeadline(new Date(date))}
              />
            </View>
          </View>
        )}
      </ScrollView>
      <View className="p-10 border-t flex-row gap-6" style={{ borderColor: colors.border, backgroundColor: `${colors.card}80` }}>
        <TouchableOpacity onPress={onClose} className="flex-1 py-5 rounded-2xl border items-center" style={{ backgroundColor: colors.background, borderColor: colors.border }}>
          <Text className="font-black uppercase tracking-widest text-xs" style={{ color: colors.textMuted }}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          disabled={!s}
          onPress={() => {
            onConfirm({
              stage_id: s,
              target_type: type,
              active: type === 'performance' ? parseInt(activeGoal) : null,
              lifecycle: type === 'performance' ? parseInt(lifeGoal) : null,
              quantity: type === 'volume' ? parseInt(quantity) : null,
              deadline: type === 'volume' ? deadline?.toISOString() : null
            });
            onClose();
          }}
          className="flex-[2] py-5 rounded-2xl items-center shadow-lg transition-all active:scale-[0.98]"
          style={{ backgroundColor: s ? colors.primary : colors.border, opacity: s ? 1 : 0.5 }}
        >
          <Text className="font-black uppercase tracking-widest text-xs" style={{ color: 'white' }}>Create Objective</Text>
        </TouchableOpacity>
      </View>
    </AppModal>
  );
};

const QUICK_REPORT_TYPES = [
  { value: 'performance_audit',        label: 'Overview',          icon: 'bar-chart'     },
  { value: 'user_performance_summary', label: 'Performance Summary', icon: 'user'          },
  { value: 'pipeline_stage_dwell',     label: 'Stage Dwell',       icon: 'clock-o'       },
  { value: 'personnel_comparison',     label: 'People Compare',    icon: 'balance-scale' },
  { value: 'targets_status',           label: 'Targets & SLAs',    icon: 'bullseye'      },
];

export const ReportConfigModal = ({ visible, onClose, onConfirm, pipelines, teams, users, initialDays }: any) => {
  const colors = useThemeColors();
  const [d, setD]       = useState(initialDays);
  const [p, setP]       = useState<string | null>(null);
  const [t, setT]       = useState<string | null>(null);
  const [u, setU]       = useState<string | null>(null);
  const [type, setType] = useState('performance_audit');

  const needsPipeline = type === 'pipeline_stage_dwell';
  const needsUser     = type === 'user_performance_summary';
  const needsWorkers  = type === 'personnel_comparison';
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const toggleUser = (id: string) =>
    setSelectedUserIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const showTemporal = type !== 'targets_status';

  const buildParams = () => {
    const base: any = { days: d, type };
    if (p) base.pipeline_id = p;
    if (t) base.team_id     = t;
    if (u) base.user_id     = u;
    if (needsWorkers && selectedUserIds.length >= 2) base.user_ids = selectedUserIds;
    return base;
  };

  return (
    <AppModal
      visible={visible}
      onClose={onClose}
      dismissOnBackdrop={false}
      containerClassName="w-full max-w-2xl rounded-[40px] overflow-hidden premium-shadow"
    >
      <View className="p-10 border-b" style={{ borderColor: colors.border }}>
        <Text className="text-3xl font-black tracking-tight mb-2" style={{ color: colors.textMain }}>Quick Report</Text>
        <Text className="font-medium" style={{ color: colors.textMuted }}>Generate a report with key parameters</Text>
      </View>
      <ScrollView className="p-10 max-h-[640px]">

        {/* Report type tabs */}
        <Text className="text-[10px] font-black uppercase tracking-[0.2em] mb-4" style={{ color: colors.textMuted }}>Report Type</Text>
        <View className="flex-row flex-wrap gap-2 mb-8">
          {QUICK_REPORT_TYPES.map(rt => (
            <TouchableOpacity
              key={rt.value}
              onPress={() => setType(rt.value)}
              className="flex-row items-center gap-2 px-4 py-3 rounded-2xl border transition-all"
              style={{
                backgroundColor: type === rt.value ? colors.primary : colors.background,
                borderColor: type === rt.value ? colors.primary : colors.border,
              }}
            >
              <FontAwesome name={rt.icon as any} size={12} color={type === rt.value ? 'white' : colors.textMuted} />
              <Text className="text-[10px] font-black uppercase tracking-widest" style={{ color: type === rt.value ? 'white' : colors.textMuted }}>{rt.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Temporal Range */}
        {showTemporal && (
          <>
            <Text className="text-[10px] font-black uppercase tracking-[0.2em] mb-4" style={{ color: colors.textMuted }}>Temporal Range</Text>
            <View className="flex-row gap-4 mb-8">
              {[7, 30, 90, 180].map(val => (
                <TouchableOpacity
                  key={val}
                  onPress={() => setD(val)}
                  className={`flex-1 py-4 rounded-xl border transition-all ${d === val ? 'premium-shadow' : ''}`}
                  style={{ backgroundColor: d === val ? colors.primary : 'transparent', borderColor: d === val ? colors.primary : colors.border }}
                >
                  <Text className="text-center font-black text-[10px] uppercase tracking-widest" style={{ color: d === val ? 'white' : colors.textMuted }}>{val} Days</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        {/* Contextual filters */}
        {type === 'targets_status' ? (
          <View className="border p-6 rounded-3xl" style={{ backgroundColor: `${colors.primary}0d`, borderColor: `${colors.primary}33` }}>
            <Text className="font-black text-sm mb-2" style={{ color: colors.textMain }}>Company-Wide Scope</Text>
            <Text className="text-xs leading-5" style={{ color: colors.textMuted }}>
              All active, hit, and expired performance targets across every pipeline will be included. No filters needed.
            </Text>
          </View>
        ) : (
          <View className="gap-6">
            {!needsUser && !needsWorkers && (
              <View>
                <Text className="text-[10px] font-black uppercase tracking-[0.2em] mb-4" style={{ color: colors.textMuted }}>Pipeline Sector</Text>
                <IntelligencePicker items={[{ id: null, name: 'Global Organization' }, ...pipelines]} selectedId={p} onSelect={setP} />
              </View>
            )}
            {!needsPipeline && !needsUser && !needsWorkers && (
              <>
                <View>
                  <Text className="text-[10px] font-black uppercase tracking-[0.2em] mb-4" style={{ color: colors.textMuted }}>Team Scope</Text>
                  <IntelligencePicker items={[{ id: null, name: 'All Tactical Teams' }, ...teams]} selectedId={t} onSelect={setT} />
                </View>
                <View>
                  <Text className="text-[10px] font-black uppercase tracking-[0.2em] mb-4" style={{ color: colors.textMuted }}>Individual Personnel</Text>
                  <IntelligencePicker items={[{ id: null, name: 'All Active Agents' }, ...users]} selectedId={u} onSelect={setU} labelKey="full_name" />
                </View>
              </>
            )}
            {needsPipeline && (
              <View>
                <Text className="text-[10px] font-black uppercase tracking-[0.2em] mb-4" style={{ color: colors.textMuted }}>Pipeline</Text>
                <IntelligencePicker items={pipelines} selectedId={p} onSelect={setP} />
              </View>
            )}
            {needsUser && (
              <View>
                <Text className="text-[10px] font-black uppercase tracking-[0.2em] mb-4" style={{ color: colors.textMuted }}>Person</Text>
                <IntelligencePicker items={users} selectedId={u} onSelect={setU} labelKey="full_name" />
              </View>
            )}
            {needsWorkers && (
              <View>
                <View className="flex-row items-center mb-4">
                  <Text className="text-[10px] font-black uppercase tracking-[0.2em] flex-1" style={{ color: colors.textMuted }}>People (min 2)</Text>
                  <Text className="text-[10px]" style={{ color: colors.textMuted }}>{selectedUserIds.length} selected</Text>
                </View>
                <View className="flex-row flex-wrap gap-2">
                  {users.map((usr: any) => {
                    const active = selectedUserIds.includes(usr.id);
                    return (
                      <TouchableOpacity
                        key={usr.id}
                        onPress={() => toggleUser(usr.id)}
                        className="px-4 py-2 rounded-xl border"
                        style={{ backgroundColor: active ? colors.primary : colors.background, borderColor: active ? colors.primary : colors.border }}
                      >
                        <Text className="text-[10px] font-black" style={{ color: active ? 'white' : colors.textMuted }}>{usr.full_name}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}
          </View>
        )}
      </ScrollView>
      <View className="p-10 border-t flex-row gap-6" style={{ borderColor: colors.border, backgroundColor: `${colors.card}80` }}>
        <TouchableOpacity onPress={onClose} className="flex-1 py-5 rounded-2xl border items-center" style={{ backgroundColor: colors.background, borderColor: colors.border }}>
          <Text className="font-black uppercase tracking-widest text-xs" style={{ color: colors.textMuted }}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => { onConfirm(buildParams()); onClose(); }}
          className="flex-[2] py-5 rounded-2xl items-center shadow-lg active:scale-[0.98] transition-transform"
          style={{ backgroundColor: colors.primary }}
        >
          <Text className="font-black uppercase tracking-widest text-xs" style={{ color: 'white' }}>Execute Audit Request</Text>
        </TouchableOpacity>
      </View>
    </AppModal>
  );
};

export const WidgetConfigModal = ({ visible, onClose, onSave, currentWidgets }: any) => {
  const colors = useThemeColors();
  const [selected, setSelected] = useState<string[]>(currentWidgets || []);
  useEffect(() => { if (visible) setSelected(currentWidgets || []); }, [visible, currentWidgets]);
  const library = [
    { id: 'throughput', name: 'Throughput', desc: 'Total tasks completed in timeframe' },
    { id: 'efficiency', name: 'Efficiency', desc: 'General success rate' },
    { id: 'flow_ratio', name: 'Flow Ratio', desc: 'Backlog shrinkage (>1) or growth (<1)' },
    { id: 'first_pass_yield', name: 'First-Pass Yield', desc: '% reaching end without revisions' },
    { id: 'automation_offload', name: 'Automation Score', desc: '% handled by machines' }
  ];
  const toggleWidget = (id: string) => {
    if (selected.includes(id)) setSelected(selected.filter(w => w !== id));
    else if (selected.length < 6) setSelected([...selected, id]);
  };
  return (
    <AppModal
      visible={visible}
      onClose={onClose}
      dismissOnBackdrop={false}
      containerClassName="w-full max-w-2xl rounded-[40px] overflow-hidden premium-shadow"
    >
      <View className="p-10 border-b" style={{ borderColor: colors.border }}>
        <Text className="text-3xl font-black mb-1" style={{ color: colors.textMain }}>Radar Telemetry</Text>
        <Text className="text-xs" style={{ color: colors.textMuted }}>Configure the strategic metrics displayed on your hub</Text>
      </View>
      <ScrollView className="p-10 max-h-[500px]">
        {library.map(widget => {
          const isActive = selected.includes(widget.id);
          return (
            <TouchableOpacity
              key={widget.id}
              onPress={() => toggleWidget(widget.id)}
              className="p-6 rounded-2xl border mb-4 flex-row items-center justify-between transition-all"
              style={{ backgroundColor: isActive ? `${colors.primary}0d` : colors.background, borderColor: isActive ? colors.primary : colors.border }}
            >
              <View className="flex-1">
                <Text className="font-black" style={{ color: isActive ? colors.primary : colors.textMain }}>{widget.name}</Text>
                <Text className="text-[10px] mt-1" style={{ color: colors.textMuted }}>{widget.desc}</Text>
              </View>
              <View
                className="w-6 h-6 rounded-full border items-center justify-center"
                style={{ borderColor: isActive ? colors.primary : colors.border, backgroundColor: isActive ? colors.primary : 'transparent' }}
              >
                {isActive && <FontAwesome name="check" size={10} color="white" />}
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      <View className="p-10 border-t flex-row gap-4" style={{ borderColor: colors.border, backgroundColor: `${colors.card}80` }}>
        <TouchableOpacity onPress={onClose} className="flex-1 py-5 rounded-2xl border items-center" style={{ backgroundColor: colors.background, borderColor: colors.border }}>
          <Text className="font-black text-xs" style={{ color: colors.textMuted }}>Dismiss</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => onSave(selected)} className="flex-1 py-5 rounded-2xl items-center shadow-lg" style={{ backgroundColor: colors.primary }}>
          <Text className="font-black text-xs" style={{ color: 'white' }}>Update Matrix</Text>
        </TouchableOpacity>
      </View>
    </AppModal>
  );
};

export const SnapshotDetailModal = ({ visible, onClose, data }: any) => {
  const colors = useThemeColors();
  if (!data) return null;
  const maskData = (obj: any): any => {
    if (!obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(maskData);
    const masked: any = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key.toLowerCase().includes('id') || key.toLowerCase().includes('uuid')) {
        masked[key] = '********-****-****-****-************';
      } else if (typeof value === 'object') {
        masked[key] = maskData(value);
      } else {
        masked[key] = value;
      }
    }
    return masked;
  };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-black/60 items-center justify-center p-20">
        <View className="w-full h-full rounded-[40px] border premium-shadow overflow-hidden" style={{ backgroundColor: colors.card, borderColor: colors.border }}>
          <View className="p-10 border-b flex-row justify-between items-center" style={{ borderColor: colors.border }}>
            <View>
              <Text className="text-3xl font-black mb-1" style={{ color: colors.textMain }}>Snapshot Telemetry</Text>
              <Text className="text-xs" style={{ color: colors.textMuted }}>Deep-inspecting historical data trace (PII Masked)</Text>
            </View>
            <TouchableOpacity onPress={onClose} className="w-12 h-12 rounded-full border items-center justify-center" style={{ backgroundColor: colors.background, borderColor: colors.border }}>
              <FontAwesome name="times" size={16} color={colors.textDim} />
            </TouchableOpacity>
          </View>
          <ScrollView className="p-10" style={{ backgroundColor: colors.background }}>
            <Text className="font-mono text-[11px] leading-relaxed" style={{ color: colors.textMain }}>
              {JSON.stringify(maskData(data), null, 2)}
            </Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};
