import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, TextInput, useWindowDimensions, Platform } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { supabase } from '@/lib/supabase';

type PlanLimits = {
  max_members: number | null;
  max_file_bytes: number | null;
  max_storage_bytes: number | null;
  max_pipelines: number | null;
  features: string[];
};

type Plan = {
  code: string;
  name: string;
  description: string | null;
  price_cents: number;
  currency: string;
  interval: string;
  per_seat: boolean;
  features: string[];
  limits?: PlanLimits;
};

type Billing = {
  plan_code: string;
  status: string;
  seats: number;
  active_members: number;
  member_limit: number | null; // null = unlimited
  storage_used_bytes: number;
  pipeline_count: number;
  pipeline_limit: number | null;
  external_provider: string | null;
  current_period_end: string | null;
  trial_ends_at: string | null;
  connected: boolean;
};

type Overview = { billing: Billing; plans: Plan[]; limits?: PlanLimits };

const STATUS_LABEL: Record<string, string> = {
  active: 'Active', trialing: 'Trial', past_due: 'Past due', canceled: 'Canceled', none: 'Inactive',
};

export default function BillingPanel() {
  const colors = useThemeColors();
  const { profile, hasPermission } = useAuth();
  const { successToast, errorToast, infoToast } = useToast();
  const { width } = useWindowDimensions();
  const isWide = Platform.OS === 'web' && width >= 1024;

  const canManage = !!profile?.is_owner || hasPermission('company.billing');

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<Overview | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [showRedeemCode, setShowRedeemCode] = useState(false);
  const [trialCode, setTrialCode] = useState('');
  const [redeemLoading, setRedeemLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: res, error } = await supabase.rpc('rpc_billing_overview');
      if (error) throw error;
      setData(res as Overview);
    } catch (e: any) {
      errorToast(e?.message || 'Could not load billing.');
    } finally {
      setLoading(false);
    }
  }, [errorToast]);

  useEffect(() => {
    if (canManage) load();
    else setLoading(false);
  }, [canManage, load]);

  if (!canManage) {
    return (
      <View className="flex-1 items-center justify-center p-10">
        <FontAwesome name="lock" size={40} color={colors.textMuted} />
        <Text className="text-typography-main text-lg font-black mt-4">Restricted</Text>
        <Text className="text-typography-muted text-sm text-center mt-2">You need billing access to view this.</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center p-10">
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const billing = data?.billing;
  const currentPlan = data?.plans.find(p => p.code === billing?.plan_code);
  const limits = data?.limits;

  const formatBytes = (b: number | null) => {
    if (b == null) return 'Unlimited';
    if (b >= 1073741824) return `${(b / 1073741824).toFixed(0)} GB`;
    if (b >= 1048576) return `${(b / 1048576).toFixed(0)} MB`;
    return `${(b / 1024).toFixed(0)} KB`;
  };

  const priceLabel = (p: Plan) => {
    if (p.code === 'enterprise') return 'Custom';
    if (p.price_cents === 0) return 'Free';
    return `$${(p.price_cents / 100).toFixed(0)}${p.per_seat ? '/seat' : ''}/mo`;
  };

  const handleChoose = async (p: Plan) => {
    if (p.code === billing?.plan_code) return;
    setWorking(p.code);
    try {
      const { data: res, error } = await supabase.rpc('rpc_request_billing_change', {
        p_plan_code: p.code,
        p_action: p.code === 'enterprise' ? 'contact' : 'subscribe',
      });
      if (error) throw error;
      const r = res as any;
      if (r?.applied) {
        successToast(`Switched to ${p.name}.`);
        await load();
      } else if (r?.blocked && Array.isArray(r.errors)) {
        r.errors.forEach((e: any) => errorToast(e.message, 'Cannot switch plan'));
      } else if (r?.contact_sales) {
        infoToast('Contact sales to set up an Enterprise plan.', 'Enterprise');
      } else {
        infoToast(r?.message || 'Your request was recorded.', 'Billing');
      }
    } catch (e: any) {
      errorToast(e?.message || 'Could not update plan.');
    } finally {
      setWorking(null);
    }
  };

  const handleRedeemCode = async () => {
    if (!trialCode.trim()) return;
    setRedeemLoading(true);
    try {
      const { data: res, error } = await supabase.rpc('rpc_redeem_trial_code', { p_code: trialCode.trim() });
      if (error) throw error;
      const r = res as any;
      if (r?.success) {
        const until = r.trial_ends_at ? new Date(r.trial_ends_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
        successToast(`Trial activated! Your ${r.plan_code} plan is active until ${until}.`);
        setTrialCode('');
        setShowRedeemCode(false);
        await load();
      }
    } catch (e: any) {
      errorToast(e?.message || 'Invalid trial code.');
    } finally {
      setRedeemLoading(false);
    }
  };

  return (
    <View className="flex-1">
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 48 }}>
        {!isWide && (
          <View className="mb-6 px-1">
            <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.25em] mb-1">Subscription</Text>
            <Text className="text-typography-main text-2xl font-black tracking-tight">Billing & Plans</Text>
          </View>
        )}

        {/* Current plan */}
        {billing && (
          <View className={`bg-surface-card border border-surface-border rounded-2xl p-5 mb-6 ${isWide ? 'max-w-2xl' : ''}`}>
            <View className="flex-row items-center justify-between mb-4">
              <View className="flex-1 mr-3">
                <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-widest">Current plan</Text>
                <Text className="text-typography-main text-xl font-black mt-0.5">{currentPlan?.name || billing.plan_code}</Text>
              </View>
              <View className={`px-3 py-1 rounded-full border ${
                billing.status === 'trialing' ? 'bg-state-warning/10 border-state-warning/30' :
                billing.status === 'past_due' || billing.status === 'canceled' ? 'bg-state-danger/10 border-state-danger/30' :
                'bg-state-success/10 border-state-success/30'
              }`}>
                <Text className={`text-[10px] font-black uppercase tracking-widest ${
                  billing.status === 'trialing' ? 'text-state-warning' :
                  billing.status === 'past_due' || billing.status === 'canceled' ? 'text-state-danger' :
                  'text-state-success'
                }`}>
                  {STATUS_LABEL[billing.status] || billing.status}
                </Text>
              </View>
            </View>

            {/* Trial countdown */}
            {billing.status === 'trialing' && billing.trial_ends_at && (() => {
              const msLeft = Math.max(0, new Date(billing.trial_ends_at).getTime() - Date.now());
              const hoursLeft = Math.ceil(msLeft / 3600000);
              const daysLeft = Math.ceil(msLeft / 86400000);
              const timeLabel = msLeft === 0 ? null
                : msLeft < 3600000 ? 'less than an hour'
                : msLeft < 86400000 ? `${hoursLeft} hour${hoursLeft !== 1 ? 's' : ''}`
                : `${daysLeft} day${daysLeft !== 1 ? 's' : ''}`;
              return (
                <View className="flex-row items-center bg-state-warning/10 border border-state-warning/30 rounded-xl px-3 py-2 gap-2 mb-4">
                  <FontAwesome name="clock-o" size={12} color={colors.warning} />
                  <Text className="text-state-warning text-[11px] font-black flex-1">
                    {timeLabel ? `Trial ends in ${timeLabel}` : 'Trial expires today'}
                  </Text>
                  <Text className="text-typography-muted text-[10px]">
                    {new Date(billing.trial_ends_at).toLocaleDateString()}
                  </Text>
                </View>
              );
            })()}

            {/* Member usage */}
            {(() => {
              const pct = billing.member_limit == null ? 0 : Math.min(1, billing.active_members / billing.member_limit);
              const atLimit = billing.member_limit != null && billing.active_members >= billing.member_limit;
              return (
                <View className="mb-4">
                  <View className="flex-row items-end justify-between mb-1.5">
                    <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-widest">Members</Text>
                    <Text className={`text-[11px] font-black ${atLimit ? 'text-state-danger' : 'text-typography-main'}`}>
                      {billing.active_members}{billing.member_limit != null ? ` / ${billing.member_limit}` : ''}
                      {billing.member_limit == null ? ' (unlimited)' : ''}
                    </Text>
                  </View>
                  {billing.member_limit != null && (
                    <View className="h-2 rounded-full bg-surface-background overflow-hidden">
                      <View
                        className={`h-full rounded-full ${atLimit ? 'bg-state-danger' : pct >= 0.8 ? 'bg-state-warning' : 'bg-brand-primary'}`}
                        style={{ width: `${Math.round(pct * 100)}%` }}
                      />
                    </View>
                  )}
                  {atLimit && (
                    <Text className="text-state-danger text-[10px] font-bold mt-1">
                      Seat limit reached — upgrade to add more members.
                    </Text>
                  )}
                </View>
              );
            })()}

            {/* Storage usage */}
            {(() => {
              const storageLimit = limits?.max_storage_bytes ?? null;
              const storageUsed = billing.storage_used_bytes ?? 0;
              const pct = storageLimit == null ? 0 : Math.min(1, storageUsed / storageLimit);
              const atLimit = storageLimit != null && storageUsed >= storageLimit;
              return (
                <View className="mb-4">
                  <View className="flex-row items-end justify-between mb-1.5">
                    <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-widest">Storage</Text>
                    <Text className={`text-[11px] font-black ${atLimit ? 'text-state-danger' : 'text-typography-main'}`}>
                      {formatBytes(storageUsed)}{storageLimit != null ? ` / ${formatBytes(storageLimit)}` : ' (unlimited)'}
                    </Text>
                  </View>
                  {storageLimit != null && (
                    <View className="h-2 rounded-full bg-surface-background overflow-hidden">
                      <View
                        className={`h-full rounded-full ${atLimit ? 'bg-state-danger' : pct >= 0.8 ? 'bg-state-warning' : 'bg-brand-primary'}`}
                        style={{ width: `${Math.round(pct * 100)}%` }}
                      />
                    </View>
                  )}
                  {atLimit && (
                    <Text className="text-state-danger text-[10px] font-bold mt-1">
                      Storage full — delete files or upgrade your plan.
                    </Text>
                  )}
                </View>
              );
            })()}

            {/* Pipeline usage */}
            {billing.pipeline_limit != null && (() => {
              const pct = Math.min(1, billing.pipeline_count / billing.pipeline_limit);
              const atLimit = billing.pipeline_count >= billing.pipeline_limit;
              return (
                <View className="mb-4">
                  <View className="flex-row items-end justify-between mb-1.5">
                    <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-widest">Pipelines</Text>
                    <Text className={`text-[11px] font-black ${atLimit ? 'text-state-danger' : 'text-typography-main'}`}>
                      {billing.pipeline_count} / {billing.pipeline_limit}
                    </Text>
                  </View>
                  <View className="h-2 rounded-full bg-surface-background overflow-hidden">
                    <View
                      className={`h-full rounded-full ${atLimit ? 'bg-state-danger' : pct >= 0.8 ? 'bg-state-warning' : 'bg-brand-primary'}`}
                      style={{ width: `${Math.round(pct * 100)}%` }}
                    />
                  </View>
                  {atLimit && (
                    <Text className="text-state-danger text-[10px] font-bold mt-1">
                      Pipeline limit reached — upgrade to create more.
                    </Text>
                  )}
                </View>
              );
            })()}

            {/* Projected monthly cost */}
            {currentPlan && currentPlan.price_cents > 0 && currentPlan.per_seat && (
              <View className="flex-row items-center justify-between mb-4 bg-surface-background rounded-xl px-3 py-2.5">
                <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-widest">Projected / mo</Text>
                <Text className="text-typography-main text-sm font-black">
                  ${((currentPlan.price_cents * billing.active_members) / 100).toFixed(0)}
                  <Text className="text-typography-muted text-[10px] font-normal">
                    {' '}({billing.active_members} × ${(currentPlan.price_cents / 100).toFixed(0)}/seat)
                  </Text>
                </Text>
              </View>
            )}

            <View className="flex-row flex-wrap gap-y-3">
              <View className="w-1/2">
                <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-widest">FileHub limit</Text>
                <Text className="text-typography-main text-sm font-bold mt-1">{formatBytes(limits?.max_file_bytes ?? null)} / file</Text>
              </View>
              <View className="w-1/2">
                <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-widest">Gateway</Text>
                <Text className="text-typography-main text-sm font-bold mt-1">
                  {billing.connected ? (billing.external_provider || 'Connected') : 'Not connected'}
                </Text>
              </View>
            </View>
            {!billing.connected && (
              <View className="mt-4 flex-row items-center bg-state-info/10 border border-state-info/30 rounded-xl px-3 py-2.5">
                <FontAwesome name="info-circle" size={13} color={colors.info} />
                <Text className="text-typography-muted text-[11px] ml-2 flex-1 leading-4">
                  A payment gateway isn't connected yet. Selecting a paid plan records your interest; free changes apply instantly.
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Plan cards — stacked on mobile, grid on desktop */}
        <View className={isWide ? 'flex-row flex-wrap gap-4' : 'gap-3'}>
          {data?.plans.map(p => {
            const isCurrent = p.code === billing?.plan_code;
            const isEnterprise = p.code === 'enterprise';
            return (
              <View
                key={p.code}
                className={`bg-surface-card border rounded-2xl p-5 ${isCurrent ? 'border-brand-primary' : 'border-surface-border'} ${isWide ? 'grow basis-60 min-w-[240px] max-w-[360px]' : ''}`}
              >
                <View className="flex-row items-start justify-between mb-2">
                  <View className="flex-1 mr-3">
                    <Text className="text-typography-main text-lg font-black">{p.name}</Text>
                    <Text className="text-typography-muted text-xs mt-0.5 leading-4">{p.description}</Text>
                  </View>
                  {isCurrent && (
                    <View className="px-2 py-0.5 rounded-full bg-brand-primary/10 border border-brand-primary/30">
                      <Text className="text-brand-primary text-[8px] font-black uppercase tracking-widest">Current</Text>
                    </View>
                  )}
                </View>

                <Text className="text-typography-main text-2xl font-black mb-3">{priceLabel(p)}</Text>

                {/* Specs */}
                <View className="bg-surface-background rounded-xl p-3 mb-3 gap-2">
                  <View className="flex-row items-center justify-between">
                    <View className="flex-row items-center gap-1.5">
                      <FontAwesome name="users" size={10} color={colors.textMuted} />
                      <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-wider">Members</Text>
                    </View>
                    <Text className="text-typography-main text-[11px] font-black">
                      {p.limits?.max_members != null ? `Up to ${p.limits.max_members}` : 'Unlimited'}
                    </Text>
                  </View>
                  <View className="h-px bg-surface-border" />
                  <View className="flex-row items-center justify-between">
                    <View className="flex-row items-center gap-1.5">
                      <FontAwesome name="file" size={10} color={colors.textMuted} />
                      <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-wider">FileHub</Text>
                    </View>
                    <Text className="text-typography-main text-[11px] font-black">
                      {formatBytes(p.limits?.max_file_bytes ?? null)}/file
                    </Text>
                  </View>
                  <View className="h-px bg-surface-border" />
                  <View className="flex-row items-center justify-between">
                    <View className="flex-row items-center gap-1.5">
                      <FontAwesome name="database" size={10} color={colors.textMuted} />
                      <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-wider">Storage</Text>
                    </View>
                    <Text className="text-typography-main text-[11px] font-black">
                      {formatBytes(p.limits?.max_storage_bytes ?? null)}
                    </Text>
                  </View>
                  <View className="h-px bg-surface-border" />
                  <View className="flex-row items-center justify-between">
                    <View className="flex-row items-center gap-1.5">
                      <FontAwesome name="sitemap" size={10} color={colors.textMuted} />
                      <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-wider">Pipelines</Text>
                    </View>
                    <Text className="text-typography-main text-[11px] font-black">
                      {p.limits?.max_pipelines != null ? `Up to ${p.limits.max_pipelines}` : 'Unlimited'}
                    </Text>
                  </View>
                </View>

                <View className={`gap-1.5 mb-4 ${isWide ? 'grow' : ''}`}>
                  {p.features?.map((f, i) => (
                    <View key={i} className="flex-row items-start">
                      <View className="mt-0.5"><FontAwesome name="check" size={11} color={colors.success} /></View>
                      <Text className="text-typography-muted text-[12px] ml-2 flex-1 leading-4">{f}</Text>
                    </View>
                  ))}
                </View>

                <TouchableOpacity
                  onPress={() => handleChoose(p)}
                  disabled={isCurrent || working === p.code}
                  className={`py-3.5 rounded-xl items-center ${isCurrent ? 'bg-surface-background border border-surface-border' : 'bg-brand-primary'} ${isWide ? 'mt-auto' : ''}`}
                >
                  <Text className={`font-black text-[11px] uppercase tracking-widest ${isCurrent ? 'text-typography-muted' : 'text-white'}`}>
                    {working === p.code ? 'Working…' : isCurrent ? 'Current Plan' : isEnterprise ? 'Contact Sales' : 'Choose Plan'}
                  </Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </View>
        {/* Trial code redemption */}
        {canManage && billing?.status !== 'trialing' && (
          <View className="mt-6">
            <TouchableOpacity
              onPress={() => setShowRedeemCode(v => !v)}
              className="flex-row items-center gap-2 self-start"
            >
              <FontAwesome name={showRedeemCode ? 'chevron-up' : 'chevron-down'} size={9} color={colors.textMuted} />
              <Text className="text-typography-muted text-xs">Have a trial code?</Text>
            </TouchableOpacity>
            {showRedeemCode && (
              <View className="mt-3 flex-row gap-2">
                <TextInput
                  value={trialCode}
                  onChangeText={setTrialCode}
                  placeholder="TF-PRO-3M-XXXX"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="characters"
                  className="flex-1 bg-surface-background border border-surface-border rounded-xl px-3 py-2.5 text-typography-main text-sm"
                />
                <TouchableOpacity
                  onPress={handleRedeemCode}
                  disabled={redeemLoading || !trialCode.trim()}
                  className="bg-brand-primary px-4 py-2.5 rounded-xl items-center justify-center"
                  style={{ opacity: (redeemLoading || !trialCode.trim()) ? 0.5 : 1 }}
                >
                  <Text className="text-white font-black text-xs uppercase tracking-widest">
                    {redeemLoading ? '…' : 'Activate'}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
