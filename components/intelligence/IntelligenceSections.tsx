import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, TextInput } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { KPIBoxWeb } from './IntelligenceCommon';
import { 
  SLARiskAlertWeb, 
  StageDurationChartWeb, 
  ConversionFunnelChartWeb, 
  WorkDistributionChartWeb, 
  QualityLeaderboardWeb, 
  TrendComparisonCardsWeb 
} from './RadarWidgets';

export const RadarSectionWeb = ({ data, activeWidgets, onEditWidgets }: any) => {
  if (!data) return null;
  const curThr = data.current?.throughput || 0;
  const prevThr = data.comparison?.throughput || 0;
  const adv = data.radar_advanced || {};
  const curr = data.current || {};
  const renderWidget = (key: string, idx: number) => {
    switch (key) {
      case 'throughput': return <KPIBoxWeb key={idx} label="Throughput" val={curThr} delta={curThr - prevThr} />;
      case 'efficiency': return <KPIBoxWeb key={idx} label="Efficiency" val={`${Math.round(curr.success_rate || 0)}%`} delta={undefined} />;
      case 'flow_ratio': return <KPIBoxWeb key={idx} label="Flow Ratio" val={adv.flow_ratio || 'N/A'} delta={undefined} />;
      case 'first_pass_yield': return <KPIBoxWeb key={idx} label="First-Pass Integrity" val={`${adv.first_pass_yield || 0}%`} delta={undefined} />;
      case 'automation_offload': return <KPIBoxWeb key={idx} label="Automation Score" val={`${adv.automation_offload_rate || 0}%`} delta={undefined} />;
      default: return null;
    }
  };
  return (
    <View className="flex-row flex-wrap gap-8">
      <View className="w-full">
        <View className="flex-row justify-between items-center mb-6">
          <Text className="text-typography-main font-black text-2xl tracking-tight">Performance Metrics</Text>
          <TouchableOpacity onPress={onEditWidgets} className="bg-surface-card px-4 py-2 rounded-xl border border-surface-border">
            <Text className="text-brand-primary text-[10px] font-black uppercase tracking-widest">Configure Dashboard</Text>
          </TouchableOpacity>
        </View>
        <View className="flex-row flex-wrap gap-6">
          {activeWidgets.map((w: string, i: number) => renderWidget(w, i))}
        </View>
      </View>
      <View className="w-full flex-row gap-8">
        <View className="flex-1">
          <SLARiskAlertWeb data={data} />
          <StageDurationChartWeb data={data} />
        </View>
        <View className="flex-1">
          <ConversionFunnelChartWeb data={data} />
        </View>
      </View>
      <View className="w-full flex-row gap-8">
        <View className="flex-1">
          <WorkDistributionChartWeb data={data} />
        </View>
        <View className="flex-1">
          <QualityLeaderboardWeb data={data} />
        </View>
      </View>
      <View className="w-full">
        <TrendComparisonCardsWeb data={data} />
      </View>
    </View>
  );
};

