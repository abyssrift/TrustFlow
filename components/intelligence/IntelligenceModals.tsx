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
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 bg-black/70 items-center justify-center">
        <View className="bg-surface-card w-full max-w-4xl rounded-[40px] border border-surface-border premium-shadow overflow-hidden">
          <View className="p-10 border-b border-surface-border">
            <Text className="text-typography-main text-3xl font-black tracking-tight mb-2">Define Objective</Text>
            <Text className="text-typography-muted font-medium">Establish benchmarks for team performance tracking</Text>
          </View>
          <ScrollView className="p-10 max-h-[600px]">
            <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.2em] mb-4">Objective Classification</Text>
            <View className="flex-row bg-surface-background p-2 rounded-2xl mb-8 border border-surface-border">
              {['performance', 'volume'].map(t => (
                <TouchableOpacity key={t} onPress={() => setType(t)} className={`flex-1 py-4 rounded-xl items-center ${type === t ? 'bg-brand-primary premium-shadow' : 'hover:bg-surface-card/50'}`}>
                  <Text className={`font-black text-[10px] uppercase tracking-widest ${type === t ? 'text-brand-on-primary' : 'text-typography-muted'}`}>{t}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View className="flex-row gap-8 mb-8">
              <View className="flex-1">
                <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.2em] mb-4">Strategic Pipeline</Text>
                <IntelligencePicker items={pipelines} selectedId={p} onSelect={(id: string) => { setP(id); setS(null); }} />
              </View>
              <View className="flex-1">
                <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.2em] mb-4">Target Node</Text>
                <IntelligencePicker items={filteredStages} selectedId={s} onSelect={setS} disabled={!p} />
              </View>
            </View>
            <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.2em] mb-4">Boundary Parameters</Text>
            {type === 'performance' ? (
              <View className="flex-row gap-8">
                <View className="flex-1">
                  <Text className="text-typography-muted text-[10px] font-bold mb-3">Target Active Latency (Seconds)</Text>
                  <TextInput value={activeGoal} onChangeText={setActiveGoal} keyboardType="numeric" className="bg-surface-background border border-surface-border text-typography-main p-5 rounded-2xl font-black text-lg focus:border-brand-primary" />
                </View>
                <View className="flex-1">
                  <Text className="text-typography-muted text-[10px] font-bold mb-3">Max Life-Cycle (Seconds)</Text>
                  <TextInput value={lifeGoal} onChangeText={setLifeGoal} keyboardType="numeric" className="bg-surface-background border border-surface-border text-typography-main p-5 rounded-2xl font-black text-lg focus:border-brand-primary" />
                </View>
              </View>
            ) : (
              <View className="gap-8">
                <View>
                  <Text className="text-typography-muted text-[10px] font-bold mb-3">Tasks (Quota)</Text>
                  <TextInput value={quantity} onChangeText={setQuantity} keyboardType="numeric" className="bg-surface-background border border-surface-border text-typography-main p-5 rounded-2xl font-black text-lg focus:border-brand-primary" />
                </View>
                <View>
                  <Text className="text-typography-muted text-[10px] font-bold mb-3">Expiration Deadline</Text>
                  <PremiumCalendarPicker
                    selectedDate={deadline?.toISOString() || null}
                    onSelect={(date) => setDeadline(new Date(date))}
                  />
                </View>
              </View>
            )}
          </ScrollView>
          <View className="p-10 border-t border-surface-border flex-row gap-6 bg-surface-card/50">
            <TouchableOpacity onPress={onClose} className="flex-1 py-5 rounded-2xl bg-surface-background border border-surface-border items-center">
              <Text className="text-typography-muted font-black uppercase tracking-widest text-xs">Cancel</Text>
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
              className={`flex-[2] py-5 rounded-2xl items-center shadow-lg transition-all active:scale-[0.98] ${s ? 'bg-brand-primary shadow-brand-primary/30' : 'bg-surface-border opacity-50'}`}
            >
              <Text className="text-brand-on-primary font-black uppercase tracking-widest text-xs">Create Objective</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
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
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 bg-black/70 items-center justify-center">
        <View className="bg-surface-card w-full max-w-2xl rounded-[40px] border border-surface-border premium-shadow overflow-hidden">
          <View className="p-10 border-b border-surface-border">
            <Text className="text-typography-main text-3xl font-black tracking-tight mb-2">Quick Report</Text>
            <Text className="text-typography-muted font-medium">Generate a report with key parameters</Text>
          </View>
          <ScrollView className="p-10 max-h-[640px]">

            {/* Report type tabs */}
            <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.2em] mb-4">Report Type</Text>
            <View className="flex-row flex-wrap gap-2 mb-8">
              {QUICK_REPORT_TYPES.map(rt => (
                <TouchableOpacity
                  key={rt.value}
                  onPress={() => setType(rt.value)}
                  className={`flex-row items-center gap-2 px-4 py-3 rounded-2xl border transition-all ${type === rt.value ? 'bg-brand-primary border-brand-primary' : 'border-surface-border bg-surface-background hover:bg-surface-overlay'}`}
                >
                  <FontAwesome name={rt.icon as any} size={12} color={type === rt.value ? 'white' : colors.textMuted} />
                  <Text className={`text-[10px] font-black uppercase tracking-widest ${type === rt.value ? 'text-white' : 'text-typography-muted'}`}>{rt.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Temporal Range */}
            {showTemporal && (
              <>
                <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.2em] mb-4">Temporal Range</Text>
                <View className="flex-row gap-4 mb-8">
                  {[7, 30, 90, 180].map(val => (
                    <TouchableOpacity key={val} onPress={() => setD(val)} className={`flex-1 py-4 rounded-xl border transition-all ${d === val ? 'bg-brand-primary border-brand-primary premium-shadow' : 'border-surface-border hover:bg-surface-background'}`}>
                      <Text className={`text-center font-black text-[10px] uppercase tracking-widest ${d === val ? 'text-brand-on-primary' : 'text-typography-muted'}`}>{val} Days</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            {/* Contextual filters */}
            {type === 'targets_status' ? (
              <View className="bg-brand-primary/5 border border-brand-primary/20 p-6 rounded-3xl">
                <Text className="text-typography-main font-black text-sm mb-2">Company-Wide Scope</Text>
                <Text className="text-typography-muted text-xs leading-5">
                  All active, hit, and expired performance targets across every pipeline will be included. No filters needed.
                </Text>
              </View>
            ) : (
              <View className="gap-6">
                {!needsUser && !needsWorkers && (
                  <View>
                    <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.2em] mb-4">Pipeline Sector</Text>
                    <IntelligencePicker items={[{ id: null, name: 'Global Organization' }, ...pipelines]} selectedId={p} onSelect={setP} />
                  </View>
                )}
                {!needsPipeline && !needsUser && !needsWorkers && (
                  <>
                    <View>
                      <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.2em] mb-4">Team Scope</Text>
                      <IntelligencePicker items={[{ id: null, name: 'All Tactical Teams' }, ...teams]} selectedId={t} onSelect={setT} />
                    </View>
                    <View>
                      <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.2em] mb-4">Individual Personnel</Text>
                      <IntelligencePicker items={[{ id: null, name: 'All Active Agents' }, ...users]} selectedId={u} onSelect={setU} labelKey="full_name" />
                    </View>
                  </>
                )}
                {needsPipeline && (
                  <View>
                    <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.2em] mb-4">Pipeline</Text>
                    <IntelligencePicker items={pipelines} selectedId={p} onSelect={setP} />
                  </View>
                )}
                {needsUser && (
                  <View>
                    <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.2em] mb-4">Person</Text>
                    <IntelligencePicker items={users} selectedId={u} onSelect={setU} labelKey="full_name" />
                  </View>
                )}
                {needsWorkers && (
                  <View>
                    <View className="flex-row items-center mb-4">
                      <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.2em] flex-1">People (min 2)</Text>
                      <Text className="text-typography-muted text-[10px]">{selectedUserIds.length} selected</Text>
                    </View>
                    <View className="flex-row flex-wrap gap-2">
                      {users.map((usr: any) => {
                        const active = selectedUserIds.includes(usr.id);
                        return (
                          <TouchableOpacity
                            key={usr.id}
                            onPress={() => toggleUser(usr.id)}
                            className={`px-4 py-2 rounded-xl border ${active ? 'bg-brand-primary border-brand-primary' : 'bg-surface-background border-surface-border'}`}
                          >
                            <Text className={`text-[10px] font-black ${active ? 'text-white' : 'text-typography-muted'}`}>{usr.full_name}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                )}
              </View>
            )}
          </ScrollView>
          <View className="p-10 border-t border-surface-border flex-row gap-6 bg-surface-card/50">
            <TouchableOpacity onPress={onClose} className="flex-1 py-5 rounded-2xl bg-surface-background border border-surface-border items-center">
              <Text className="text-typography-muted font-black uppercase tracking-widest text-xs">Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { onConfirm(buildParams()); onClose(); }}
              className="flex-[2] py-5 rounded-2xl bg-brand-primary items-center shadow-lg shadow-brand-primary/30 active:scale-[0.98] transition-transform"
            >
              <Text className="text-brand-on-primary font-black uppercase tracking-widest text-xs">Execute Audit Request</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
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
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 bg-black/70 items-center justify-center">
        <View className="bg-surface-card w-full max-w-2xl rounded-[40px] border border-surface-border premium-shadow overflow-hidden">
          <View className="p-10 border-b border-surface-border">
            <Text className="text-typography-main text-3xl font-black mb-1">Radar Telemetry</Text>
            <Text className="text-typography-muted text-xs">Configure the strategic metrics displayed on your hub</Text>
          </View>
          <ScrollView className="p-10 max-h-[500px]">
            {library.map(widget => {
              const isActive = selected.includes(widget.id);
              return (
                <TouchableOpacity key={widget.id} onPress={() => toggleWidget(widget.id)} className={`p-6 rounded-2xl border mb-4 flex-row items-center justify-between transition-all ${isActive ? 'bg-brand-primary/5 border-brand-primary' : 'bg-surface-background border-surface-border'}`}>
                  <View className="flex-1">
                    <Text className={`font-black ${isActive ? 'text-brand-primary' : 'text-typography-main'}`}>{widget.name}</Text>
                    <Text className="text-typography-muted text-[10px] mt-1">{widget.desc}</Text>
                  </View>
                  <View className={`w-6 h-6 rounded-full border items-center justify-center ${isActive ? 'border-brand-primary bg-brand-primary' : 'border-surface-border'}`}>
                    {isActive && <FontAwesome name="check" size={10} color="var(--color-on-primary)" />}
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <View className="p-10 border-t border-surface-border flex-row gap-4 bg-surface-card/50">
            <TouchableOpacity onPress={onClose} className="flex-1 py-5 rounded-2xl bg-surface-background border border-surface-border items-center">
              <Text className="text-typography-muted font-black text-xs">Dismiss</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => onSave(selected)} className="flex-1 py-5 rounded-2xl bg-brand-primary items-center shadow-lg">
              <Text className="text-brand-on-primary font-black text-xs">Update Matrix</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
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
        <View className="bg-surface-card w-full h-full rounded-[40px] border border-surface-border premium-shadow overflow-hidden">
          <View className="p-10 border-b border-surface-border flex-row justify-between items-center">
            <View>
              <Text className="text-typography-main text-3xl font-black mb-1">Snapshot Telemetry</Text>
              <Text className="text-typography-muted text-xs">Deep-inspecting historical data trace (PII Masked)</Text>
            </View>
            <TouchableOpacity onPress={onClose} className="w-12 h-12 rounded-full bg-surface-background border border-surface-border items-center justify-center">
              <FontAwesome name="times" size={16} color={colors.textDim} />
            </TouchableOpacity>
          </View>
          <ScrollView className="p-10 bg-surface-background">
            <Text className="text-typography-main font-mono text-[11px] leading-relaxed">
              {JSON.stringify(maskData(data), null, 2)}
            </Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};
