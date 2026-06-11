import ConfirmModal from '@/components/common/ConfirmModal';
import { BackButton } from '@/components/common/BackButton';
import { IntelligencePicker } from '@/components/intelligence/IntelligenceCommon';

import { useAuth } from '@/contexts/AuthContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { supabase } from '@/lib/supabase';
import { FontAwesome } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, RefreshControl, ScrollView, Text, TouchableOpacity, View } from 'react-native';



// --- UTILITIES & SUB-COMPONENTS (Defined BEFORE main screen to avoid non-hoisted variable errors) ---

const SectionToggle = ({ active, onSelect, hasPermission }: { active: string, onSelect: (s: string) => void, hasPermission: (p: string) => boolean }) => {
  const colors = useThemeColors();
  const sections = ['Radar', 'Archives', 'Analytics'].filter(s => {
    if (s === 'Archives') return hasPermission('archive.view');
    if (s === 'Analytics') return hasPermission('analytics.view');
    return true;
  });
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mx-6 mb-6">
      <View className="flex-row bg-surface-card rounded-2xl p-1 border border-surface-border">
        {sections.map((s) => (
          <TouchableOpacity
            key={s}
            onPress={() => onSelect(s.toLowerCase())}
            className={`px-5 py-3 rounded-xl items-center ${active === s.toLowerCase() ? 'bg-brand-primary' : ''}`}
          >
            <Text className={`font-bold text-xs ${active === s.toLowerCase() ? 'text-white' : 'text-typography-muted'}`}>
              {s}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
};

const KPIBox = ({ label, val, delta }: any) => (
  <View className="flex-1 min-w-[140px] bg-surface-card p-5 rounded-3xl border border-surface-border mb-4">
    <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-wider mb-2">{label}</Text>
    <View className="flex-row items-baseline">
      <Text className="text-typography-main text-2xl font-black">{val}</Text>
      {delta !== undefined && (
        <View className={`ml-2 px-1.5 py-0.5 rounded-md ${delta >= 0 ? 'bg-state-success/10' : 'bg-state-danger/10'}`}>
          <Text className={`text-[9px] font-black ${delta >= 0 ? 'text-state-success' : 'text-state-danger'}`}>
            {delta >= 0 ? '+' : ''}{delta}
          </Text>
        </View>
      )}
    </View>
  </View>
);

const SLARiskAlert = ({ data }: any) => {
  const colors = useThemeColors();
  if (!data?.sla_risks || data.sla_risks.length === 0) return null;
  return (
    <View className="mb-6 bg-state-danger/5 border border-state-danger/20 p-5 rounded-3xl">
      <View className="flex-row items-center mb-4">
        <FontAwesome name="warning" size={14} color={colors.danger} className="mr-2" />
        <Text className="text-state-danger font-bold">SLA Breach Risks</Text>
      </View>
      {data.sla_risks.slice(0, 3).map((r: any, i: number) => (
        <View key={i} className="flex-row justify-between mb-2">
          <Text className="text-typography-main text-xs font-bold">{r.task_number || 'TASK'}</Text>
          <Text className="text-state-danger text-xs font-black">{r.risk_percent}% Risk</Text>
        </View>
      ))}
    </View>
  );
};

const ConversionFunnelChart = ({ data }: any) => {
  const colors = useThemeColors();
  if (!data?.conversion_by_stage) return null;
  return (
    <View className="bg-surface-card p-6 rounded-3xl border border-surface-border mb-6">
      <Text className="text-typography-main font-bold text-lg mb-4">Retention Funnel</Text>
      {data.conversion_by_stage.map((stage: any, idx: number) => {
        const rate = (stage.completion_rate || 0) * 100;
        return (
          <View key={idx} className="mb-4">
            <View className="flex-row justify-between mb-2">
              <Text className="text-typography-muted text-xs font-medium">{stage.stage_name}</Text>
              <Text className="text-brand-primary text-xs font-bold">{Math.round(rate)}%</Text>
            </View>
            <View className="h-2 bg-surface-background rounded-full overflow-hidden">
              <View className="h-full bg-brand-primary opacity-60" style={{ width: `${rate}%` }} />
            </View>
          </View>
        );
      })}
    </View>
  );
};

const WorkDistributionChart = ({ data }: any) => {
  const colors = useThemeColors();
  if (!data?.worker_engagement) return null;
  const top = data.worker_engagement.sort((a: any, b: any) => b.action_count - a.action_count).slice(0, 5);
  return (
    <View className="bg-surface-card p-6 rounded-3xl border border-surface-border mb-6">
      <Text className="text-typography-main font-bold text-lg mb-4">Operator Engagement</Text>
      {top.map((w: any, idx: number) => {
        const max = top[0].action_count;
        const percentage = (w.action_count / (max || 1)) * 100;
        return (
          <View key={idx} className="mb-4">
            <View className="flex-row items-center mb-2 gap-3">
              <View className="w-6 h-6 rounded-full bg-surface-card border border-surface-border overflow-hidden">
                {w.avatar_url ? (
                  <Image source={{ uri: w.avatar_url }} className="w-full h-full" />
                ) : (
                  <View className="w-full h-full items-center justify-center bg-brand-primary/5">
                    <Text className="text-brand-primary font-black text-[8px]">
                      {(w.full_name || 'A')[0].toUpperCase()}
                    </Text>
                  </View>
                )}
              </View>
              <Text className="text-typography-muted text-xs font-medium flex-1">{w.full_name || 'Agent'}</Text>
              <Text className="text-brand-primary text-xs font-bold">{w.action_count} ops</Text>
            </View>
            <View className="h-2 bg-surface-background rounded-full overflow-hidden">
              <View className="h-full bg-brand-primary" style={{ width: `${percentage}%` }} />
            </View>
          </View>
        );
      })}
    </View>
  );
};

const QualityLeaderboard = ({ data }: any) => {
  const colors = useThemeColors();
  if (!data?.quality_by_worker) return null;
  const best = data.quality_by_worker.sort((a: any, b: any) => a.revision_rate - b.revision_rate).slice(0, 5);
  return (
    <View className="bg-surface-card p-6 rounded-3xl border border-surface-border mb-6">
      <Text className="text-typography-main font-bold text-lg mb-4">Quality Scoreboard</Text>
      {best.map((w: any, idx: number) => (
        <View key={idx} className="flex-row justify-between mb-3 items-center">
          <View className="flex-row items-center gap-3">
            <View className="w-6 h-6 rounded-full bg-surface-card border border-surface-border overflow-hidden">
              {w.avatar_url ? (
                <Image source={{ uri: w.avatar_url }} className="w-full h-full" />
              ) : (
                <View className="w-full h-full items-center justify-center bg-brand-primary/5">
                  <Text className="text-brand-primary font-black text-[8px]">
                    {(w.full_name || 'A')[0].toUpperCase()}
                  </Text>
                </View>
              )}
            </View>
            <Text className="text-typography-muted text-xs">{w.full_name || 'Agent'}</Text>
          </View>
          <View className="flex-row items-center">
            <View className="bg-state-success/10 px-2 py-0.5 rounded-lg mr-2">
              <Text className="text-state-success text-[10px] font-black">{Math.round(100 - (w.revision_rate || 0))}%</Text>
            </View>
            <FontAwesome name="star" size={10} color={colors.warning} />
          </View>
        </View>
      ))}
    </View>
  );
};

const TrendComparisonCards = ({ data }: any) => {
  const colors = useThemeColors();
  if (!data?.current || !data?.comparison) return null;
  const c = data.current;
  const p = data.comparison;
  const metrics = [
    { label: 'Yield Variance', cur: c.success_rate, prev: p.success_rate, unit: '%' },
    { label: 'Latency Drift', cur: c.avg_lead_time_minutes, prev: p.avg_lead_time_minutes, unit: 'm', reverse: true }
  ];
  return (
    <View className="flex-row flex-wrap gap-4 mb-6">
      {metrics.map((m, i) => {
        const diff = (m.cur || 0) - (m.prev || 0);
        const isBetter = m.reverse ? diff <= 0 : diff >= 0;
        return (
          <View key={i} className="flex-1 bg-surface-card p-4 rounded-2xl border border-surface-border">
            <Text className="text-typography-muted text-[9px] font-bold uppercase mb-2">{m.label}</Text>
            <View className="flex-row items-center">
              <Text className="text-typography-main font-black text-lg">{Math.round(m.cur || 0)}{m.unit}</Text>
              <View className={`ml-2 px-1 rounded ${isBetter ? 'bg-state-success/10' : 'bg-state-danger/10'}`}>
                <Text className={`text-[8px] font-black ${isBetter ? 'text-state-success' : 'text-state-danger'}`}>{diff > 0 ? '+' : ''}{Math.round(diff)}</Text>
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
};

const RadarSection = ({ data, activeWidgets, onEditWidgets }: any) => {
  const colors = useThemeColors();
  if (!data) return <View className="py-20"><ActivityIndicator color={colors.primary} /></View>;
  const curThr = data.current?.throughput || 0;
  const prevThr = data.comparison?.throughput || 0;
  const adv = data.radar_advanced || {};
  const curr = data.current || {};
  const renderWidget = (key: string, idx: number) => {
    switch (key) {
      case 'throughput': return <KPIBox key={idx} label="Throughput" val={curThr} delta={curThr - prevThr} />;
      case 'efficiency': return <KPIBox key={idx} label="Efficiency" val={`${Math.round(curr.success_rate || 0)}%`} delta={undefined} />;
      case 'flow_ratio': return <KPIBox key={idx} label="Flow Ratio" val={adv.flow_ratio || 'N/A'} delta={undefined} />;
      case 'first_pass_yield': return <KPIBox key={idx} label="First-Pass Yield" val={`${adv.first_pass_yield || 0}%`} delta={undefined} />;
      case 'automation_offload': return <KPIBox key={idx} label="Cyborg Score" val={`${adv.automation_offload_rate || 0}%`} delta={undefined} />;
      default: return null;
    }
  };
  return (
    <View>
      <View className="flex-row justify-between items-end mb-4">
        <Text className="text-typography-main font-bold text-lg">Active Telemetry</Text>
        <TouchableOpacity onPress={onEditWidgets}>
          <Text className="text-brand-primary text-[10px] font-bold uppercase tracking-wider">Customize</Text>
        </TouchableOpacity>
      </View>
      <View className="flex-row flex-wrap justify-between mb-6">
        {activeWidgets.map((w: string, i: number) => renderWidget(w, i))}
      </View>
      <SLARiskAlert data={data} />
      <Text className="text-typography-main font-bold text-lg mb-4">Pipeline Load Distribution</Text>
      <View className="bg-surface-card p-6 rounded-3xl border border-surface-border mb-6">
        {!data.conversion_by_stage || data.conversion_by_stage.length === 0 ? (
          <Text className="text-typography-muted text-sm text-center py-4">No stage activity data available.</Text>
        ) : (
          data.conversion_by_stage.map((f: any, i: number) => {
            const maxCount = Math.max(1, ...data.conversion_by_stage.map((s: any) => s.task_count || 0));
            return (
              <View key={i} className="mb-4">
                <View className="flex-row justify-between mb-2">
                  <Text className="text-typography-muted text-xs font-medium flex-1 mr-2" numberOfLines={1}>{f.stage_name}</Text>
                  <Text className="text-typography-main text-xs font-bold">{f.task_count ?? 0}</Text>
                </View>
                <View className="h-2 bg-surface-background rounded-full overflow-hidden">
                  <View className="h-full bg-brand-primary rounded-full" style={{ width: `${Math.min(((f.task_count || 0) / maxCount) * 100, 100)}%` }} />
                </View>
              </View>
            );
          })
        )}
      </View>
      <ConversionFunnelChart data={data} />
      <WorkDistributionChart data={data} />
      <QualityLeaderboard data={data} />
      <TrendComparisonCards data={data} />
    </View>
  );
};



const ArchivesSection = ({ reports, onDownload, onNew, coldArchives, activeSchema, currentSubSection, setSubSection, onSelectArchive, hasPermission }: any) => {
  const colors = useThemeColors();
  return (
  <View>
    <View className="flex-row bg-surface-background p-1 rounded-xl mb-6">
      <TouchableOpacity onPress={() => setSubSection('reports')} className={`flex-1 py-2 rounded-lg items-center ${currentSubSection === 'reports' ? 'bg-brand-primary' : ''}`}>
        <Text className={`font-bold text-[10px] uppercase ${currentSubSection === 'reports' ? 'text-white' : 'text-typography-muted'}`}>Audit Reports</Text>
      </TouchableOpacity>
      {hasPermission('archive.view') && (
        <TouchableOpacity onPress={() => setSubSection('storage')} className={`flex-1 py-2 rounded-lg items-center ${currentSubSection === 'storage' ? 'bg-brand-primary' : ''}`}>
          <Text className={`font-bold text-[10px] uppercase ${currentSubSection === 'storage' ? 'text-white' : 'text-typography-muted'}`}>Cold Storage</Text>
        </TouchableOpacity>
      )}
    </View>
    {currentSubSection === 'reports' ? (
      <>
        <TouchableOpacity onPress={onNew} className="bg-surface-card p-6 rounded-3xl border border-dashed border-brand-primary/40 mb-6 items-center flex-row justify-center">
          <FontAwesome name="plus-circle" size={16} color={colors.primary} className="mr-3" />
          <Text className="text-brand-primary font-bold text-sm">Generate Report</Text>
        </TouchableOpacity>
        {reports.map((r: any, i: number) => (
          <TouchableOpacity key={i} onPress={() => r.file_url && onDownload(r.file_url)} className="bg-surface-card p-5 rounded-2xl border border-surface-border mb-4 flex-row items-center">
            <View className={`w-12 h-12 rounded-xl items-center justify-center mr-4 ${r.status === 'completed' ? 'bg-state-success/10' : 'bg-state-info/10'}`}>
              <FontAwesome name="file-text-o" size={18} color={r.status === 'completed' ? colors.success : colors.primary} />
            </View>
            <View className="flex-1">
              <Text className="text-typography-main font-bold">Report #{r.id.substring(0, 6)}</Text>
              <Text className="text-typography-muted text-xs">{new Date(r.created_at).toLocaleDateString()} • {r.status}</Text>
            </View>
            <FontAwesome name="chevron-right" size={12} color={colors.textMuted} />
          </TouchableOpacity>
        ))}
      </>
    ) : (
      <>
        {coldArchives.length === 0 ? (
          <View className="py-10 items-center justify-center">
            <FontAwesome name="archive" size={40} className="text-surface-border mb-4" />
            <Text className="text-typography-muted text-center font-bold">No assets in cold storage</Text>
          </View>
        ) : (
          coldArchives.map((archive: any) => {
            const pipelineId = archive.snapshot?.pipeline_id || archive.snapshot?.child_tasks?.[0]?.pipeline_id;
            const hasIntegrityIssue = pipelineId && !activeSchema.pipelines.has(pipelineId);
            return (
              <TouchableOpacity key={archive.id} onPress={() => onSelectArchive(archive)} className="bg-surface-card p-5 rounded-2xl border border-surface-border mb-4 flex-row items-center">
                <View className={`w-12 h-12 rounded-xl items-center justify-center mr-4 ${archive.restored_at ? 'bg-state-success/10' : 'bg-surface-background'}`}>
                  <FontAwesome name={archive.entity_type === 'project' ? 'briefcase' : 'tasks'} size={18} className={archive.restored_at ? 'text-state-success' : 'text-brand-primary'} />
                </View>
                <View className="flex-1">
                  <Text className="text-typography-main font-bold" numberOfLines={1}>
                    {archive.metadata?.title || archive.metadata?.name || 'Untitled'}
                  </Text>
                  <View className="flex-row items-center">
                    <Text className="text-typography-muted text-[10px]">{new Date(archive.archived_at).toLocaleDateString()}</Text>
                    {hasIntegrityIssue && (
                      <View className="ml-2 bg-state-danger/10 px-1.5 py-0.5 rounded flex-row items-center">
                        <FontAwesome name="warning" size={8} className="text-state-danger mr-1" />
                        <Text className="text-state-danger text-[8px] font-black uppercase">Broken</Text>
                      </View>
                    )}
                    {archive.restored_at && (
                      <View className="ml-2 bg-state-success/10 px-1.5 py-0.5 rounded">
                        <Text className="text-state-success text-[8px] font-black uppercase">Restored</Text>
                      </View>
                    )}
                  </View>
                </View>
                <FontAwesome name="chevron-right" size={12} color={colors.textMuted} />
              </TouchableOpacity>
            );
          })
        )}
      </>
    )}
  </View>
  );
};

const ReportConfigModal = ({ visible, onClose, onConfirm, pipelines, teams, users, initialDays }: any) => {
  const colors = useThemeColors();
  const [d, setD] = useState(initialDays);
  const [p, setP] = useState<string | null>(null);
  const [t, setT] = useState<string | null>(null);
  const [u, setU] = useState<string | null>(null);
  const [type, setType] = useState('performance_audit');
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 bg-black/70 items-center justify-center px-6">
        <View className="bg-surface-card w-full max-h-[85%] rounded-[32px] border border-surface-border overflow-hidden">
          <View className="p-8 pb-4">
            <Text className="text-typography-main text-2xl font-black mb-1">Audit Configuration</Text>
            <Text className="text-typography-muted text-xs">Define intelligence boundaries</Text>
          </View>
          <ScrollView className="px-8" showsVerticalScrollIndicator={false}>
            <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-widest mt-4 mb-3">Timeframe</Text>
            <View className="flex-row gap-2">
              {[7, 30, 90].map(val => (
                <TouchableOpacity key={val} onPress={() => setD(val)} className={`flex-1 py-3 rounded-xl border ${d === val ? 'bg-brand-primary border-brand-primary' : 'border-surface-border'}`}>
                  <Text className={`text-center font-bold text-xs ${d === val ? 'text-white' : 'text-typography-muted'}`}>{val} Days</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-widest mt-6 mb-3">Target Pipeline</Text>
            <IntelligencePicker items={[{ id: null, name: 'Organization Wide' }, ...pipelines]} selectedId={p} onSelect={setP} />
            <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-widest mt-6 mb-3">Filtered Team</Text>
            <IntelligencePicker items={[{ id: null, name: 'All Teams' }, ...teams]} selectedId={t} onSelect={setT} />
            <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-widest mt-6 mb-3">Individual Scope</Text>
            <IntelligencePicker items={[{ id: null, name: 'Everyone' }, ...users]} selectedId={u} onSelect={setU} labelKey="full_name" />
            <View className="h-10" />
          </ScrollView>
          <View className="p-8 pt-4 flex-row gap-3 border-t border-surface-border bg-surface-card">
            <TouchableOpacity onPress={onClose} className="flex-1 py-4 rounded-2xl bg-surface-background border border-surface-border items-center">
              <Text className="text-typography-muted font-bold">Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { onConfirm({ days: d, pipeline_id: p, team_id: t, user_id: u, type }); onClose(); }} className="flex-1 py-4 rounded-2xl bg-brand-primary items-center shadow-lg shadow-brand-primary/30">
              <Text className="text-white font-bold">Generate</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const WidgetConfigModal = ({ visible, onClose, onSave, currentWidgets }: any) => {
  const colors = useThemeColors();
  const [selected, setSelected] = useState<string[]>(currentWidgets || []);
  useEffect(() => { if (visible) setSelected(currentWidgets || []); }, [visible, currentWidgets]);
  const library = [
    { id: 'throughput', name: 'Throughput', desc: 'Total tasks completed' },
    { id: 'efficiency', name: 'Efficiency', desc: 'General success rate' },
    { id: 'flow_ratio', name: 'Flow Ratio', desc: 'Backlog shrinkage vs growth' },
    { id: 'first_pass_yield', name: 'First-Pass Yield', desc: '% no revisions' },
    { id: 'automation_offload', name: 'Cyborg Score', desc: '% machine handled' }
  ];
  const toggle = (id: string) => {
    if (selected.includes(id)) setSelected(selected.filter(w => w !== id));
    else if (selected.length < 4) setSelected([...selected, id]);
  };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 bg-black/70 items-center justify-center px-6">
        <View className="bg-surface-card w-full max-h-[80%] rounded-[32px] border border-surface-border overflow-hidden">
          <View className="p-8 pb-4">
            <Text className="text-typography-main text-2xl font-black mb-1">Radar Matrix</Text>
            <Text className="text-typography-muted text-xs">Select up to 4 core telemetry widgets</Text>
          </View>
          <ScrollView className="px-8">
            {library.map(w => {
              const active = selected.includes(w.id);
              return (
                <TouchableOpacity key={w.id} onPress={() => toggle(w.id)} className={`p-4 rounded-2xl border mb-3 flex-row items-center justify-between ${active ? 'bg-brand-primary/5 border-brand-primary' : 'bg-surface-background border-surface-border'}`}>
                   <View className="flex-1">
                      <Text className={`font-bold ${active ? 'text-brand-primary' : 'text-typography-main'}`}>{w.name}</Text>
                      <Text className="text-typography-muted text-[10px] mt-1">{w.desc}</Text>
                   </View>
                   <View className={`w-5 h-5 rounded-full border items-center justify-center ${active ? 'bg-brand-primary border-brand-primary' : 'border-surface-border'}`}>
                      {active && <FontAwesome name="check" size={8} color="white" />}
                   </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <View className="p-8 pt-4 flex-row gap-3 border-t border-surface-border bg-surface-card">
            <TouchableOpacity onPress={onClose} className="flex-1 py-4 rounded-2xl bg-surface-background border border-surface-border items-center">
              <Text className="text-typography-muted font-bold">Dismiss</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => onSave(selected)} className="flex-1 py-4 rounded-2xl bg-brand-primary items-center">
              <Text className="text-white font-bold">Apply Matrix</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const DataTree = ({ data, level = 0 }: { data: any; level?: number }) => {
  const colors = useThemeColors();
  if (!data || typeof data !== 'object') return <Text className="text-typography-main font-mono text-[10px]">{String(data)}</Text>;
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
  const maskedData = maskData(data);
  return (
    <View style={{ marginLeft: level * 12 }}>
      {Object.entries(maskedData).map(([key, val]: [string, any], idx) => (
        <View key={idx} className="mb-2">
          <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest">{key}</Text>
          {typeof val === 'object' && val !== null ? (
            <DataTree data={val} level={level + 1} />
          ) : (
            <Text className="text-typography-main font-mono text-[11px] leading-relaxed bg-surface-background/50 p-2 rounded-lg mt-1 border border-surface-border/30">
              {String(val)}
            </Text>
          )}
        </View>
      ))}
    </View>
  );
};

const ArchiveDetailModal = ({ visible, onClose, archive, activeSchema, onRestore, hasPermission }: any) => {
  const colors = useThemeColors();
  if (!archive) return null;
  const pipelineId = archive.snapshot?.pipeline_id || archive.snapshot?.child_tasks?.[0]?.pipeline_id;
  const hasIntegrityIssue = pipelineId && !activeSchema.pipelines.has(pipelineId);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-black/80 justify-end">
        <View className="bg-surface-card rounded-t-[40px] border-t border-surface-border h-[90%] overflow-hidden">
          <View className="w-12 h-1.5 bg-surface-border rounded-full mx-auto my-4" />
          <View className="px-8 pb-4 border-b border-surface-border flex-row justify-between items-center">
            <View className="flex-1">
              <Text className="text-typography-main text-xl font-black mb-1">
                {archive.metadata?.title || archive.metadata?.name || 'Untitled'}
              </Text>
              <Text className="text-typography-muted text-xs uppercase tracking-widest font-bold">
                {archive.entity_type} Snapshot
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} className="w-10 h-10 rounded-full bg-surface-background border border-surface-border items-center justify-center">
              <FontAwesome name="times" size={14} className="text-typography-dim" />
            </TouchableOpacity>
          </View>
          <ScrollView className="px-8 pt-6" showsVerticalScrollIndicator={false}>
            {hasIntegrityIssue && (
              <View className="bg-state-danger/10 border border-state-danger/20 p-5 rounded-2xl mb-8">
                <View className="flex-row items-center mb-2">
                   <FontAwesome name="warning" size={16} color={colors.danger} className="mr-3" />
                   <Text className="text-state-danger font-black">Integrity Breach Detected</Text>
                </View>
                <Text className="text-state-danger/70 text-xs font-bold leading-relaxed">
                   The target pipeline for this archive no longer exists. Direct restoration is locked to prevent orphaned data. Administrative remapping required.
                </Text>
              </View>
            )}
            <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[2px] mb-6">Snapshot Data Trace</Text>
            <DataTree data={archive.snapshot} />
            <View className="h-40" />
          </ScrollView>
          <View className="p-8 bg-surface-card border-t border-surface-border flex-row gap-4">
             <TouchableOpacity onPress={onClose} className="flex-1 py-4 rounded-2xl bg-surface-background border border-surface-border items-center">
                <Text className="text-typography-muted font-bold">Dismiss</Text>
             </TouchableOpacity>
             {!archive.restored_at && !hasIntegrityIssue && hasPermission('archive.restore') && (
               <TouchableOpacity onPress={() => onRestore(archive.id)} className="flex-1 py-4 rounded-2xl bg-brand-primary items-center">
                  <Text className="text-white font-bold">Restore Asset</Text>
               </TouchableOpacity>
             )}
          </View>
        </View>
      </View>
    </Modal>
  );
};

// --- MAIN SCREEN COMPONENT ---

export default function IntelligenceScreen() {
  const colors = useThemeColors();
  const { section } = useLocalSearchParams();
  const router = useRouter();
  const { hasPermission, profile } = useAuth();

  const [activeSection, setActiveSection] = useState((section as string) || 'radar');
  const [loading, setLoading] = useState(true);
  const [showReportModal, setShowReportModal] = useState(false);
  // Core Data State
  const [data, setData] = useState<any>(null);
  const [reports, setReports] = useState<any[]>([]);
  const [pipelines, setPipelines] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [coldArchives, setColdArchives] = useState<any[]>([]);
  const [activeSchema, setActiveSchema] = useState<{ pipelines: Set<string>, stages: Set<string> }>({
    pipelines: new Set(),
    stages: new Set()
  });
  const [archiveSearch, setArchiveSearch] = useState('');
  const [archiveSection, setArchiveSection] = useState<'reports' | 'storage'>('reports');
  const [selectedArchive, setSelectedArchive] = useState<any>(null);
  const [confirmRestore, setConfirmRestore] = useState<{ visible: boolean; archiveId: string | null }>({ visible: false, archiveId: null });
  const [restoring, setRestoring] = useState(false);

  // Current Global State
  const [days, setDays] = useState(30);
  const [pipelineId, setPipelineId] = useState<string | null>(null);

  // Widget Customization State
  const DEFAULT_WIDGETS = ['throughput', 'efficiency', 'flow_ratio', 'first_pass_yield'];
  const [activeWidgets, setActiveWidgets] = useState<string[]>(DEFAULT_WIDGETS);
  const [showWidgetModal, setShowWidgetModal] = useState(false);

  useEffect(() => {
    const colors = useThemeColors();
    AsyncStorage.getItem('@TrustFlow_radar_widgets').then(val => {
      if (val) setActiveWidgets(JSON.parse(val));
    });
    fetchBaseData();
  }, []);

  useEffect(() => {
    if (section && typeof section === 'string') {
      if (section === 'archives' && !hasPermission('archive.view')) {
        setActiveSection('radar');
        return;
      }
      setActiveSection(section);
    }
  }, [section, hasPermission]);

  const handleSaveWidgets = async (widgets: string[]) => {
    setActiveWidgets(widgets);
    setShowWidgetModal(false);
    await AsyncStorage.setItem('@TrustFlow_radar_widgets', JSON.stringify(widgets));
  };

  useEffect(() => {
    let isMounted = true;
    const fetch = async () => {
      if (!isMounted) return;
      if (activeSection === 'radar') await fetchAudit();
      if (activeSection === 'archives') await fetchReports();
    };
    fetch();
    return () => { isMounted = false; };
  }, [activeSection, pipelineId, days]);

  const fetchBaseData = async () => {
    const { data: p } = await supabase.from('pipelines').select('id, name').is('deleted_at', null);
    const { data: t } = await supabase.from('teams').select('id, name').is('deleted_at', null);
    const { data: u } = await supabase.from('users').select('id, full_name');
    if (p) setPipelines(p);
    if (t) setTeams(t);
    if (u) setUsers(u);
  };

  const fetchAudit = async () => {
    try {
      setLoading(true);
      const { data: res, error } = await supabase.rpc('rpc_get_organizational_audit', {
        p_pipeline_id: pipelineId,
        p_days: days
      });
      if (error) throw error;
      setData(res);
    } catch (err) {
      console.error('Audit Error:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchReports = async () => {
    try {
      setLoading(true);
      const { data: res } = await supabase.from('reporting_jobs').select('*').order('created_at', { ascending: false });
      setReports(res || []);
      await fetchColdArchives();
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };

  const fetchColdArchives = async () => {
    try {
      const { data: archiveData, error: archiveError } = await supabase.rpc('rpc_get_archives', {
        p_search: archiveSearch || null
      });
      if (archiveError) throw archiveError;
      setColdArchives(archiveData || []);

      const [pipelinesRes, stagesRes] = await Promise.all([
        supabase.from('pipelines').select('id'),
        supabase.from('pipeline_stages').select('id')
      ]);

      setActiveSchema({
        pipelines: new Set(pipelinesRes.data?.map(p => p.id) || []),
        stages: new Set(stagesRes.data?.map(s => s.id) || [])
      });
    } catch (err) {
      console.error('[Intelligence] Mobile Archive fetch failed:', err);
    }
  };

  const handleExportPDF = async (params: any) => {
    try {
      setLoading(true);
      const { error } = await supabase.rpc('rpc_request_report', {
        p_report_type: params.type || 'performance_audit',
        p_parameters: {
          days: params.days,
          pipeline_id: params.pipeline_id,
          team_id: params.team_id,
          user_id: params.user_id
        }
      });
      if (error) throw error;
      Alert.alert('Processing', 'Your report is being generated.');
      if (activeSection === 'archives') fetchReports();
    } catch (err: any) {
      Alert.alert('Failure', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadReport = async (path: string) => {
    const { data, error } = await supabase.storage.from('reports').createSignedUrl(path, 60);
    if (data?.signedUrl) Linking.openURL(data.signedUrl);
  };

  const handleRestore = async () => {
    if (!confirmRestore.archiveId) return;
    setRestoring(true);
    try {
      const { data: newId, error } = await supabase.rpc(
        selectedArchive?.entity_type === 'project' ? 'rpc_restore_project' : 'rpc_restore_archive',
        { p_archive_id: confirmRestore.archiveId }
      );

      if (error) throw error;

      Alert.alert('Success', 'Asset has been restored to the active pipeline.');
      setConfirmRestore({ visible: false, archiveId: null });
      setSelectedArchive(null);
      fetchColdArchives();
    } catch (err: any) {
      Alert.alert('Restoration Failed', err.message);
    } finally {
      setRestoring(false);
    }
  };

  return (
    <View className="flex-1 bg-surface-background">
      <ScrollView className="flex-1" stickyHeaderIndices={[1]} refreshControl={<RefreshControl refreshing={false} onRefresh={fetchAudit} />}>
        {/* Header */}
        <View className="px-6 pt-12 pb-6">
          <View className="flex-row items-start justify-between mb-4">
            <View className="flex-1">
              <Text className="text-brand-primary font-black uppercase tracking-[4px] text-[10px] mb-1">Intelligence Center</Text>
              <Text className="text-typography-main text-3xl font-black">Audit Hub</Text>
            </View>
            <BackButton label="" />
          </View>
        </View>

        {/* Section Toggle */}
        <SectionToggle
          active={activeSection}
          onSelect={(s) => {
            if (s === 'analytics') { router.push('/intelligence/analytics' as any); return; }
            setActiveSection(s);
          }}
          hasPermission={hasPermission}
        />

        {/* Main Sections */}
        <View className="px-6">
          {loading ? (
            <View className="py-20"><ActivityIndicator color={colors.primary} /></View>
          ) : pipelines.length === 0 ? (
            <View className="py-10 items-center justify-center">
              <View className="bg-surface-card p-8 rounded-[2rem] border border-surface-border items-center w-full premium-shadow">
                <View className="w-16 h-16 bg-brand-primary/10 rounded-full items-center justify-center mb-6">
                  <FontAwesome name="line-chart" size={24} color={colors.primary} />
                </View>

                {hasPermission('pipeline.edit') ? (
                  <>
                    <Text className="text-typography-main text-xl font-black mb-2 text-center">Setup Required</Text>
                    <Text className="text-typography-muted text-center mb-6 text-xs leading-relaxed">
                      No pipelines found. Analytics require at least one active pipeline to function.
                    </Text>
                    <TouchableOpacity
                      onPress={() => router.push('/admin/pipelines')}
                      className="bg-brand-primary px-8 py-4 rounded-xl active:scale-95"
                    >
                      <Text className="text-white font-black uppercase tracking-widest text-[10px]">Configure</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <View className="bg-state-info-dim border border-state-info/20 p-6 rounded-2xl w-full">
                    <View className="flex-row items-start">
                      <FontAwesome name="info-circle" size={16} color={colors.info} style={{ marginTop: 2 }} />
                      <View className="ml-4 flex-1">
                         <Text className="text-typography-main text-sm font-black mb-1">Access Restricted</Text>
                         <Text className="text-typography-muted text-[11px] font-bold leading-relaxed">
                           Either no pipelines exist now, or they're not privileged enough to see them, contact company Admin
                         </Text>
                      </View>
                    </View>
                  </View>
                )}
              </View>
            </View>
          ) : activeSection === 'radar' ? (
            <RadarSection data={data} activeWidgets={activeWidgets} onEditWidgets={() => setShowWidgetModal(true)} />
          ) : activeSection === 'archives' && (
            <ArchivesSection
              reports={reports}
              onDownload={handleDownloadReport}
              onNew={() => router.push('/intelligence/ReportGenerator')}
              coldArchives={coldArchives}
              activeSchema={activeSchema}
              currentSubSection={archiveSection}
              setSubSection={setArchiveSection}
              onSelectArchive={setSelectedArchive}
              hasPermission={hasPermission}
            />
          )}
        </View>
        <View className="h-20" />
      </ScrollView>

      <ReportConfigModal
        visible={showReportModal}
        onClose={() => setShowReportModal(false)}
        onConfirm={handleExportPDF}
        pipelines={pipelines}
        teams={teams}
        users={users}
        initialDays={days}
      />

      <WidgetConfigModal
        visible={showWidgetModal}
        onClose={() => setShowWidgetModal(false)}
        onSave={handleSaveWidgets}
        currentWidgets={activeWidgets}
      />

      <ArchiveDetailModal
        visible={!!selectedArchive}
        onClose={() => setSelectedArchive(null)}
        archive={selectedArchive}
        activeSchema={activeSchema}
        onRestore={(id: string) => {
          setSelectedArchive(null);
          setConfirmRestore({ visible: true, archiveId: id });
        }}
        hasPermission={hasPermission}
      />

      <ConfirmModal
        visible={confirmRestore.visible}
        title="Restore Archive"
        description="This will return the archived asset to the active workflow pipeline."
        confirmLabel="Restore"
        onConfirm={() => {
          handleRestore();
          setConfirmRestore({ visible: false, archiveId: null });
        }}
        onCancel={() => setConfirmRestore({ visible: false, archiveId: null })}
        variant="primary"
        loading={restoring}
      />
    </View>
  );
}
