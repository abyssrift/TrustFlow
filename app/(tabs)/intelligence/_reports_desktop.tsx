import { ReportConfigModal } from '@/components/intelligence/IntelligenceModals';
import { supabase } from '@/lib/supabase';
import { FontAwesome } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';

const STATUS_COLOR: Record<string, string> = {
  completed: 'text-state-success',
  pending:   'text-state-warning',
  failed:    'text-state-danger',
  processing:'text-state-info',
};
const STATUS_BG: Record<string, string> = {
  completed: 'bg-state-success/10',
  pending:   'bg-state-warning/10',
  failed:    'bg-state-danger/10',
  processing:'bg-state-info/10',
};

export default function IntelligenceReports() {
  const [reports, setReports]         = useState<any[]>([]);
  const [loading, setLoading]         = useState(true);
  const [showModal, setShowModal]     = useState(false);
  const [pipelines, setPipelines]     = useState<any[]>([]);
  const [teams, setTeams]             = useState<any[]>([]);
  const [users, setUsers]             = useState<any[]>([]);

  useEffect(() => {
    Promise.all([
      supabase.from('pipelines').select('id, name').is('deleted_at', null),
      supabase.from('teams').select('id, name').is('deleted_at', null),
      supabase.from('users').select('id, full_name'),
    ]).then(([p, t, u]) => {
      if (p.data) setPipelines(p.data);
      if (t.data) setTeams(t.data);
      if (u.data) setUsers(u.data);
    });
    fetchReports();
  }, []);

  const fetchReports = async () => {
    setLoading(true);
    try {
      const { data } = await supabase.from('reporting_jobs').select('*').order('created_at', { ascending: false });
      setReports(data || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const handleGenerate = async (params: any) => {
    try {
      const { error } = await supabase.rpc('rpc_request_report', {
        p_report_type: params.type || 'performance_audit',
        p_parameters: { days: params.days, pipeline_id: params.pipeline_id, team_id: params.team_id, user_id: params.user_id },
      });
      if (error) throw error;
      setShowModal(false);
      fetchReports();
    } catch (e) { console.error(e); }
  };

  const handleDownload = async (path: string) => {
    const { data } = await supabase.storage.from('reports').createSignedUrl(path, 60);
    if (data?.signedUrl) Linking.openURL(data.signedUrl);
  };

  return (
    <View className="flex-1 bg-surface-background flex-col">

      {/* ── Header ── */}
      <View className="px-10 pt-8 pb-5 flex-row items-center justify-between border-b border-surface-border flex-shrink-0">
        <View>
          <Text className="text-brand-primary font-black uppercase tracking-[0.3em] text-[9px] mb-1">Intelligence Hub</Text>
          <Text className="text-typography-main text-4xl font-black tracking-tighter">Reports</Text>
        </View>
        <View className="flex-row items-center gap-3">
          <TouchableOpacity onPress={fetchReports} className="h-10 w-10 items-center justify-center bg-surface-card border border-surface-border rounded-xl">
            <FontAwesome name="refresh" size={13} color="var(--color-primary)" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowModal(true)} className="bg-brand-primary px-6 py-2.5 rounded-xl flex-row items-center gap-2">
            <FontAwesome name="file-pdf-o" size={12} color="white" />
            <Text className="text-white font-black uppercase tracking-widest text-[11px]">Generate Report</Text>
          </TouchableOpacity>
        </View>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="var(--color-primary)" />
        </View>
      ) : reports.length === 0 ? (
        <View className="flex-1 items-center justify-center">
          <View className="bg-surface-card p-12 rounded-[3rem] border border-surface-border items-center max-w-[480px] premium-shadow">
            <View className="w-16 h-16 bg-brand-primary/10 rounded-full items-center justify-center mb-5">
              <FontAwesome name="file-pdf-o" size={28} color="var(--color-primary)" />
            </View>
            <Text className="text-typography-main text-2xl font-black mb-2 text-center">No Reports Yet</Text>
            <Text className="text-typography-muted text-center mb-6 text-sm leading-relaxed">
              Generate a PDF audit report to track performance, compliance, and team health metrics.
            </Text>
            <TouchableOpacity onPress={() => setShowModal(true)} className="bg-brand-primary px-8 py-3 rounded-2xl">
              <Text className="text-white font-black uppercase tracking-widest text-xs">Generate First Report</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 40 }}>
          <View className="bg-surface-card rounded-[32px] border border-surface-border overflow-hidden premium-shadow">
            {/* Table header */}
            <View className="flex-row items-center px-8 py-4 border-b border-surface-border bg-surface-background/50">
              <Text className="flex-[2] text-typography-muted text-[9px] font-black uppercase tracking-widest">Report</Text>
              <Text className="flex-1 text-typography-muted text-[9px] font-black uppercase tracking-widest">Type</Text>
              <Text className="flex-1 text-typography-muted text-[9px] font-black uppercase tracking-widest">Created</Text>
              <Text className="w-24 text-center text-typography-muted text-[9px] font-black uppercase tracking-widest">Status</Text>
              <View className="w-20" />
            </View>

            {reports.map((r, i) => (
              <View
                key={r.id}
                className={`flex-row items-center px-8 py-5 ${i < reports.length - 1 ? 'border-b border-surface-border/50' : ''}`}
              >
                {/* Icon + ID */}
                <View className="flex-[2] flex-row items-center gap-4">
                  <View className={`w-10 h-10 rounded-xl items-center justify-center ${STATUS_BG[r.status] || 'bg-surface-background'}`}>
                    <FontAwesome name="file-text-o" size={16} color={r.status === 'completed' ? 'var(--color-success)' : 'var(--color-primary)'} />
                  </View>
                  <View>
                    <Text className="text-typography-main font-black text-sm">Report #{r.id.substring(0, 8).toUpperCase()}</Text>
                    <Text className="text-typography-muted text-[10px]">{r.parameters?.days || 30} day window</Text>
                  </View>
                </View>
                {/* Type */}
                <Text className="flex-1 text-typography-muted text-xs font-bold capitalize">
                  {(r.report_type || 'Performance').replace(/_/g, ' ')}
                </Text>
                {/* Date */}
                <Text className="flex-1 text-typography-muted text-xs">
                  {new Date(r.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                </Text>
                {/* Status badge */}
                <View className="w-24 items-center">
                  <View className={`px-3 py-1 rounded-full ${STATUS_BG[r.status] || 'bg-surface-background'}`}>
                    <Text className={`text-[9px] font-black uppercase tracking-widest ${STATUS_COLOR[r.status] || 'text-typography-muted'}`}>
                      {r.status}
                    </Text>
                  </View>
                </View>
                {/* Action */}
                <View className="w-20 items-end">
                  {r.status === 'completed' && r.file_url ? (
                    <TouchableOpacity
                      onPress={() => handleDownload(r.file_url)}
                      className="bg-brand-primary/10 border border-brand-primary/20 px-3 py-1.5 rounded-lg flex-row items-center gap-1.5"
                    >
                      <FontAwesome name="download" size={10} color="var(--color-primary)" />
                      <Text className="text-brand-primary text-[10px] font-black">Download</Text>
                    </TouchableOpacity>
                  ) : (
                    <View className="px-3 py-1.5">
                      <Text className="text-typography-dim text-[10px]">—</Text>
                    </View>
                  )}
                </View>
              </View>
            ))}
          </View>
        </ScrollView>
      )}

      <ReportConfigModal
        visible={showModal}
        onClose={() => setShowModal(false)}
        onConfirm={handleGenerate}
        pipelines={pipelines} teams={teams} users={users} initialDays={30}
      />
    </View>
  );
}
