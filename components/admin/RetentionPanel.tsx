import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Switch, Modal } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { supabase } from '@/lib/supabase';
import ConfirmModal from '@/components/common/ConfirmModal';

type CompanyStatus = {
  id: string;
  name: string;
  last_active_at: string | null;
  days_inactive: number;
  inactivity_days: number;
  warning_interval_days: number;
  days_until_purge: number;
  status: 'active' | 'warning' | 'overdue';
  last_warning_at: string | null;
};

type Settings = {
  inactivity_days: number;
  warning_interval_days: number;
  user_inactivity_days: number;
  warnings_enabled: boolean;
};

type InactiveUser = {
  id: string;
  full_name: string | null;
  email: string;
  is_owner: boolean;
  last_seen_at: string | null;
  days_inactive: number;
};

type Overview = {
  company: CompanyStatus;
  settings: Settings;
  inactive_users: InactiveUser[];
};

const fmtDate = (iso: string | null) => {
  if (!iso) return 'Never';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'Never';
  return d.toLocaleDateString();
};

export default function RetentionPanel() {
  const colors = useThemeColors();
  const { profile, hasPermission, signOut } = useAuth();
  const { successToast, errorToast, infoToast } = useToast();

  const isOwner = !!profile?.is_owner;
  const canManage = isOwner || hasPermission('company.settings') || hasPermission('role.manage');

  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<Overview | null>(null);

  // editable settings
  const [form, setForm] = useState<Settings | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  // purge user
  const [purgeTarget, setPurgeTarget] = useState<InactiveUser | null>(null);
  const [purgingUser, setPurgingUser] = useState(false);

  // purge company
  const [showCompanyPurge, setShowCompanyPurge] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [purgingCompany, setPurgingCompany] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('rpc_retention_overview');
      if (error) throw error;
      setOverview(data as Overview);
      setForm((data as Overview).settings);
    } catch (e: any) {
      errorToast(e?.message || 'Could not load retention status.');
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
        <Text className="text-typography-muted text-sm text-center mt-2">Only workspace admins can manage data retention.</Text>
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

  const company = overview?.company;
  const statusColor = company?.status === 'overdue' ? colors.danger : company?.status === 'warning' ? colors.warning : colors.success;
  const statusLabel = company?.status === 'overdue' ? 'Overdue for review' : company?.status === 'warning' ? 'Warning window' : 'Active';

  const handleSaveSettings = async () => {
    if (!form) return;
    setSavingSettings(true);
    try {
      const { error } = await supabase.rpc('rpc_update_retention_settings', {
        p_inactivity_days: form.inactivity_days,
        p_warning_interval_days: form.warning_interval_days,
        p_user_inactivity_days: form.user_inactivity_days,
        p_warnings_enabled: form.warnings_enabled,
      });
      if (error) throw error;
      successToast('Retention policy updated.');
      await load();
    } catch (e: any) {
      errorToast(e?.message || 'Could not save settings.');
    } finally {
      setSavingSettings(false);
    }
  };

  const handlePurgeUser = async () => {
    if (!purgeTarget) return;
    setPurgingUser(true);
    try {
      const { error } = await supabase.rpc('rpc_purge_user', { p_user_id: purgeTarget.id });
      if (error) throw error;
      successToast(`Purged ${purgeTarget.full_name || purgeTarget.email}.`);
      setPurgeTarget(null);
      await load();
    } catch (e: any) {
      errorToast(e?.message || 'Could not purge user.');
    } finally {
      setPurgingUser(false);
    }
  };

  const handlePurgeCompany = async () => {
    if (!company) return;
    setPurgingCompany(true);
    try {
      const { error } = await supabase.rpc('rpc_purge_company', {
        p_company_id: company.id,
        p_confirm_name: confirmName.trim(),
      });
      if (error) throw error;
      infoToast('Workspace purged. Signing out…');
      setTimeout(() => { signOut(); }, 800);
    } catch (e: any) {
      errorToast(e?.message || 'Could not purge workspace.');
      setPurgingCompany(false);
    }
  };

  const numField = (label: string, key: keyof Settings, suffix: string) => (
    <View className="flex-1 min-w-[140px]">
      <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-2">{label}</Text>
      <View className="flex-row items-center bg-surface-background border border-surface-border rounded-xl px-4">
        <TextInput
          value={String((form as any)?.[key] ?? '')}
          onChangeText={(t) => {
            const n = parseInt(t.replace(/[^0-9]/g, ''), 10);
            setForm(f => f ? { ...f, [key]: Number.isFinite(n) ? n : 0 } : f);
          }}
          keyboardType="number-pad"
          className="flex-1 py-3.5 text-typography-main font-black text-base"
          placeholderTextColor={colors.textMuted}
        />
        <Text className="text-typography-muted text-[10px] font-bold uppercase">{suffix}</Text>
      </View>
    </View>
  );

  return (
    <View className="flex-1">
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 48 }}>
        {/* Header */}
        <View className="mb-6 px-1">
          <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.25em] mb-1">Data Lifecycle</Text>
          <Text className="text-typography-main text-2xl font-black tracking-tight">Retention & Inactivity</Text>
        </View>

        {/* Company status card */}
        {company && (
          <View className="bg-surface-card border border-surface-border rounded-2xl p-5 mb-5">
            <View className="flex-row items-center justify-between mb-4">
              <Text className="text-typography-main font-black text-base flex-1 mr-3" numberOfLines={1}>{company.name}</Text>
              <View style={{ backgroundColor: `${statusColor}1A`, borderColor: `${statusColor}55` }} className="px-3 py-1 rounded-full border">
                <Text style={{ color: statusColor }} className="text-[10px] font-black uppercase tracking-widest">{statusLabel}</Text>
              </View>
            </View>

            <View className="flex-row flex-wrap gap-y-4">
              <View className="w-1/2">
                <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-widest">Days inactive</Text>
                <Text style={{ color: statusColor }} className="text-2xl font-black">{company.days_inactive}</Text>
              </View>
              <View className="w-1/2">
                <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-widest">Days until purge</Text>
                <Text className="text-typography-main text-2xl font-black">{company.days_until_purge}</Text>
              </View>
              <View className="w-1/2">
                <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-widest">Last activity</Text>
                <Text className="text-typography-main text-sm font-bold mt-1">{fmtDate(company.last_active_at)}</Text>
              </View>
              <View className="w-1/2">
                <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-widest">Last warning sent</Text>
                <Text className="text-typography-main text-sm font-bold mt-1">{fmtDate(company.last_warning_at)}</Text>
              </View>
            </View>
          </View>
        )}

        {/* Policy settings */}
        {form && (
          <View className="bg-surface-card border border-surface-border rounded-2xl p-5 mb-5">
            <Text className="text-brand-primary text-[10px] font-black uppercase mb-4 tracking-widest">Policy</Text>
            <View className="flex-row flex-wrap gap-3 mb-4">
              {numField('Company inactivity', 'inactivity_days', 'days')}
              {numField('Warning lead time', 'warning_interval_days', 'days')}
              {numField('User inactivity', 'user_inactivity_days', 'days')}
            </View>

            <View className="flex-row items-center justify-between bg-surface-background border border-surface-border rounded-xl px-4 py-3 mb-5">
              <View className="flex-1 mr-3">
                <Text className="text-typography-main font-black text-xs uppercase tracking-tight">Recurring warnings</Text>
                <Text className="text-typography-muted text-[10px] mt-0.5">Notify members as the purge window approaches.</Text>
              </View>
              <Switch
                value={form.warnings_enabled}
                onValueChange={(v) => setForm(f => f ? { ...f, warnings_enabled: v } : f)}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor="white"
              />
            </View>

            <TouchableOpacity
              onPress={handleSaveSettings}
              disabled={savingSettings}
              className="bg-brand-primary py-4 rounded-xl items-center"
            >
              <Text className="text-white font-black text-[11px] uppercase tracking-widest">
                {savingSettings ? 'Saving…' : 'Save Policy'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Inactive users */}
        <View className="bg-surface-card border border-surface-border rounded-2xl p-5 mb-5">
          <View className="flex-row items-center justify-between mb-4">
            <Text className="text-brand-primary text-[10px] font-black uppercase tracking-widest">Inactive members</Text>
            <Text className="text-typography-muted text-[10px] font-bold">{overview?.inactive_users.length || 0}</Text>
          </View>

          {(!overview || overview.inactive_users.length === 0) ? (
            <View className="items-center py-8">
              <FontAwesome name="check-circle" size={28} color={colors.success} />
              <Text className="text-typography-muted text-xs mt-3">No members past the inactivity threshold.</Text>
            </View>
          ) : (
            <View className="gap-2">
              {overview.inactive_users.map(u => (
                <View key={u.id} className="flex-row items-center bg-surface-background border border-surface-border rounded-xl p-3">
                  <View className="flex-1 mr-3">
                    <Text className="text-typography-main font-black text-sm" numberOfLines={1}>{u.full_name || u.email}</Text>
                    <Text className="text-typography-muted text-[11px]" numberOfLines={1}>
                      {u.email} · inactive {u.days_inactive}d · last seen {fmtDate(u.last_seen_at)}
                    </Text>
                  </View>
                  {u.is_owner ? (
                    <View className="px-2.5 py-1 rounded-lg bg-brand-primary/10 border border-brand-primary/20">
                      <Text className="text-brand-primary text-[9px] font-black uppercase tracking-widest">Owner</Text>
                    </View>
                  ) : (
                    <TouchableOpacity
                      onPress={() => setPurgeTarget(u)}
                      className="px-3 py-2 rounded-lg bg-state-danger/10 border border-state-danger/20 flex-row items-center gap-1.5"
                    >
                      <FontAwesome name="trash-o" size={12} color={colors.danger} />
                      <Text style={{ color: colors.danger }} className="text-[10px] font-black uppercase tracking-widest">Purge</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Danger zone — owner only */}
        {isOwner && company && (
          <View className="border border-state-danger/30 bg-state-danger/5 rounded-2xl p-5">
            <Text style={{ color: colors.danger }} className="text-[10px] font-black uppercase tracking-widest mb-2">Danger Zone</Text>
            <Text className="text-typography-muted text-xs leading-5 mb-4">
              Permanently delete this entire workspace and all of its data — tasks, files, members, pipelines and history. This cannot be undone.
            </Text>
            <TouchableOpacity
              onPress={() => { setConfirmName(''); setShowCompanyPurge(true); }}
              className="border border-state-danger/40 bg-state-danger/10 py-4 rounded-xl items-center flex-row justify-center gap-2"
            >
              <FontAwesome name="exclamation-triangle" size={13} color={colors.danger} />
              <Text style={{ color: colors.danger }} className="font-black text-[11px] uppercase tracking-widest">Purge Workspace</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* Purge user confirm */}
      <ConfirmModal
        visible={!!purgeTarget}
        title="Purge member?"
        description={purgeTarget ? `This permanently deletes ${purgeTarget.full_name || purgeTarget.email} and their personal records (time logs, comments). Their assignments and team memberships are removed. This cannot be undone.` : ''}
        confirmLabel="Purge member"
        variant="danger"
        loading={purgingUser}
        onConfirm={handlePurgeUser}
        onCancel={() => setPurgeTarget(null)}
      />

      {/* Purge company — type-to-confirm (inline colors per RN Modal convention) */}
      <Modal visible={showCompanyPurge} transparent animationType="fade" onRequestClose={() => !purgingCompany && setShowCompanyPurge(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <View style={{ width: '100%', maxWidth: 440, backgroundColor: colors.card, borderRadius: 24, borderWidth: 1, borderColor: `${colors.danger}55`, overflow: 'hidden' }}>
            <View style={{ padding: 24 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: `${colors.danger}1A`, alignItems: 'center', justifyContent: 'center' }}>
                  <FontAwesome name="exclamation-triangle" size={20} color={colors.danger} />
                </View>
                <Text style={{ color: colors.textMain, fontSize: 18, fontWeight: '900', flex: 1 }}>Purge entire workspace</Text>
              </View>
              <Text style={{ color: colors.textMuted, fontSize: 13, lineHeight: 20, marginBottom: 16 }}>
                This permanently deletes <Text style={{ color: colors.textMain, fontWeight: '800' }}>{company?.name}</Text> and every record in it. To confirm, type the workspace name exactly.
              </Text>
              <TextInput
                value={confirmName}
                onChangeText={setConfirmName}
                placeholder={company?.name || 'Workspace name'}
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, color: colors.textMain, fontWeight: '700', marginBottom: 20 }}
              />
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <TouchableOpacity
                  onPress={() => setShowCompanyPurge(false)}
                  disabled={purgingCompany}
                  style={{ flex: 1, paddingVertical: 15, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, alignItems: 'center' }}
                >
                  <Text style={{ color: colors.textMuted, fontWeight: '900', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handlePurgeCompany}
                  disabled={purgingCompany || confirmName.trim() !== (company?.name || '')}
                  style={{ flex: 2, paddingVertical: 15, borderRadius: 14, backgroundColor: colors.danger, alignItems: 'center', opacity: confirmName.trim() !== (company?.name || '') ? 0.5 : 1 }}
                >
                  <Text style={{ color: '#fff', fontWeight: '900', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>
                    {purgingCompany ? 'Purging…' : 'Purge forever'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
