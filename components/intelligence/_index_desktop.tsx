import { KPIBoxWeb } from '@/components/intelligence/IntelligenceCommon';
import ProjectLens from '@/components/intelligence/ProjectLens';
import { WidgetConfigModal } from '@/components/intelligence/IntelligenceModals';
import { DateRangeControls, PipelineSelector, daysBetween, useDateRange, useGranularity } from '@/components/intelligence/DateRangeFilter';
import {
    ConversionFunnelMiniWeb,
    PipelinePointsMiniWeb,
    SLARiskAlertMiniWeb,
    StageDurationMiniWeb,
    ThroughputOverTimeMiniWeb,
    TrendComparisonMiniWeb
} from '@/components/intelligence/RadarWidgets';
import { useAuth } from '@/contexts/AuthContext';
import { useBillingPlan } from '@/hooks/useBillingPlan';
import { useThemeColors } from '@/hooks/useThemeColors';
import { AnalyticsLimits, getAnalyticsLimits, requiredPlan } from '@/lib/planLimits';
import { supabase } from '@/lib/supabase';
import { FontAwesome } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { CollapsibleHeaderProvider, useCollapsibleHeaderScroll } from '@/hooks/useCollapsibleHeader';
import IntelligencePageHeader from '@/components/intelligence/IntelligencePageHeader';
import Tooltip from '@/components/common/Tooltip';

const DEFAULT_WIDGETS = ['throughput', 'efficiency', 'flow_ratio', 'first_pass_yield'];

function WidgetGate({ feature, limits, children }: {
  feature: keyof AnalyticsLimits;
  limits: AnalyticsLimits;
  children: React.ReactNode;
}) {
  const colors = useThemeColors();
  if (limits[feature]) return <>{children}</>;
  return (
    <View className="rounded-2xl border border-surface-border/50 px-4 py-3 flex-row items-center gap-2">
      <FontAwesome name="lock" size={11} color={colors.textMuted} />
      <Text className="text-typography-muted text-xs">Not available on your plan</Text>
    </View>
  );
}

// #308/#309: the shared collapsing <IntelligencePageHeader> owns the identity
// block + full-width controls row + scroll-linked collapse. The provider is
// mounted here so the inner body ScrollView can drive the collapse.
export default function IntelligenceOverview() {
  return (
    <CollapsibleHeaderProvider>
      <IntelligenceOverviewInner />
    </CollapsibleHeaderProvider>
  );
}