export const TargetsSectionWeb = ({ targets, onUpdate, onNew }: any) => (
  <View>
    <View className="flex-row justify-between items-center mb-10">
      <Text className="text-typography-main font-black text-3xl tracking-tight">Active Objectives</Text>
      <TouchableOpacity
        onPress={onNew}
        className="bg-brand-primary px-8 py-4 rounded-2xl premium-shadow flex-row items-center"
      >
        <FontAwesome name="plus" size={14} color="white" className="mr-3" />
        <Text className="text-white font-black uppercase tracking-widest text-xs">New Benchmark</Text>
      </TouchableOpacity>
    </View>
    <View className="flex-row flex-wrap gap-8">
      {targets.map((t: any, i: number) => (
        <View key={i} className="w-[calc(50%-16px)] bg-surface-card p-8 rounded-[32px] border border-surface-border premium-shadow">
          <View className="flex-row justify-between mb-8">
            <View>
              <Text className="text-typography-main font-black text-2xl tracking-tight mb-2">{t.stage?.name}</Text>
              <View className="bg-surface-background px-4 py-1.5 rounded-full border border-surface-border inline-flex">
                <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">
                  {t.target_type === 'volume' ? 'Volume Quota' : 'SLA Target'}
                </Text>
              </View>
            </View>
            <TouchableOpacity
              onPress={() => {
                const newVal = window.prompt('Enter new target value:', t.target_type === 'volume' ? t.target_quantity : t.target_active_seconds);
                if (newVal) onUpdate(t.id, t.target_type === 'volume' ? 'target_quantity' : 'target_active_seconds', newVal);
              }}
              className="w-12 h-12 rounded-2xl bg-surface-background border border-surface-border items-center justify-center hover:border-brand-primary transition-colors"
            >
              <FontAwesome name="pencil" size={16} className="text-typography-dim" />
            </TouchableOpacity>
          </View>
          {t.target_type === 'volume' ? (
            <View>
              <View className="flex-row justify-between mb-4 items-end">
                <View>
                  <Text className="text-typography-main text-3xl font-black">{t.current_count || 0} / {t.target_quantity}</Text>
                  <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-widest mt-1">Units Processed</Text>
                </View>
                <View className="items-end">
                  <Text className="text-typography-main font-black">{Math.round(((t.current_count || 0) / (t.target_quantity || 1)) * 100)}%</Text>
                  <Text className="text-typography-muted text-[10px] font-bold uppercase mt-1">Completion</Text>
                </View>
              </View>
              <View className="h-4 bg-surface-background rounded-full overflow-hidden border border-surface-border">
                <View className="h-full bg-brand-primary rounded-full shadow-lg shadow-brand-primary/50" style={{ width: `${Math.min(((t.current_count || 0) / (t.target_quantity || 1)) * 100, 100)}%` }} />
              </View>
              <View className="mt-6 flex-row items-center bg-surface-background p-4 rounded-2xl border border-surface-border/50">
                <FontAwesome name="clock-o" size={14} className="text-typography-dim mr-3" />
                <Text className="text-typography-muted text-[11px] font-bold uppercase tracking-widest">
                  Objective Expiration: {t.target_deadline ? new Date(t.target_deadline).toLocaleDateString() : 'N/A'}
                </Text>
              </View>
            </View>
          ) : (
            <View className="flex-row gap-12">
              <View className="flex-1 bg-surface-background p-6 rounded-2xl border border-surface-border/50">
                <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-2">Target Active</Text>
                <Text className="text-brand-primary text-3xl font-black">{Math.round((t.target_active_seconds || 0) / 60)}<Text className="text-lg">m</Text></Text>
              </View>
              <View className="flex-1 bg-surface-background p-6 rounded-2xl border border-surface-border/50">
                <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-2">Max Life-Cycle</Text>
                <Text className="text-typography-main text-3xl font-black">{Math.round((t.target_lifecycle_seconds || 0) / 3600)}<Text className="text-lg">h</Text></Text>
              </View>
            </View>
          )}
        </View>
      ))}
    </View>
  </View>
);



