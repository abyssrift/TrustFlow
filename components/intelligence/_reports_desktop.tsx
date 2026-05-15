import { ReportConfigModal } from '@/components/intelligence/IntelligenceModals';
import { supabase } from '@/lib/supabase';
import { FontAwesome } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}:${String(s).padStart(2, '0')}`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function ElapsedTimer({ createdAt, updatedAt, status }: { createdAt: string; updatedAt: string; status: string }) {
  const isActive = status === 'pending' || status === 'processing';

  const getStaticSeconds = () =>
    Math.round((new Date(updatedAt).getTime() - new Date(createdAt).getTime()) / 1000);

  const getLiveSeconds = () =>
    Math.round((Date.now() - new Date(createdAt).getTime()) / 1000);

  const [elapsed, setElapsed] = useState(isActive ? getLiveSeconds() : getStaticSeconds());

  useEffect(() => {
    if (!isActive) { setElapsed(getStaticSeconds()); return; }
    const id = setInterval(() => setElapsed(getLiveSeconds()), 1000);
    return () => clearInterval(id);
  }, [isActive, createdAt, updatedAt]);

  return (
    <View className="w-20 items-start">
      <View className={`flex-row items-center gap-1.5 px-2.5 py-1 rounded-lg ${isActive ? 'bg-state-info/10' : 'bg-surface-background'}`}>
        {isActive && (
          <View className="w-1.5 h-1.5 rounded-full bg-state-info animate-pulse" />
        )}
        <Text className={`text-[10px] font-black tabular-nums ${isActive ? 'text-state-info' : 'text-typography-muted'}`}>
          {formatDuration(elapsed)}
        </Text>
      </View>
    </View>
  );
}

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

const REPORT_META: Record<string, { label: string; icon: string }> = {
  general:                   { label: 'Overview',                  icon: 'bar-chart'     },
  performance_audit:         { label: 'Overview',                  icon: 'bar-chart'     },
  worker_comparison:         { label: 'People Comparison',         icon: 'users'         },
  team_comparison:           { label: 'Team Comparison',           icon: 'group'         },
  workflow_analysis:         { label: 'Pipeline Review',           icon: 'rocket'        },
  user_performance_series:   { label: 'Performance Timeline',      icon: 'line-chart'    },
  user_performance_summary:  { label: 'Performance Summary',       icon: 'user'          },
  pipeline_stage_dwell:      { label: 'Stage Dwell Analysis',        icon: 'clock-o'       },
  pipeline_throughput:       { label: 'Pipeline Throughput',         icon: 'area-chart'    },
  personnel_comparison:      { label: 'People Cost Comparison',     icon: 'balance-scale' },
  targets_status:            { label: 'Objectives & SLA Report',    icon: 'bullseye'      },
  personal_pulse:            { label: 'Personal Snapshot',          icon: 'heartbeat'     },
  multi_report:              { label: 'Combined Report Bundle',       icon: 'files-o'       },
};

function getReportSubtitle(r: any): string {
  const p = r.parameters || {};
  switch (r.report_type) {
    case 'user_performance_series':
      return `${p.period_type ?? 'month'} series · ${p.n_periods ?? 12} periods`;
    case 'user_performance_summary':
      return p.date_start && p.date_end
        ? `${p.date_start.slice(0, 10)} → ${p.date_end.slice(0, 10)}`
        : `${p.days ?? 30} day window`;
    case 'pipeline_stage_dwell':
      return p.date_start && p.date_end
        ? `Stage dwell · ${p.date_start.slice(0, 10)} → ${p.date_end.slice(0, 10)}`
        : 'Stage dwell analysis';
    case 'pipeline_throughput':
      return `${p.period_type ?? 'month'} throughput · ${p.n_periods ?? 12} periods`;
    case 'personnel_comparison':
      return `${(p.user_ids ?? []).length} people compared · ${p.days ?? 30}d window`;
    case 'targets_status':
      return 'All company objectives';
    case 'personal_pulse':
      return 'Real-time activity snapshot';
    case 'worker_comparison':
      return `Person A vs Person B · ${p.days ?? 30}d window`;
    case 'team_comparison':
      return `Team A vs Team B · ${p.days ?? 30}d window`;
    default:
      return p.scope === 'pipeline' ? `Pipeline scope · ${p.days ?? 30}d` : `${p.days ?? 30} day window`;
  }
}

const POLL_INTERVAL_MS = 4000;

export default function IntelligenceReports() {
  const router = useRouter();
  const [reports, setReports]         = useState<any[]>([]);
  const [loading, setLoading]         = useState(true);
  const [showModal, setShowModal]     = useState(false);
  const [pipelines, setPipelines]     = useState<any[]>([]);
  const [teams, setTeams]             = useState<any[]>([]);
  const [users, setUsers]             = useState<any[]>([]);
  const pollRef                       = useRef<ReturnType<typeof setInterval> | null>(null);

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
    return () => stopPolling();
  }, []);

  const hasActive = (list: any[]) =>
    list.some(r => r.status === 'pending' || r.status === 'processing');

  const startPolling = () => {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      const { data } = await supabase
        .from('reporting_jobs')
        .select('*')
        .order('created_at', { ascending: false });
      const list = data || [];
      setReports(list);
      if (!hasActive(list)) stopPolling();
    }, POLL_INTERVAL_MS);
  };

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  const fetchReports = async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from('reporting_jobs')
        .select('*')
        .order('created_at', { ascending: false });
      const list = data || [];
      setReports(list);
      if (hasActive(list)) startPolling(); else stopPolling();
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const handleGenerate = async (params: any) => {
    try {
      const { data: jobId, error } = await supabase.rpc('rpc_request_report', {
        p_report_type: params.type || 'performance_audit',
        p_parameters: params,
      });
      if (error) throw error;
      setShowModal(false);
      fetchReports();
    } catch (e: any) { console.error(e); }
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
          <TouchableOpacity onPress={() => router.push('/intelligence/ReportGenerator')} className="bg-brand-primary px-6 py-2.5 rounded-xl flex-row items-center gap-2">
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
            <TouchableOpacity onPress={() => router.push('/intelligence/ReportGenerator')} className="bg-brand-primary px-8 py-3 rounded-2xl">
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
              <Text className="w-20 text-typography-muted text-[9px] font-black uppercase tracking-widest">Duration</Text>
              <Text className="w-24 text-center text-typography-muted text-[9px] font-black uppercase tracking-widest">Status</Text>
              <View className="w-20" />
            </View>

            {reports.map((r, i) => {
              const meta = REPORT_META[r.report_type] ?? { label: (r.report_type || 'Report').replace(/_/g, ' '), icon: 'file-text-o' };
              return (
                <View
                  key={r.id}
                  className={`flex-row items-center px-8 py-5 ${i < reports.length - 1 ? 'border-b border-surface-border/50' : ''}`}
                >
                  {/* Icon + ID */}
                  <View className="flex-[2] flex-row items-center gap-4">
                    <View className={`w-10 h-10 rounded-xl items-center justify-center ${STATUS_BG[r.status] || 'bg-surface-background'}`}>
                      <FontAwesome
                        name={meta.icon as any}
                        size={16}
                        color={r.status === 'completed' ? 'var(--color-success)' : 'var(--color-primary)'}
                      />
                    </View>
                    <View>
                      <Text className="text-typography-main font-black text-sm">Report #{r.id.substring(0, 8).toUpperCase()}</Text>
                      <Text className="text-typography-muted text-[10px]">{getReportSubtitle(r)}</Text>
                    </View>
                  </View>
                  {/* Type */}
                  <Text className="flex-1 text-typography-muted text-xs font-bold" numberOfLines={1}>
                    {meta.label}
                  </Text>
                  {/* Date */}
                  <Text className="flex-1 text-typography-muted text-xs">
                    {new Date(r.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                  </Text>
                  {/* Duration timer */}
                  <ElapsedTimer createdAt={r.created_at} updatedAt={r.updated_at} status={r.status} />
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
              );
            })}
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