function IntelligenceOverviewInner() {
  const colors = useThemeColors();
  const { hasPermission, profile } = useAuth();
  const { limits: planLimits } = useBillingPlan();
  const limits = getAnalyticsLimits(planLimits);

  // Clamp initial days to plan limit
  const initDays = limits.maxDays ? Math.min(30, limits.maxDays) : 30;
  const [data, setData]           = useState<any>(null);
  const [loading, setLoading]     = useState(true);
  const { from, to, setFrom, setTo } = useDateRange(initDays);
  const granularity = useGranularity();
  const days = daysBetween(from, to);
  const [pipelineId, setPipelineId] = useState<string | null>(null);
  const [pipelines, setPipelines] = useState<any[]>([]);
  const [activeWidgets, setActiveWidgets] = useState<string[]>(DEFAULT_WIDGETS);
  const [showWidgetModal, setShowWidgetModal]   = useState(false);

  useEffect(() => {
    AsyncStorage.getItem('@TrustFlow_radar_widgets').then(v => { if (v) setActiveWidgets(JSON.parse(v)); });
    supabase.from('pipelines').select('id, name').is('deleted_at', null)
      .then(({ data }) => { if (data) { setPipelines(data); if (data[0]) setPipelineId(data[0].id); } });
  }, []);

  const canViewAnalytics = hasPermission('analytics.view');

  useEffect(() => {
    if (canViewAnalytics) fetchAudit();
    else setLoading(false);
  }, [from, to, pipelineId, canViewAnalytics]);

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

  const curThr  = data?.current?.throughput   || 0;
  const prevThr = data?.comparison?.throughput || 0;
  const adv     = data?.radar_advanced         || {};
  const curr    = data?.current                || {};

  const router = useRouter();

  // #308 scroll-linked collapse of the shared header; only one scroll per screen
  // drives it — the analytics body ScrollView below.
  const headerScroll = useCollapsibleHeaderScroll();

  const renderWidget = (key: string, idx: number) => {
    switch (key) {
      case 'throughput':        return <KPIBoxWeb key={idx} label="Throughput"           val={curThr}                                 delta={curThr - prevThr} />;
      case 'efficiency':        return <KPIBoxWeb key={idx} label="Efficiency"            val={`${Math.round(curr.success_rate || 0)}%`} />;
      case 'flow_ratio':        return <KPIBoxWeb key={idx} label="Flow Ratio"            val={`${adv.flow_ratio || 0}%`} />;
      case 'first_pass_yield':  return <KPIBoxWeb key={idx} label="First-Pass Integrity" val={`${adv.first_pass_yield || 0}%`} />;
      case 'automation_offload':return <KPIBoxWeb key={idx} label="Automation Score"      val={`${adv.automation_offload_rate || 0}%`} />;
      default: return null;
    }
  };

  return (
    <View className="flex-1 bg-surface-background flex-col">

      {/* ── Header (shared collapsing component — #308/#309) ── */}
      <IntelligencePageHeader
        eyebrow="Intelligence Hub"
        title="Overview"
        right={
          <>
            {/* "Global Organizational View" pill — kept visible per #308 */}
            <View className="px-3 py-1 bg-surface-card border border-surface-border rounded-lg">
              <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-widest">Global Organizational View</Text>
            </View>
            {canViewAnalytics && (
              <>
                {/* Shared pipeline selector + calendar range + granularity. Each
                    cluster gets a definite max so its own flex-wrap engages. */}
                <View style={{ maxWidth: '100%', flexShrink: 1 }}>
                  <PipelineSelector pipelines={pipelines} selectedId={pipelineId} onSelect={setPipelineId} />
                </View>
                <View style={{ maxWidth: '100%', flexShrink: 1 }}>
                  <DateRangeControls from={from} to={to} setFrom={setFrom} setTo={setTo} maxDays={limits.maxDays} granularity={granularity} />
                </View>
                <Tooltip label="Refresh data">
                  <TouchableOpacity onPress={fetchAudit} className="h-10 w-10 items-center justify-center bg-surface-card border border-surface-border rounded-xl">
                    {loading && data
                      ? <ActivityIndicator size="small" color={colors.primary} />
                      : <FontAwesome name="refresh" size={13} color={colors.primary} />}
                  </TouchableOpacity>
                </Tooltip>
              </>
            )}
          </>
        }
      />

      {canViewAnalytics && loading && !data ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : canViewAnalytics && !data ? (
        <View className="flex-1 items-center justify-center">
          <Text className="text-typography-muted text-sm">No data available for this period.</Text>
        </View>
      ) : canViewAnalytics ? (
        <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false} {...headerScroll}>

          {/* ── KPI Row ── */}
          <View className="px-10 pt-6 pb-0 flex-shrink-0">
            <View className="flex-row justify-between items-center mb-4">
              <Text className="text-typography-main font-black text-lg tracking-tight">Key Metrics</Text>
              <Tooltip label="Customize visible metrics">
                <TouchableOpacity onPress={() => setShowWidgetModal(true)} className="bg-surface-card px-4 py-1.5 rounded-xl border border-surface-border">
                  <Text className="text-brand-primary text-[10px] font-black uppercase tracking-widest">Configure</Text>
                </TouchableOpacity>
              </Tooltip>
            </View>
            <View className="flex-row flex-wrap gap-4 mb-8">
              {activeWidgets.map(renderWidget)}
            </View>
          </View>

          {/* ── The project / portfolio lens (#191 Phase 10) ──
              Beside the pipeline rollup, not instead of it: the widgets below
              are throughput over the chosen range, this is the state of the
              actual batches of work right now. Every number in it comes from
              rpc_portfolios_table / rpc_projects_table — the same readers the
              portfolio card and the timeline use — so the three surfaces
              cannot disagree about one project's finish date. */}
          <View className="px-10 pb-8">
            <ProjectLens />
          </View>

          {/* ── Mini Widgets ── */}
          <View className="px-10 flex-col gap-4">

            {/* Throughput over time — Pro+ */}
            <WidgetGate feature="throughput" limits={limits}>
              <ThroughputOverTimeMiniWeb pipelineId={pipelineId} from={from} to={to} buckets={granularity.buckets} onViewAll={() => router.push('/intelligence/graphs')} />
            </WidgetGate>

            {/* Pipeline points — Pro+ */}
            <WidgetGate feature="throughput" limits={limits}>
              <PipelinePointsMiniWeb pipelineId={pipelineId} from={from} to={to} buckets={granularity.buckets} onViewAll={() => router.push('/intelligence/graphs')} />
            </WidgetGate>

            {/* SLA risk — always available */}
            <SLARiskAlertMiniWeb data={data} onViewAll={() => router.push('/intelligence/graphs')} />

            <View className="flex-row flex-wrap gap-6">
              {/* Stage duration — always available */}
              <View className="flex-1">
                <StageDurationMiniWeb data={data} onViewAll={() => router.push('/intelligence/graphs')} />
              </View>
              {/* Conversion funnel — Business+ */}
              <View className="flex-1">
                <WidgetGate feature="funnel" limits={limits}>
                  <ConversionFunnelMiniWeb data={data} onViewAll={() => router.push('/intelligence/analytics')} />
                </WidgetGate>
              </View>
            </View>

            {/* Trend comparison — Pro+ */}
            <WidgetGate feature="throughput" limits={limits}>
              <TrendComparisonMiniWeb data={data} onViewAll={() => router.push('/intelligence/graphs')} />
            </WidgetGate>

          </View>
        </ScrollView>
      ) : (
        <View className="flex-1 items-center justify-center px-10">
          <View className="bg-surface-card border border-surface-border rounded-3xl p-10 items-center max-w-sm w-full">
            <FontAwesome name="bullseye" size={32} color={colors.textDim} style={{ marginBottom: 16 }} />
            <Text className="text-typography-main font-black text-lg mb-2 text-center">Intelligence Hub</Text>
            <Text className="text-typography-muted text-sm text-center leading-relaxed">
              Use the navigation on the left to access the sections available to you.
            </Text>
          </View>
        </View>
      )}

      <WidgetConfigModal
        visible={showWidgetModal}
        onClose={() => setShowWidgetModal(false)}
        onSave={handleSaveWidgets}
        currentWidgets={activeWidgets}
      />
    </View>
  );
}
