import { ReportConfigModal, WidgetConfigModal } from '@/components/intelligence/IntelligenceModals';
import { KPIBoxWeb } from '@/components/intelligence/IntelligenceCommon';
import {
  ConversionFunnelChartWeb,
  ConversionFunnelMiniWeb,
  SLARiskAlertWeb,
  SLARiskAlertMiniWeb,
  StageDurationChartWeb,
  StageDurationMiniWeb,
  TrendComparisonCardsWeb,
  TrendComparisonMiniWeb,
  ThroughputOverTimeMiniWeb,
} from '@/components/intelligence/RadarWidgets';
import { useRouter } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { FontAwesome } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';

const DAY_OPTS = [7, 30, 60, 90];
const DEFAULT_WIDGETS = ['throughput', 'efficiency', 'flow_ratio', 'first_pass_yield'];

export default function IntelligenceOverview() {
  const { hasPermission, profile } = useAuth();
  const [data, setData]           = useState<any>(null);
  const [loading, setLoading]     = useState(true);
  const [days, setDays]           = useState(30);
  const [pipelineId, setPipelineId] = useState<string | null>(null);
  const [pipelines, setPipelines] = useState<any[]>([]);
  const [teams, setTeams]         = useState<any[]>([]);
  const [users, setUsers]         = useState<any[]>([]);
  const [activeWidgets, setActiveWidgets] = useState<string[]>(DEFAULT_WIDGETS);
  const [showReportModal, setShowReportModal]   = useState(false);
  const [showWidgetModal, setShowWidgetModal]   = useState(false);

  useEffect(() => {
    AsyncStorage.getItem('@TrustFlow_radar_widgets').then(v => { if (v) setActiveWidgets(JSON.parse(v)); });
    Promise.all([
      supabase.from('pipelines').select('id, name').is('deleted_at', null),
      supabase.from('teams').select('id, name').is('deleted_at', null),
      supabase.from('users').select('id, full_name'),
    ]).then(([p, t, u]) => {
      if (p.data) setPipelines(p.data);
      if (t.data) setTeams(t.data);
      if (u.data) setUsers(u.data);
    });
  }, []);

  useEffect(() => { fetchAudit(); }, [days, pipelineId]);

  const fetchAudit = async () => {
    setLoading(true);
    try {
      const { data: res, error } = await supabase.rpc('rpc_get_organizational_audit', {
        p_pipeline_id: pipelineId,
        p_days: days,
      });
      if (error) throw error;
      setData(res);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const handleSaveWidgets = async (w: string[]) => {
    setActiveWidgets(w);
    setShowWidgetModal(false);
    await AsyncStorage.setItem('@TrustFlow_radar_widgets', JSON.stringify(w));
  };

  const handleGenerateReport = async (params: any) => {
    try {
      const { error } = await supabase.rpc('rpc_request_report', {
        p_report_type: params.type || 'performance_audit',
        p_parameters: { days: params.days, pipeline_id: params.pipeline_id, team_id: params.team_id, user_id: params.user_id },
      });
      if (error) throw error;
      setShowReportModal(false);
    } catch (e) { console.error(e); }
  };

  const curThr  = data?.current?.throughput   || 0;
  const prevThr = data?.comparison?.throughput || 0;
  const adv     = data?.radar_advanced         || {};
  const curr    = data?.current                || {};

  const router = useRouter();

  const renderWidget = (key: string, idx: number) => {
    switch (key) {
      case 'throughput':        return <KPIBoxWeb key={idx} label="Throughput"            val={curThr}                              delta={curThr - prevThr} />;
      case 'efficiency':        return <KPIBoxWeb key={idx} label="Efficiency"             val={`${Math.round(curr.success_rate || 0)}%`} />;
      case 'flow_ratio':        return <KPIBoxWeb key={idx} label="Flow Ratio"             val={`${adv.flow_ratio || 0}%`} />;
      case 'first_pass_yield':  return <KPIBoxWeb key={idx} label="First-Pass Integrity"  val={`${adv.first_pass_yield || 0}%`} />;
      case 'automation_offload':return <KPIBoxWeb key={idx} label="Automation Score"       val={`${adv.automation_offload_rate || 0}%`} />;
      default: return null;
    }
  };

  return (
    <View className="flex-1 bg-surface-background flex-col">

      {/* ── Header ── */}
      <View className="px-10 pt-8 pb-5 flex-row items-center justify-between border-b border-surface-border flex-shrink-0">
        <View className="flex-row items-center gap-4">
          <View>
            <Text className="text-brand-primary font-black uppercase tracking-[0.3em] text-[9px] mb-1">Intelligence Hub</Text>
            <Text className="text-typography-main text-4xl font-black tracking-tighter">Overview</Text>
          </View>
          <View className="mt-4 px-3 py-1 bg-surface-card border border-surface-border rounded-lg">
            <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-widest">Global Organizational View</Text>
          </View>
        </View>
        <View className="flex-row items-center gap-3">
          {/* Timeframe */}
          <View className="flex-row bg-surface-card border border-surface-border rounded-xl p-1 gap-0.5">
            {DAY_OPTS.map(d => (
              <TouchableOpacity
                key={d}
                onPress={() => setDays(d)}
                className={`px-4 py-2 rounded-lg ${days === d ? 'bg-brand-primary' : ''}`}
              >
                <Text className={`text-[11px] font-black ${days === d ? 'text-white' : 'text-typography-muted'}`}>{d}d</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity onPress={fetchAudit} className="h-10 w-10 items-center justify-center bg-surface-card border border-surface-border rounded-xl">
            <FontAwesome name="refresh" size={13} color="rgb(var(--brand-primary))" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowReportModal(true)} className="bg-brand-primary px-6 py-2.5 rounded-xl flex-row items-center gap-2">
            <FontAwesome name="file-pdf-o" size={12} color="white" />
            <Text className="text-white font-black uppercase tracking-widest text-[11px]">Generate Report</Text>
          </TouchableOpacity>
        </View>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="rgb(var(--brand-primary))" />
        </View>
      ) : !data ? (
        <View className="flex-1 items-center justify-center">
          <Text className="text-typography-muted text-sm">No data available for this period.</Text>
        </View>
      ) : (
        <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
          {/* ── KPI Row ── */}
          <View className="px-10 pt-6 pb-0 flex-shrink-0">
            <View className="flex-row justify-between items-center mb-4">
              <Text className="text-typography-main font-black text-lg tracking-tight">Key Metrics</Text>
              <TouchableOpacity onPress={() => setShowWidgetModal(true)} className="bg-surface-card px-4 py-1.5 rounded-xl border border-surface-border">
                <Text className="text-brand-primary text-[10px] font-black uppercase tracking-widest">Configure</Text>
              </TouchableOpacity>
            </View>
            <View className="flex-row flex-wrap gap-4 mb-8">
              {activeWidgets.map(renderWidget)}
            </View>
          </View>

          {/* ── Mini Widgets Row ── */}
          <View className="px-10 flex-col gap-4">
            <ThroughputOverTimeMiniWeb pipelines={pipelines} onViewAll={() => router.push('/intelligence/graphs')} />

            <SLARiskAlertMiniWeb data={data} onViewAll={() => router.push('/intelligence/graphs')} />
            
            <View className="flex-row gap-6">
              <View className="flex-1">
                <StageDurationMiniWeb data={data} onViewAll={() => router.push('/intelligence/graphs')} />
              </View>
              <View className="flex-1">
                <ConversionFunnelMiniWeb data={data} onViewAll={() => router.push('/intelligence/analytics')} />
              </View>
            </View>

            <TrendComparisonMiniWeb data={data} onViewAll={() => router.push('/intelligence/graphs')} />
          </View>
        </ScrollView>
      )}

      <ReportConfigModal
        visible={showReportModal}
        onClose={() => setShowReportModal(false)}
        onConfirm={handleGenerateReport}
        pipelines={pipelines} teams={teams} users={users} initialDays={days}
      />
      <WidgetConfigModal
        visible={showWidgetModal}
        onClose={() => setShowWidgetModal(false)}
        onSave={handleSaveWidgets}
        currentWidgets={activeWidgets}
      />
    </View>
  );
}
