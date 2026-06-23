import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, useWindowDimensions, Platform } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { supabase } from '@/lib/supabase';

type Plan = {
  code: string;
  name: string;
  description: string | null;
  price_cents: number;
  currency: string;
  interval: string;
  per_seat: boolean;
  features: string[];
};

type Billing = {
  plan_code: string;
  status: string;
  seats: number;
  active_members: number;
  external_provider: string | null;
  current_period_end: string | null;
  trial_ends_at: string | null;
  connected: boolean;
};

type Overview = { billing: Billing; plans: Plan[] };

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
      } else {
        infoToast(r?.message || 'Your request was recorded.', 'Billing');
      }
    } catch (e: any) {
      errorToast(e?.message || 'Could not update plan.');
    } finally {
      setWorking(null);
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
              <View className="px-3 py-1 rounded-full border bg-state-success/10 border-color-success/30">
                <Text className="text-state-success text-[10px] font-black uppercase tracking-widest">
                  {STATUS_LABEL[billing.status] || billing.status}
                </Text>
              </View>
            </View>
            <View className="flex-row flex-wrap gap-y-3">
              <View className="w-1/2">
                <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-widest">Active members</Text>
                <Text className="text-typography-main text-lg font-black">{billing.active_members}</Text>
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

                <Text className="text-typography-main text-2xl font-black mb-1">{priceLabel(p)}</Text>

                <View className={`gap-1.5 mt-3 mb-4 ${isWide ? 'grow' : ''}`}>
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
      </ScrollView>
    </View>
  );
}
