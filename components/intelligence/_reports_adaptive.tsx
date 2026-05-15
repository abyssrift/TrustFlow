import { supabase } from '@/lib/supabase';
import { FontAwesome } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native';

const STATUS_COLOR: Record<string, string> = {
  completed:  'text-state-success',
  pending:    'text-state-warning',
  failed:     'text-state-danger',
  processing: 'text-state-info',
};

const Picker = ({ items, selectedId, onSelect, labelKey = 'name' }: any) => (
  <View className="flex-row flex-wrap gap-2">
    {items.map((item: any) => (
      <TouchableOpacity
        key={item.id}
        onPress={() => onSelect(item.id)}
        className={`px-4 py-2 rounded-xl border ${selectedId === item.id ? 'bg-surface-background border-brand-primary' : 'border-surface-border'}`}
      >
        <Text className={`text-[11px] font-medium ${selectedId === item.id ? 'text-brand-primary font-bold' : 'text-typography-muted'}`}>
          {item[labelKey] || 'N/A'}
        </Text>
      </TouchableOpacity>
    ))}
  </View>
);

const GenerateModal = ({ visible, onClose, onConfirm, pipelines, teams, users }: any) => {
  const [days, setDays] = useState(30);
  const [pipeline, setPipeline] = useState<string | null>(null);
  const [team, setTeam]         = useState<string | null>(null);
  const [user, setUser]         = useState<string | null>(null);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 bg-black/70 items-center justify-center px-6">
        <View className="bg-surface-card w-full max-h-[85%] rounded-[32px] border border-surface-border overflow-hidden">
          <View className="p-8 pb-4">
            <Text className="text-typography-main text-2xl font-black mb-1">Generate Report</Text>
            <Text className="text-typography-muted text-xs">Configure audit parameters</Text>
          </View>
          <ScrollView className="px-8" showsVerticalScrollIndicator={false}>
            <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-widest mt-4 mb-3">Timeframe</Text>
            <View className="flex-row gap-2">
              {[7, 30, 90].map(val => (
                <TouchableOpacity key={val} onPress={() => setDays(val)} className={`flex-1 py-3 rounded-xl border ${days === val ? 'bg-brand-primary border-brand-primary' : 'border-surface-border'}`}>
                  <Text className={`text-center font-bold text-xs ${days === val ? 'text-white' : 'text-typography-muted'}`}>{val} Days</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-widest mt-6 mb-3">Pipeline</Text>
            <Picker items={[{ id: null, name: 'All Pipelines' }, ...pipelines]} selectedId={pipeline} onSelect={setPipeline} />
            <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-widest mt-6 mb-3">Team</Text>
            <Picker items={[{ id: null, name: 'All Teams' }, ...teams]} selectedId={team} onSelect={setTeam} />
            <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-widest mt-6 mb-3">Individual</Text>
            <Picker items={[{ id: null, name: 'Everyone' }, ...users]} selectedId={user} onSelect={setUser} labelKey="full_name" />
            <View className="h-10" />
          </ScrollView>
          <View className="p-8 pt-4 flex-row gap-3 border-t border-surface-border">
            <TouchableOpacity onPress={onClose} className="flex-1 py-4 rounded-2xl bg-surface-background border border-surface-border items-center">
              <Text className="text-typography-muted font-bold">Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { onConfirm({ days, pipeline_id: pipeline, team_id: team, user_id: user }); onClose(); }}
              className="flex-1 py-4 rounded-2xl bg-brand-primary items-center"
            >
              <Text className="text-white font-bold">Generate</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

export default function IntelligenceReportsNative() {
  const router = useRouter();
  const [reports, setReports]   = useState<any[]>([]);
  const [loading, setLoading]   = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [pipelines, setPipelines] = useState<any[]>([]);
  const [teams, setTeams]         = useState<any[]>([]);
  const [users, setUsers]         = useState<any[]>([]);

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
        p_report_type: 'performance_audit',
        p_parameters: { days: params.days, pipeline_id: params.pipeline_id, team_id: params.team_id, user_id: params.user_id },
      });
      if (error) throw error;
      Alert.alert('Processing', 'Your report is being generated.');
      fetchReports();
    } catch (e: any) { Alert.alert('Error', e.message); }
  };

  const handleDownload = async (path: string) => {
    const { data } = await supabase.storage.from('reports').createSignedUrl(path, 60);
    if (data?.signedUrl) Linking.openURL(data.signedUrl);
  };

  return (
    <View className="flex-1 bg-surface-background">
      <View className="px-6 pt-14 pb-4 flex-row items-end justify-between">
        <View>
          <Text className="text-brand-primary font-black uppercase tracking-[4px] text-[10px] mb-1">Intelligence Hub</Text>
          <Text className="text-typography-main text-3xl font-black">Reports</Text>
        </View>
        <View className="flex-row gap-2">
          <TouchableOpacity onPress={fetchReports} className="w-11 h-11 items-center justify-center bg-surface-card border border-surface-border rounded-2xl">
            <FontAwesome name="refresh" size={13} color="rgb(var(--brand-primary))" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/intelligence/ReportGenerator')} className="bg-brand-primary px-5 py-3 rounded-2xl flex-row items-center gap-2">
            <FontAwesome name="file-pdf-o" size={11} color="white" />
            <Text className="text-white font-black text-[11px]">Generate</Text>
          </TouchableOpacity>
        </View>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="rgb(var(--brand-primary))" />
        </View>
      ) : reports.length === 0 ? (
        <View className="flex-1 items-center justify-center px-6">
          <View className="bg-surface-card p-10 rounded-[2.5rem] border border-surface-border items-center w-full">
            <View className="w-16 h-16 bg-brand-primary/10 rounded-full items-center justify-center mb-4">
              <FontAwesome name="file-pdf-o" size={28} color="rgb(var(--brand-primary))" />
            </View>
            <Text className="text-typography-main text-xl font-black mb-2">No Reports Yet</Text>
            <Text className="text-typography-muted text-center text-sm leading-relaxed mb-6">
              Generate a PDF audit report to track performance, compliance, and team health.
            </Text>
            <TouchableOpacity onPress={() => router.push('/intelligence/ReportGenerator')} className="bg-brand-primary px-8 py-3 rounded-2xl">
              <Text className="text-white font-black uppercase tracking-widest text-xs">Generate First Report</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <ScrollView className="flex-1 px-6" showsVerticalScrollIndicator={false}>
          {reports.map(r => (
            <TouchableOpacity
              key={r.id}
              onPress={() => r.status === 'completed' && r.file_url && handleDownload(r.file_url)}
              className="bg-surface-card border border-surface-border rounded-2xl p-5 mb-3 flex-row items-center"
            >
              <View className={`w-11 h-11 rounded-xl items-center justify-center mr-4 ${r.status === 'completed' ? 'bg-state-success/10' : 'bg-surface-background border border-surface-border'}`}>
                <FontAwesome name="file-text-o" size={16} color={r.status === 'completed' ? 'rgb(var(--state-success))' : 'rgb(var(--brand-primary))'} />
              </View>
              <View className="flex-1">
                <Text className="text-typography-main font-black text-sm">Report #{r.id.substring(0, 8).toUpperCase()}</Text>
                <View className="flex-row items-center gap-2 mt-0.5">
                  <Text className={`text-[10px] font-bold capitalize ${STATUS_COLOR[r.status] || 'text-typography-muted'}`}>{r.status}</Text>
                  <Text className="text-typography-dim text-[10px]">·</Text>
                  <Text className="text-typography-muted text-[10px]">
                    {new Date(r.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                  </Text>
                </View>
              </View>
              {r.status === 'completed' && r.file_url && (
                <FontAwesome name="download" size={14} color="rgb(var(--brand-primary))" />
              )}
            </TouchableOpacity>
          ))}
          <View className="h-10" />
        </ScrollView>
      )}

      <GenerateModal
        visible={showModal}
        onClose={() => setShowModal(false)}
        onConfirm={handleGenerate}
        pipelines={pipelines}
        teams={teams}
        users={users}
      />
    </View>
  );
}
