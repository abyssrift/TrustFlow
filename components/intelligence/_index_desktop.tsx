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
import React, { useEffect, useRef, useState } from 'react';
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
  const { from, to, setFrom, setTo } = useDateRange(30);
  const granularity = useGranularity();
  const days = daysBetween(from, to);
  const [pipelineId, setPipelineId] = useState<string | null>(null);
  const [pipelines, setPipelines] = useState<any[]>([]);
  const { getOrganizationalAudit } = useAnalytics();
  const [auditSnapshot, setAuditSnapshot] = useState<{ key: string; data: OrganizationalAudit | null } | null>(null);
  const [auditState, setAuditState] = useState<'loading' | 'updating' | 'ready' | 'empty' | 'error'>('loading');
  const [auditStateKey, setAuditStateKey] = useState<string | null>(null);
  const currentKeyRef = useRef<string | null>(null);
  const acceptedKeyRef = useRef<string | null>(null);
  const requestGenerationRef = useRef(0);

  useEffect(() => {
    supabase.from('pipelines').select('id, name').is('deleted_at', null)
      .then(({ data }) => { if (data) setPipelines(data); });
  }, []);

  const canViewAnalytics = permissionsLoaded && hasPermission('analytics.view');
  const requestKey = JSON.stringify([pipelineId, from, to, days]);
  currentKeyRef.current = requestKey;

  useEffect(() => {
    if (canViewAnalytics && billingReady) fetchAudit();
  }, [from, to, pipelineId, canViewAnalytics, billingReady]);

  const fetchAudit = async (forceRefresh = false) => {
    const key = requestKey;
    const generation = ++requestGenerationRef.current;
    currentKeyRef.current = key;
    const hasAcceptedSnapshot = acceptedKeyRef.current === key;
    setAuditStateKey(key);
    setAuditState(hasAcceptedSnapshot ? 'updating' : 'loading');
    try {
      const nextData = await getOrganizationalAudit(pipelineId, days, forceRefresh);
      if (generation !== requestGenerationRef.current || currentKeyRef.current !== key) return;
      setAuditSnapshot({ key, data: nextData });
      acceptedKeyRef.current = key;
      setAuditStateKey(key);
      setAuditState(nextData == null ? 'empty' : 'ready');
    } catch (e) {
      if (generation !== requestGenerationRef.current || currentKeyRef.current !== key) return;
      setAuditSnapshot(null);
      acceptedKeyRef.current = null;
      setAuditStateKey(key);
      setAuditState('error');
    }
  };

  const currentSnapshot = auditSnapshot?.key === requestKey ? auditSnapshot.data : null;
  const effectiveAuditState = auditStateKey === requestKey ? auditState : 'loading';
  const auditUpdating = currentSnapshot != null && effectiveAuditState === 'updating';
  const auditLoading = currentSnapshot == null && (effectiveAuditState === 'loading' || effectiveAuditState === 'updating');
  const auditError = effectiveAuditState === 'error';
  const auditEmpty = effectiveAuditState === 'empty';
  const data = currentSnapshot;

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
                    {auditUpdating
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
      ) : canViewAnalytics && auditLoading ? (
        <View className="flex-1 items-center justify-center" accessibilityRole="progressbar" accessibilityLabel="Loading overview">
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : canViewAnalytics && auditError ? (
        <View className="flex-1 items-center justify-center px-6 gap-3">
          <Text accessibilityLiveRegion="polite" className="text-typography-main font-black text-base">Couldn’t load overview.</Text>
          <TouchableOpacity
            onPress={() => fetchAudit(true)}
            accessibilityRole="button"
            accessibilityLabel="Retry"
            className="bg-brand-primary px-5 rounded-xl items-center justify-center"
            style={{ minHeight: 44, minWidth: 88 }}
          >
            <Text className="text-brand-on-primary text-xs font-bold">Retry</Text>
          </TouchableOpacity>
        </View>
      ) : canViewAnalytics && auditEmpty ? (
        <View className="flex-1 items-center justify-center">
          <Text className="text-typography-muted text-sm">No data available for this period.</Text>
        </View>
      ) : canViewAnalytics ? (
        <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false} {...headerScroll}>

          {auditUpdating && (
            <View accessible accessibilityRole="progressbar" accessibilityLabel="Updating overview" className="px-10 pt-4 flex-row items-center gap-2">
              <ActivityIndicator size="small" color={colors.primary} />
              <Text className="text-typography-muted text-xs">Updating overview…</Text>
            </View>
          )}

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
