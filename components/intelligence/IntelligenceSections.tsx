import { FontAwesome } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { CircularTargetCard, KPIBoxWeb } from './IntelligenceCommon';
import {
    ConversionFunnelChartWeb,
    QualityLeaderboardWeb,
    SLARiskAlertWeb,
    StageDurationChartWeb,
    TrendComparisonCardsWeb,
    WorkDistributionChartWeb
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

export const TargetsSectionWeb = ({ targets, onUpdate, onNew }: any) => {
  const handleEditTarget = (target: any) => {
    const newVal = window.prompt('Enter new target value:', target.target_type === 'volume' ? target.target_quantity : target.target_active_seconds);
    if (newVal) onUpdate(target.id, target.target_type === 'volume' ? 'target_quantity' : 'target_active_seconds', newVal);
  };

  return (
    <View>
      <View className="flex-row justify-between items-center mb-10">
        <Text className="text-typography-main font-black text-3xl tracking-tight">Active Objectives</Text>
        <TouchableOpacity
          onPress={onNew}
          className="bg-brand-primary px-8 py-4 rounded-2xl premium-shadow flex-row items-center"
        >
          <View className="mr-3">
            <FontAwesome name="plus" size={14} color="white" />
          </View>
          <Text className="text-white font-black uppercase tracking-widest text-xs">New Benchmark</Text>
        </TouchableOpacity>
      </View>
      <View className="flex-row flex-wrap gap-8">
        {targets.map((t: any, i: number) => (
          <View key={i}>
            <CircularTargetCard target={t} onEdit={() => handleEditTarget(t)} />
          </View>
        ))}
      </View>
    </View>
  );
};



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
              <View className="mr-3">
                <FontAwesome name="plus" size={14} color="white" />
              </View>
              <Text className="text-white font-black uppercase tracking-widest text-xs">New Report Request</Text>
            </TouchableOpacity>
          </View>
          <View className="flex-row flex-wrap gap-6">
            {reports.map((r: any, i: number) => (
              <TouchableOpacity key={i} onPress={() => r.file_url && onDownload(r.file_url)} className="w-[calc(20%-20px)] bg-surface-card p-5 rounded-2xl border border-surface-border premium-shadow hover:border-brand-primary transition-all">
                <View className={`w-10 h-10 rounded-xl items-center justify-center mb-4 ${r.status === 'completed' ? 'bg-state-success/10' : 'bg-state-info/10'}`}>
                  <FontAwesome name="file-pdf-o" size={16} color={r.status === 'completed' ? 'rgb(var(--state-success))' : 'rgb(var(--brand-primary))'} />
                </View>
                <Text className="text-typography-main font-black text-sm mb-1" numberOfLines={1}>Audit Report #{r.id.substring(0, 8).toUpperCase()}</Text>
                <View className="flex-row items-center justify-between mt-3 pt-3 border-t border-surface-border/50">
                  <Text className="text-typography-muted text-[8px] font-bold uppercase tracking-widest">{new Date(r.created_at).toLocaleDateString()}</Text>
                  <View className={`px-2 py-0.5 rounded-full ${r.status === 'completed' ? 'bg-state-success/10' : 'bg-brand-primary/10'}`}>
                    <Text className={`text-[8px] font-black uppercase ${r.status === 'completed' ? 'text-state-success' : 'text-brand-primary'}`}>{r.status}</Text>
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
                <View className="mr-4">
                  <FontAwesome name="search" size={16} color="rgb(var(--text-dim))" />
                </View>
                <TextInput value={search} onChangeText={onSearch} placeholder="Search snapshots by ID, metadata, or title..." className="flex-1 text-typography-main font-bold outline-none" placeholderTextColor="rgb(var(--text-muted))" />
              </View>
            </View>
            <TouchableOpacity onPress={onRefresh} className="h-14 w-14 items-center justify-center bg-surface-card border border-surface-border rounded-2xl premium-shadow hover:border-brand-primary">
              <FontAwesome name="refresh" size={16} color="rgb(var(--brand-primary))" />
            </TouchableOpacity>
          </View>
          <View className="flex-row flex-wrap gap-4">
            {archives.map((archive: any) => {
              const pipelineId = archive.metadata?.pipeline_id;
              const hasIntegrityIssue = pipelineId && !activeSchema.pipelines.has(pipelineId);
              return (
                <View key={archive.id} className="w-[calc(16.66%-14px)] bg-surface-card p-4 rounded-2xl border border-surface-border premium-shadow">
                  <View className="flex-row justify-between mb-3">
                    <View className={`w-9 h-9 rounded-lg items-center justify-center ${archive.restored_at ? 'bg-state-success/10' : 'bg-surface-background'}`}>
                      <FontAwesome name={archive.entity_type === 'project' ? 'briefcase' : 'tasks'} size={14} color={archive.restored_at ? 'rgb(var(--state-success))' : 'rgb(var(--brand-primary))'} />
                    </View>
                    <View className="flex-row gap-1">
                       {hasIntegrityIssue && (
                         <View className="bg-state-danger/10 px-1.5 py-0.5 rounded-md">
                           <FontAwesome name="warning" size={8} color="rgb(var(--state-danger))" />
                         </View>
                       )}
                       <View className="bg-surface-background px-2 py-0.5 rounded-md border border-surface-border">
                          <Text className="text-typography-muted text-[8px] font-black uppercase tracking-widest">{archive.entity_type}</Text>
                       </View>
                    </View>
                  </View>
                  <Text className="text-typography-main font-black text-xs mb-3 h-8" numberOfLines={2}>
                    {archive.metadata?.title || archive.metadata?.name || 'Untitled Snapshot'}
                  </Text>
                  <View className="space-y-2 mb-4">
                    <View className="flex-row justify-between">
                       <Text className="text-typography-muted text-[8px] font-bold">Date</Text>
                       <Text className="text-typography-main text-[8px] font-black">{new Date(archive.archived_at).toLocaleDateString()}</Text>
                    </View>
                    <View className="flex-row justify-between">
                       <Text className="text-typography-muted text-[8px] font-bold">Status</Text>
                       <Text className={`text-[8px] font-black ${hasIntegrityIssue ? 'text-state-danger' : 'text-state-success'}`}>{hasIntegrityIssue ? 'FAIL' : 'OK'}</Text>
                    </View>
                  </View>
                  <View className="flex-row gap-2 pt-4 border-t border-surface-border/50">
                    <TouchableOpacity onPress={() => onViewSnapshot(archive)} className="flex-1 py-2 rounded-lg bg-surface-background border border-surface-border items-center">
                       <Text className="text-typography-muted font-black uppercase tracking-widest text-[8px]">Inspect</Text>
                    </TouchableOpacity>
                    {!archive.restored_at && !hasIntegrityIssue && hasPermission('archive.restore') && (
                      <TouchableOpacity onPress={() => onRestore(archive)} className="flex-1 py-2 rounded-lg bg-brand-primary items-center">
                         <Text className="text-white font-black uppercase tracking-widest text-[8px]">Restore</Text>
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