export const ArchivesSectionWeb = ({ reports, archives, search, activeSchema, onSearch, onDownload, onNew, onRefresh, onRestore, onViewSnapshot, hasPermission }: any) => {
  const [subSection, setSubSection] = useState<'reports' | 'cold_storage'>('reports');

  useEffect(() => {
    if (subSection === 'cold_storage' && !hasPermission('archive.view')) {
      setSubSection('reports');
    }
  }, [subSection, hasPermission]);

  return (
    <View>
      <View className="flex-row bg-surface-card rounded-2xl p-1.5 border border-surface-border mb-10 w-fit">
        {['reports', 'cold_storage'].map((s) => (
          <TouchableOpacity
            key={s}
            onPress={() => setSubSection(s as any)}
            className={`px-8 py-3 rounded-xl items-center flex-row ${subSection === s ? 'bg-brand-primary premium-shadow' : 'hover:bg-surface-background'}`}
          >
            <Text className={`font-black text-[10px] uppercase tracking-widest ${subSection === s ? 'text-white' : 'text-typography-muted'}`}>
              {s.replace('_', ' ')}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      {subSection === 'reports' ? (
        <View>
          <View className="flex-row justify-between items-center mb-10">
            <Text className="text-typography-main font-black text-3xl tracking-tight">Audit Repositories</Text>
            <TouchableOpacity onPress={onNew} className="bg-brand-primary px-8 py-4 rounded-2xl premium-shadow flex-row items-center">
              <FontAwesome name="plus" size={14} color="white" className="mr-3" />
              <Text className="text-white font-black uppercase tracking-widest text-xs">New Report Request</Text>
            </TouchableOpacity>
          </View>
          <View className="flex-row flex-wrap gap-8">
            {reports.map((r: any, i: number) => (
              <TouchableOpacity key={i} onPress={() => r.file_url && onDownload(r.file_url)} className="w-[calc(33.33%-22px)] bg-surface-card p-8 rounded-[32px] border border-surface-border premium-shadow hover:border-brand-primary transition-all">
                <View className={`w-16 h-16 rounded-2xl items-center justify-center mb-6 ${r.status === 'completed' ? 'bg-state-success/10' : 'bg-state-info/10'}`}>
                  <FontAwesome name="file-pdf-o" size={24} color={r.status === 'completed' ? 'rgb(var(--state-success))' : 'rgb(var(--brand-primary))'} />
                </View>
                <Text className="text-typography-main font-black text-xl mb-2">Audit Report #{r.id.substring(0, 8).toUpperCase()}</Text>
                <View className="flex-row items-center justify-between mt-4 pt-4 border-t border-surface-border/50">
                  <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-widest">{new Date(r.created_at).toLocaleDateString()}</Text>
                  <View className={`px-3 py-1 rounded-full ${r.status === 'completed' ? 'bg-state-success/10' : 'bg-brand-primary/10'}`}>
                    <Text className={`text-[9px] font-black uppercase ${r.status === 'completed' ? 'text-state-success' : 'text-brand-primary'}`}>{r.status}</Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : (
        <View>
          <View className="flex-row justify-between items-center mb-10">
            <View className="flex-1 max-w-xl">
              <Text className="text-typography-main font-black text-3xl tracking-tight mb-4">Cold Storage Browser</Text>
              <View className="flex-row bg-surface-card rounded-2xl border border-surface-border px-6 py-4 items-center focus-within:border-brand-primary transition-all">
                <FontAwesome name="search" size={16} className="text-typography-dim mr-4" />
                <TextInput value={search} onChangeText={onSearch} placeholder="Search snapshots by ID, metadata, or title..." className="flex-1 text-typography-main font-bold outline-none" placeholderTextColor="rgb(var(--typography-muted))" />
              </View>
            </View>
            <TouchableOpacity onPress={onRefresh} className="h-14 w-14 items-center justify-center bg-surface-card border border-surface-border rounded-2xl premium-shadow hover:border-brand-primary">
              <FontAwesome name="refresh" size={16} className="text-brand-primary" />
            </TouchableOpacity>
          </View>
          <View className="flex-row flex-wrap gap-6">
            {archives.map((archive: any) => {
              const pipelineId = archive.snapshot?.pipeline_id || archive.snapshot?.child_tasks?.[0]?.pipeline_id;
              const hasIntegrityIssue = pipelineId && !activeSchema.pipelines.has(pipelineId);
              return (
                <View key={archive.id} className="w-[calc(25%-18px)] bg-surface-card p-6 rounded-3xl border border-surface-border premium-shadow">
                  <View className="flex-row justify-between mb-6">
                    <View className={`w-12 h-12 rounded-xl items-center justify-center ${archive.restored_at ? 'bg-state-success/10' : 'bg-surface-background'}`}>
                      <FontAwesome name={archive.entity_type === 'project' ? 'briefcase' : 'tasks'} size={18} color={archive.restored_at ? 'rgb(var(--state-success))' : 'rgb(var(--brand-primary))'} />
                    </View>
                    <View className="flex-row gap-2">
                       {hasIntegrityIssue && (
                         <View className="bg-state-danger/10 px-2 py-1 rounded-lg">
                           <FontAwesome name="warning" size={10} className="text-state-danger" />
                         </View>
                       )}
                       <View className="bg-surface-background px-3 py-1 rounded-lg border border-surface-border">
                          <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest">{archive.entity_type}</Text>
                       </View>
                    </View>
                  </View>
                  <Text className="text-typography-main font-black text-lg mb-4 h-14" numberOfLines={2}>
                    {archive.metadata?.title || archive.metadata?.name || 'Untitled Snapshot'}
                  </Text>
                  <View className="space-y-3 mb-6">
                    <View className="flex-row justify-between">
                       <Text className="text-typography-muted text-[10px] font-bold">Snapshot Date</Text>
                       <Text className="text-typography-main text-[10px] font-black">{new Date(archive.archived_at).toLocaleDateString()}</Text>
                    </View>
                    <View className="flex-row justify-between">
                       <Text className="text-typography-muted text-[10px] font-bold">Integrity</Text>
                       <Text className={`text-[10px] font-black ${hasIntegrityIssue ? 'text-state-danger' : 'text-state-success'}`}>{hasIntegrityIssue ? 'ORPHANED' : 'SECURE'}</Text>
                    </View>
                  </View>
                  <View className="flex-row gap-3 pt-6 border-t border-surface-border/50">
                    <TouchableOpacity onPress={() => onViewSnapshot(archive)} className="flex-1 py-3 rounded-xl bg-surface-background border border-surface-border items-center">
                       <Text className="text-typography-muted font-black uppercase tracking-widest text-[9px]">Inspect</Text>
                    </TouchableOpacity>
                    {!archive.restored_at && !hasIntegrityIssue && hasPermission('archive.restore') && (
                      <TouchableOpacity onPress={() => onRestore(archive)} className="flex-1 py-3 rounded-xl bg-brand-primary items-center">
                         <Text className="text-white font-black uppercase tracking-widest text-[9px]">Restore</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      )}
    </View>
  );
};
