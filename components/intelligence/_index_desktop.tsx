import ProjectLens from '@/components/intelligence/ProjectLens';
import AtAGlance from '@/components/intelligence/AtAGlance';
import TargetWatch from '@/components/intelligence/TargetWatch';
import { DateRangeControls, PipelineSelector, daysBetween, useDateRange, useGranularity } from '@/components/intelligence/DateRangeFilter';
import { useAuth } from '@/contexts/AuthContext';
import { useBillingPlan } from '@/hooks/useBillingPlan';
import { useThemeColors } from '@/hooks/useThemeColors';
import { getAnalyticsLimits } from '@/lib/planLimits';
import { supabase } from '@/lib/supabase';
import type { OrganizationalAudit } from '@/lib/analyticsMetrics';
import { useAnalytics } from '@/contexts/AnalyticsContext';
import { FontAwesome } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { CollapsibleHeaderProvider, useCollapsibleHeaderScroll } from '@/hooks/useCollapsibleHeader';
import IntelligencePageHeader from '@/components/intelligence/IntelligencePageHeader';
import Tooltip from '@/components/common/Tooltip';

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
  const { hasPermission, permissionsLoaded } = useAuth();
  const { limits: planLimits, loading: billingLoading, error: billingError, ready: billingReady } = useBillingPlan();
  const limits = getAnalyticsLimits(planLimits);

  // Use a neutral initial range; plan-specific controls and fetches wait for billing readiness.
  const [data, setData]           = useState<OrganizationalAudit | null>(null);
  const [loading, setLoading]     = useState(true);
  const { from, to, setFrom, setTo } = useDateRange(30);
  const granularity = useGranularity();
  const days = daysBetween(from, to);
  const [pipelineId, setPipelineId] = useState<string | null>(null);
  const [pipelines, setPipelines] = useState<any[]>([]);
  const { getOrganizationalAudit } = useAnalytics();

  useEffect(() => {
    supabase.from('pipelines').select('id, name').is('deleted_at', null)
      .then(({ data }) => { if (data) setPipelines(data); });
  }, []);

  const canViewAnalytics = permissionsLoaded && hasPermission('analytics.view');

  useEffect(() => {
    if (canViewAnalytics && billingReady) fetchAudit();
    else setLoading(false);
  }, [from, to, pipelineId, canViewAnalytics, billingReady]);

  const fetchAudit = async (forceRefresh = false) => {
    setLoading(true);
    try {
      setData(await getOrganizationalAudit(pipelineId, days, forceRefresh));
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  // #308 scroll-linked collapse of the shared header; only one scroll per screen
  // drives it — the analytics body ScrollView below.
  const headerScroll = useCollapsibleHeaderScroll();

  return (
    <View className="flex-1 bg-surface-background flex-col">

      {/* ── Header (shared collapsing component — #308/#309) ── */}
      <IntelligencePageHeader
        eyebrow="Intelligence Hub"
        title="Overview"
        right={
          <>
            {/* Scope pill stays visible per #308 and reflects the selected scope. */}
            <View className="px-3 py-1 bg-surface-card border border-surface-border rounded-lg">
              <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-widest">{pipelineId ? pipelines.find(p => p.id === pipelineId)?.name ?? 'Selected Pipeline' : 'Global Organizational View'}</Text>
            </View>
            {canViewAnalytics && billingReady && (
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
                  <TouchableOpacity onPress={() => fetchAudit(true)} className="h-10 w-10 items-center justify-center bg-surface-card border border-surface-border rounded-xl">
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

      {!permissionsLoaded || (canViewAnalytics && billingLoading) ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : permissionsLoaded && !canViewAnalytics ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-typography-main font-black text-xl mb-2">Access Restricted</Text>
          <Text className="text-typography-muted text-sm text-center">You need analytics.view permission to access this overview.</Text>
        </View>
      ) : billingError || !billingReady ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-typography-muted text-sm text-center">Plan information unavailable.</Text>
        </View>
      ) : canViewAnalytics && loading && !data ? (
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
          <View className="px-10 pt-6 pb-8 flex-shrink-0">
            {data && <AtAGlance audit={data} />}
          </View>

          {permissionsLoaded && hasPermission('target.view') && (
            <View className="px-10 pb-8">
              <TargetWatch enabled />
            </View>
          )}

          {/* The project / portfolio lens (#191 Phase 10) summarizes the state
              of active batches using the same readers as the portfolio card
              and timeline. */}
          <View className="px-10 pb-8">
            <ProjectLens />
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

    </View>
  );
}
