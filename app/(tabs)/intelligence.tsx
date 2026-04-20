import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Alert, RefreshControl, Platform, Modal, TextInput } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthProvider';
import * as Linking from 'expo-linking';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Section Components
const SectionToggle = ({ active, onSelect }: { active: string, onSelect: (s: string) => void }) => (
  <View className="flex-row bg-surface-card rounded-2xl p-1 mx-6 mb-6 border border-surface-border">
    {['Radar', 'Targets', 'Archives'].map((s) => (
      <TouchableOpacity
        key={s}
        onPress={() => onSelect(s.toLowerCase())}
        className={`flex-1 py-3 rounded-xl items-center ${active === s.toLowerCase() ? 'bg-brand-primary' : ''}`}
      >
        <Text className={`font-bold text-xs ${active === s.toLowerCase() ? 'text-white' : 'text-typography-muted'}`}>
          {s}
        </Text>
      </TouchableOpacity>
    ))}
  </View>
);

export default function IntelligenceScreen() {
  const [activeSection, setActiveSection] = useState('radar');
  const [loading, setLoading] = useState(true);
  const [showReportModal, setShowReportModal] = useState(false);
  const [showTargetModal, setShowTargetModal] = useState(false);
  
  const [data, setData] = useState<any>(null);
  const [reports, setReports] = useState<any[]>([]);
  const [targets, setTargets] = useState<any[]>([]);
  
  // Base Data for Selectors
  const [pipelines, setPipelines] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [allStages, setAllStages] = useState<any[]>([]);
  
  // Current Global State
  const [days, setDays] = useState(30);
  const [pipelineId, setPipelineId] = useState<string | null>(null);

  // Widget Customization State
  const DEFAULT_WIDGETS = ['throughput', 'efficiency', 'flow_ratio', 'first_pass_yield'];
  const [activeWidgets, setActiveWidgets] = useState<string[]>(DEFAULT_WIDGETS);
  const [showWidgetModal, setShowWidgetModal] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem('@trustedge_radar_widgets').then(val => {
      if (val) setActiveWidgets(JSON.parse(val));
    });
    fetchBaseData();
  }, []);

  const handleSaveWidgets = async (widgets: string[]) => {
    setActiveWidgets(widgets);
    setShowWidgetModal(false);
    await AsyncStorage.setItem('@trustedge_radar_widgets', JSON.stringify(widgets));
  };

  useEffect(() => {
    let isMounted = true;
    const fetch = async () => {
      if (!isMounted) return;
      if (activeSection === 'radar') await fetchAudit();
      if (activeSection === 'archives') await fetchReports();
      if (activeSection === 'targets') await fetchTargets();
    };
    fetch();
    return () => { isMounted = false; };
  }, [activeSection, pipelineId, days]);

  const fetchBaseData = async () => {
    const { data: p } = await supabase.from('pipelines').select('id, name').is('deleted_at', null);
    const { data: t } = await supabase.from('teams').select('id, name').is('deleted_at', null);
    const { data: u } = await supabase.from('users').select('id, full_name');
    const { data: s } = await supabase.from('pipeline_stages').select('id, name, pipeline_id').order('position', { ascending: true });
    
    if (p) setPipelines(p);
    if (t) setTeams(t);
    if (u) setUsers(u);
    if (s) setAllStages(s);
  };

  const fetchAudit = async () => {
    try {
      setLoading(true);
      const { data: res, error } = await supabase.rpc('rpc_get_organizational_audit', {
        p_pipeline_id: pipelineId,
        p_days: days
      });
      if (error) throw error;
      setData(res);
    } catch (err) {
      console.error('Audit Error:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchReports = async () => {
    try {
      setLoading(true);
      const { data: res } = await supabase.from('reporting_jobs').select('*').order('created_at', { ascending: false });
      setReports(res || []);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };

  const fetchTargets = async () => {
     try {
       setLoading(true);
       const { data: res } = await supabase.from('pipeline_stage_targets').select('*, stage:pipeline_stages(name, pipeline_id)').order('created_at', { ascending: false });
       
       // Enrich with current counts for volume targets
       const enriched = await Promise.all((res || []).map(async (t) => {
         if (t.target_type === 'volume') {
           const { count } = await supabase.from('tasks').select('*', { count: 'exact', head: true }).eq('current_stage_id', t.stage_id);
           return { ...t, current_count: count || 0 };
         }
         return t;
       }));
       
       setTargets(enriched);
     } catch (err) { console.error(err); } finally { setLoading(false); }
  };

  const handleCreateTarget = async (params: any) => {
    try {
      setLoading(true);
      const { error } = await supabase.from('pipeline_stage_targets').insert({
        stage_id: params.stage_id,
        target_type: params.target_type,
        target_active_seconds: params.active,
        target_lifecycle_seconds: params.lifecycle,
        target_quantity: params.quantity,
        target_deadline: params.deadline
      });
      if (error) throw error;
      fetchTargets();
    } catch (err: any) {
      Alert.alert('Creation Failed', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateTarget = async (id: string, field: string, val: string) => {
    const num = parseInt(val);
    if (isNaN(num)) return;
    const { error } = await supabase.from('pipeline_stage_targets').update({ [field]: num }).eq('id', id);
    if (error) Alert.alert('Update Failed', error.message);
    else fetchTargets();
  };

  const handleExportPDF = async (params: any) => {
    try {
      setLoading(true);
      const { error } = await supabase.rpc('rpc_request_report', {
        p_report_type: params.type || 'performance_audit',
        p_parameters: {
          days: params.days,
          pipeline_id: params.pipeline_id,
          team_id: params.team_id,
          user_id: params.user_id
        }
      });
      if (error) throw error;
      Alert.alert('Processing', 'Your report is being generated.');
      if (activeSection === 'archives') fetchReports();
    } catch (err: any) {
      Alert.alert('Failure', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadReport = async (path: string) => {
    const { data, error } = await supabase.storage.from('reports').createSignedUrl(path, 60);
    if (data?.signedUrl) Linking.openURL(data.signedUrl);
  };

  return (
    <View className="flex-1 bg-surface-background">
      <ScrollView className="flex-1" stickyHeaderIndices={[1]} refreshControl={<RefreshControl refreshing={false} onRefresh={fetchAudit} />}>
        {/* Header */}
        <View className="px-6 pt-12 pb-6">
          <Text className="text-brand-primary font-black uppercase tracking-[4px] text-[10px] mb-1">Intelligence Center</Text>
          <Text className="text-typography-main text-3xl font-black">Audit Hub</Text>
        </View>

        {/* Section Toggle */}
        <SectionToggle active={activeSection} onSelect={setActiveSection} />

        {/* Main Sections */}
        <View className="px-6">
          {loading ? (
             <View className="py-20"><ActivityIndicator color="#6366f1" /></View>
          ) : activeSection === 'radar' ? (
            <RadarSection data={data} activeWidgets={activeWidgets} onEditWidgets={() => setShowWidgetModal(true)} />
          ) : activeSection === 'targets' ? (
            <TargetsSection targets={targets} onUpdate={handleUpdateTarget} onNew={() => setShowTargetModal(true)} />
          ) : (
            <ArchivesSection reports={reports} onDownload={handleDownloadReport} onNew={() => setShowReportModal(true)} />
          )}
        </View>
        <View className="h-20" />
      </ScrollView>

      {/* Global Config Modal */}
      <ReportConfigModal
        visible={showReportModal}
        onClose={() => setShowReportModal(false)}
        onConfirm={handleExportPDF}
        pipelines={pipelines}
        teams={teams}
        users={users}
        initialDays={days}
      />

      {/* Target Creation Modal */}
      <TargetCreationModal
        visible={showTargetModal}
        onClose={() => setShowTargetModal(false)}
        onConfirm={handleCreateTarget}
        pipelines={pipelines}
        stages={allStages}
      />

      {/* Widget Configuration Modal */}
      <WidgetConfigModal
        visible={showWidgetModal}
        onClose={() => setShowWidgetModal(false)}
        onSave={handleSaveWidgets}
        currentWidgets={activeWidgets}
      />
    </View>
  );
}

const TargetCreationModal = ({ visible, onClose, onConfirm, pipelines, stages }: any) => {
  const [type, setType] = useState('performance');
  const [p, setP] = useState(null);
  const [s, setS] = useState(null);
  const [activeGoal, setActiveGoal] = useState('3600');
  const [lifeGoal, setLifeGoal] = useState('86400');
  const [quantity, setQuantity] = useState('50');
  const [deadline, setDeadline] = useState('7'); // Days from now

  const filteredStages = stages.filter((st: any) => st.pipeline_id === p);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 bg-black/70 items-center justify-center px-6">
        <View className="bg-surface-card w-full max-h-[90%] rounded-[32px] border border-surface-border overflow-hidden">
          <View className="p-8 pb-4">
             <Text className="text-typography-main text-2xl font-black mb-1">Define Objective</Text>
             <Text className="text-typography-muted text-xs">Set performance or volume benchmarks</Text>
          </View>

          <ScrollView className="px-8" showsVerticalScrollIndicator={false}>
            {/* Type Switcher */}
            <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-widest mt-4 mb-3">Objective Type</Text>
            <View className="flex-row bg-surface-background p-1 rounded-xl mb-4">
               {['performance', 'volume'].map(t => (
                 <TouchableOpacity key={t} onPress={() => setType(t)} className={`flex-1 py-2 rounded-lg items-center ${type === t ? 'bg-brand-primary' : ''}`}>
                   <Text className={`font-bold text-[10px] uppercase ${type === t ? 'text-white' : 'text-typography-muted'}`}>{t}</Text>
                 </TouchableOpacity>
               ))}
            </View>

            <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-widest mt-2 mb-3">Target Pipeline</Text>
            <Picker items={pipelines} selectedId={p} onSelect={(id: string) => { setP(id); setS(null); }} />

            {p && (
              <>
                <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-widest mt-6 mb-3">Target Stage</Text>
                <Picker items={filteredStages} selectedId={s} onSelect={setS} />
              </>
            )}

            <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-widest mt-6 mb-3">
              {type === 'performance' ? 'Performance Rules' : 'Volume Rules'}
            </Text>

            {type === 'performance' ? (
              <View className="flex-row gap-4 mb-6">
                <View className="flex-1">
                  <Text className="text-typography-muted text-[10px] font-bold mb-2">Target Active (sec)</Text>
                  <TextInput value={activeGoal} onChangeText={setActiveGoal} keyboardType="numeric" className="bg-surface-background border border-surface-border text-typography-main p-4 rounded-xl font-bold" />
                </View>
                <View className="flex-1">
                  <Text className="text-typography-muted text-[10px] font-bold mb-2">Max Life (sec)</Text>
                  <TextInput value={lifeGoal} onChangeText={setLifeGoal} keyboardType="numeric" className="bg-surface-background border border-surface-border text-typography-main p-4 rounded-xl font-bold" />
                </View>
              </View>
            ) : (
              <View className="flex-row gap-4 mb-6">
                <View className="flex-1">
                  <Text className="text-typography-muted text-[10px] font-bold mb-2">Target Quota (Tasks)</Text>
                  <TextInput value={quantity} onChangeText={setQuantity} keyboardType="numeric" className="bg-surface-background border border-surface-border text-typography-main p-4 rounded-xl font-bold" />
                </View>
                <View className="flex-1">
                  <Text className="text-typography-muted text-[10px] font-bold mb-2">In (Days)</Text>
                  <TextInput value={deadline} onChangeText={setDeadline} keyboardType="numeric" className="bg-surface-background border border-surface-border text-typography-main p-4 rounded-xl font-bold" />
                </View>
              </View>
            )}
            
            <View className="h-10" />
          </ScrollView>

          <View className="p-8 pt-4 flex-row gap-3 border-t border-surface-border bg-surface-card">
             <TouchableOpacity onPress={onClose} className="flex-1 py-4 rounded-2xl bg-surface-background border border-surface-border items-center">
                <Text className="text-typography-muted font-bold">Cancel</Text>
             </TouchableOpacity>
             <TouchableOpacity 
               disabled={!s}
               onPress={() => { 
                 const dDate = new Date();
                 dDate.setDate(dDate.getDate() + parseInt(deadline));
                 onConfirm({ 
                   stage_id: s, 
                   target_type: type,
                   active: type === 'performance' ? parseInt(activeGoal) : null,
                   lifecycle: type === 'performance' ? parseInt(lifeGoal) : null,
                   quantity: type === 'volume' ? parseInt(quantity) : null,
                   deadline: type === 'volume' ? dDate.toISOString() : null
                 }); 
                 onClose(); 
               }} 
               className={`flex-1 py-4 rounded-2xl items-center shadow-lg ${s ? 'bg-brand-primary shadow-brand-primary/30' : 'bg-surface-border'}`}
             >
                <Text className="text-white font-bold">Establish Objective</Text>
             </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const ReportConfigModal = ({ visible, onClose, onConfirm, pipelines, teams, users, initialDays }: any) => {
  const [d, setD] = useState(initialDays);
  const [p, setP] = useState(null);
  const [t, setT] = useState(null);
  const [u, setU] = useState(null);
  const [type, setType] = useState('performance_audit');

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 bg-black/70 items-center justify-center px-6">
        <View className="bg-surface-card w-full max-h-[85%] rounded-[32px] border border-surface-border overflow-hidden">
          <View className="p-8 pb-4">
             <Text className="text-typography-main text-2xl font-black mb-1">Audit Configuration</Text>
             <Text className="text-typography-muted text-xs">Define intelligence boundaries</Text>
          </View>

          <ScrollView className="px-8" showsVerticalScrollIndicator={false}>
            <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-widest mt-4 mb-3">Timeframe</Text>
            <View className="flex-row gap-2">
               {[7, 30, 90].map(val => (
                 <TouchableOpacity key={val} onPress={() => setD(val)} className={`flex-1 py-3 rounded-xl border ${d === val ? 'bg-brand-primary border-brand-primary' : 'border-surface-border'}`}>
                   <Text className={`text-center font-bold text-xs ${d === val ? 'text-white' : 'text-typography-muted'}`}>{val} Days</Text>
                 </TouchableOpacity>
               ))}
            </View>

            <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-widest mt-6 mb-3">Target Pipeline</Text>
            <Picker 
              items={[{id: null, name: 'Organization Wide'}, ...pipelines]} 
              selectedId={p} 
              onSelect={setP} 
            />

            <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-widest mt-6 mb-3">Filtered Team</Text>
            <Picker 
              items={[{id: null, name: 'All Teams'}, ...teams]} 
              selectedId={t} 
              onSelect={setT} 
            />

            <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-widest mt-6 mb-3">Individual Scope</Text>
            <Picker 
              items={[{id: null, name: 'Everyone'}, ...users]} 
              selectedId={u} 
              onSelect={setU} 
              labelKey="full_name"
            />
            
            <View className="h-10" />
          </ScrollView>

          <View className="p-8 pt-4 flex-row gap-3 border-t border-surface-border bg-surface-card">
             <TouchableOpacity onPress={onClose} className="flex-1 py-4 rounded-2xl bg-surface-background border border-surface-border items-center">
                <Text className="text-typography-muted font-bold">Cancel</Text>
             </TouchableOpacity>
             <TouchableOpacity 
               onPress={() => { onConfirm({ days: d, pipeline_id: p, team_id: t, user_id: u, type }); onClose(); }} 
               className="flex-1 py-4 rounded-2xl bg-brand-primary items-center shadow-lg shadow-brand-primary/30"
             >
                <Text className="text-white font-bold">Generate</Text>
             </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const Picker = ({ items, selectedId, onSelect, labelKey = 'name' }: any) => (
  <View className="flex-row flex-wrap gap-2">
    {items.map((item: any) => (
      <TouchableOpacity 
        key={item.id} 
        onPress={() => onSelect(item.id)} 
        className={`px-4 py-2 rounded-xl border ${selectedId === item.id ? 'bg-surface-background border-brand-primary' : 'border-surface-border'}`}
      >
        <View className="flex-row items-center">
           {selectedId === item.id && <View className="w-1.5 h-1.5 rounded-full bg-brand-primary mr-2" />}
           <Text className={`text-[11px] font-medium ${selectedId === item.id ? 'text-brand-primary font-bold' : 'text-typography-muted'}`}>
             {item[labelKey] || 'N/A'}
           </Text>
        </View>
      </TouchableOpacity>
    ))}
  </View>
);

const RadarSection = ({ data, activeWidgets, onEditWidgets }: any) => {
  if (!data) return <View className="py-20"><ActivityIndicator color="#6366f1" /></View>;
  const curThr = data.current?.throughput || 0;
  const prevThr = data.comparison?.throughput || 0;
  const adv = data.radar_advanced || {};
  const curr = data.current || {};
  
  const renderWidget = (key: string, idx: number) => {
    switch (key) {
      case 'throughput': return <KPIBox key={idx} label="Throughput" val={curThr} delta={curThr - prevThr} />;
      case 'efficiency': return <KPIBox key={idx} label="Efficiency" val={`${Math.round(curr.success_rate || 0)}%`} delta={undefined} />;
      case 'flow_ratio': return <KPIBox key={idx} label="Flow Ratio" val={adv.flow_ratio || 'N/A'} delta={undefined} />;
      case 'first_pass_yield': return <KPIBox key={idx} label="First-Pass Yield" val={`${adv.first_pass_yield || 0}%`} delta={undefined} />;
      case 'automation_offload': return <KPIBox key={idx} label="Cyborg Score" val={`${adv.automation_offload_rate || 0}%`} delta={undefined} />;
      default: return null;
    }
  };

  return (
    <View>
      <View className="flex-row justify-between items-end mb-4">
        <Text className="text-typography-main font-bold text-lg">Active Telemetry</Text>
        <TouchableOpacity onPress={onEditWidgets}>
          <Text className="text-brand-primary text-[10px] font-bold uppercase tracking-wider">Customize</Text>
        </TouchableOpacity>
      </View>
      
      <View className="flex-row flex-wrap justify-between mb-6">
        {activeWidgets.map((w: string, i: number) => renderWidget(w, i))}
      </View>

      <SLARiskAlert data={data} />

      <Text className="text-typography-main font-bold text-lg mb-4">Pipeline Load Distribution</Text>
      <View className="bg-surface-card p-6 rounded-3xl border border-surface-border mb-6">
        {data.funnel?.map((f: any, i: number) => (
          <View key={i} className="mb-4">
            <View className="flex-row justify-between mb-2">
              <Text className="text-typography-muted text-xs font-medium">{f.stage_name}</Text>
              <Text className="text-typography-main text-xs font-bold">{f.task_count}</Text>
            </View>
            <View className="h-2 bg-surface-background rounded-full overflow-hidden">
               <View className="h-full bg-brand-primary" style={{ width: `${Math.min((f.task_count / (curThr || 10)) * 100, 100)}%` }} />
            </View>
          </View>
        ))}
      </View>
      <StageDurationChart data={data} />
      <ConversionFunnelChart data={data} />
      <WorkDistributionChart data={data} />
      <QualityLeaderboard data={data} />
      <TrendComparisonCards data={data} />
    </View>
  );
};

const TargetsSection = ({ targets, onUpdate, onNew }: any) => (
  <View>
    <TouchableOpacity onPress={onNew} className="bg-surface-card p-6 rounded-3xl border border-dashed border-brand-primary/40 mb-6 items-center flex-row justify-center">
       <FontAwesome name="plus-circle" size={16} color="#6366f1" className="mr-3" />
       <Text className="text-brand-primary font-bold text-sm">Initiate Benchmark Objective</Text>
    </TouchableOpacity>
    {targets.map((t: any, i: number) => (
      <View key={i} className="bg-surface-card p-5 rounded-2xl border border-surface-border mb-4">
        <View className="flex-row justify-between mb-4">
          <View>
            <Text className="text-typography-main font-bold text-base">{t.stage?.name}</Text>
            <Text className="text-typography-muted text-[10px] uppercase tracking-widest">
              {t.target_type === 'volume' ? 'Volume Tracking Quota' : 'SLA Performance Goal'}
            </Text>
          </View>
          <TouchableOpacity onPress={() => Alert.prompt('Active Goal', 'Update target value:', v => onUpdate(t.id, t.target_type === 'volume' ? 'target_quantity' : 'target_active_seconds', v))} className="bg-surface-background p-2 rounded-lg">
            <FontAwesome name="edit" size={12} color="#64748b" />
          </TouchableOpacity>
        </View>

        {t.target_type === 'volume' ? (
          <View>
             <View className="flex-row justify-between mb-2">
                <Text className="text-typography-muted text-[10px] font-bold uppercase">Progress: {t.current_count || 0} / {t.target_quantity}</Text>
                <Text className="text-typography-muted text-[10px] font-bold uppercase">Deadline: {t.target_deadline ? new Date(t.target_deadline).toLocaleDateString() : 'None'}</Text>
             </View>
             <View className="h-1.5 bg-surface-background rounded-full overflow-hidden">
                <View className="h-full bg-brand-primary" style={{ width: `${Math.min(((t.current_count || 0) / (t.target_quantity || 1)) * 100, 100)}%` }} />
             </View>
          </View>
        ) : (
          <View className="flex-row gap-8">
            <View><Text className="text-typography-muted text-xs mb-1">Target</Text><Text className="text-brand-primary font-bold">{Math.round((t.target_active_seconds || 0)/60)}m</Text></View>
            <View><Text className="text-typography-muted text-xs mb-1">Max Life</Text><Text className="text-typography-main font-bold">{Math.round((t.target_lifecycle_seconds || 0)/3600)}h</Text></View>
          </View>
        )}
      </View>
    ))}
  </View>
);

const ArchivesSection = ({ reports, onDownload, onNew }: any) => (
  <View>
    <TouchableOpacity onPress={onNew} className="bg-surface-card p-6 rounded-3xl border border-dashed border-brand-primary/40 mb-6 items-center flex-row justify-center">
       <FontAwesome name="plus-circle" size={16} color="#6366f1" className="mr-3" />
       <Text className="text-brand-primary font-bold text-sm">Initiate New Audit Sequence</Text>
    </TouchableOpacity>
    {reports.map((r: any, i: number) => (
       <TouchableOpacity key={i} onPress={() => r.file_url && onDownload(r.file_url)} className="bg-surface-card p-5 rounded-2xl border border-surface-border mb-4 flex-row items-center">
         <View className={`w-12 h-12 rounded-xl items-center justify-center mr-4 ${r.status === 'completed' ? 'bg-state-success/10' : 'bg-state-info/10'}`}>
            <FontAwesome name="file-text-o" size={18} color={r.status === 'completed' ? '#10b981' : '#6366f1'} />
         </View>
         <View className="flex-1">
            <Text className="text-typography-main font-bold">Report #{r.id.substring(0, 6)}</Text>
            <Text className="text-typography-muted text-xs">{new Date(r.created_at).toLocaleDateString()} • {r.status}</Text>
         </View>
         <FontAwesome name="chevron-right" size={12} color="#94a3b8" />
       </TouchableOpacity>
    ))}
  </View>
);

const KPIBox = ({ label, val, delta }: any) => (
  <View className="w-[48%] bg-surface-card p-5 rounded-3xl border border-surface-border mb-4">
     <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-wider mb-2">{label}</Text>
     <View className="flex-row items-baseline">
       <Text className="text-typography-main text-2xl font-black">{val}</Text>
       {delta !== undefined && (
         <View className={`ml-2 px-1.5 py-0.5 rounded-md ${delta >= 0 ? 'bg-state-success/10' : 'bg-state-danger/10'}`}>
           <Text className={`text-[9px] font-black ${delta >= 0 ? 'text-state-success' : 'text-state-danger'}`}>
             {delta >= 0 ? '+' : ''}{delta}
           </Text>
         </View>
       )}
     </View>
  </View>
);

const StageDurationChart = ({ data }: any) => {
  if (!data?.stage_duration_analysis) return null;
  return (
    <View className="bg-surface-card p-6 rounded-3xl border border-surface-border mb-6">
      <Text className="text-typography-main font-bold text-lg mb-4">Stage Duration Analysis</Text>
      {data.stage_duration_analysis.map((stage: any, idx: number) => {
        const maxDays = Math.max(...data.stage_duration_analysis.map((s: any) => s.avg_duration_days));
        const percentage = (stage.avg_duration_days / maxDays) * 100;
        const isSlow = stage.avg_duration_days > 2.5;
        return (
          <View key={idx} className="mb-4">
            <View className="flex-row justify-between mb-2">
              <Text className="text-typography-muted text-xs font-medium">{stage.stage_name}</Text>
              <Text className={`text-xs font-bold ${isSlow ? 'text-state-danger' : 'text-brand-primary'}`}>{stage.avg_duration_days.toFixed(1)} days</Text>
            </View>
            <View className="h-2 bg-surface-background rounded-full overflow-hidden">
              <View className={`h-full ${isSlow ? 'bg-state-danger' : 'bg-brand-primary'}`} style={{ width: `${percentage}%` }} />
            </View>
          </View>
        );
      })}
    </View>
  );
};

const ConversionFunnelChart = ({ data }: any) => {
  if (!data?.conversion_by_stage) return null;
  const conversions = data.conversion_by_stage;
  return (
    <View className="bg-surface-card p-6 rounded-3xl border border-surface-border mb-6">
      <Text className="text-typography-main font-bold text-lg mb-4">Stage Conversion Rates</Text>
      {conversions.map((stage: any, idx: number) => {
        const rate = (stage.completion_rate || 0) * 100;
        const isGood = rate >= 85;
        return (
          <View key={idx} className="mb-5">
            <View className="flex-row justify-between mb-2">
              <Text className="text-typography-muted text-xs font-medium">{stage.stage_name}</Text>
              <View className="flex-row gap-2">
                <Text className={`text-xs font-bold ${isGood ? 'text-state-success' : 'text-state-warning'}`}>{rate.toFixed(0)}%</Text>
                <Text className="text-typography-muted text-[10px]">({stage.task_count} tasks)</Text>
              </View>
            </View>
            <View className="h-3 bg-surface-background rounded-full overflow-hidden border border-surface-border">
              <View className={`h-full ${isGood ? 'bg-state-success' : 'bg-state-warning'}`} style={{ width: `${Math.min(rate, 100)}%` }} />
            </View>
            {idx < conversions.length - 1 && (
              <View className="items-center mt-2 mb-2">
                <FontAwesome name="arrow-down" size={12} color="#64748b" />
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
};

const WorkDistributionChart = ({ data }: any) => {
  if (!data?.worker_engagement) return null;
  const workers = data.worker_engagement.sort((a: any, b: any) => b.action_count - a.action_count).slice(0, 6);
  const maxCount = Math.max(...workers.map((w: any) => w.action_count));
  return (
    <View className="bg-surface-card p-6 rounded-3xl border border-surface-border mb-6">
      <Text className="text-typography-main font-bold text-lg mb-4">Team Workload Distribution</Text>
      {workers.map((worker: any, idx: number) => {
        const percentage = (worker.action_count / maxCount) * 100;
        const overloaded = percentage > 75;
        return (
          <View key={idx} className="mb-4">
            <View className="flex-row justify-between mb-2">
              <Text className="text-typography-muted text-xs font-medium">{worker.full_name || 'Anonymous'}</Text>
              <View className="flex-row items-center gap-2">
                <Text className={`text-xs font-bold ${overloaded ? 'text-state-danger' : 'text-brand-primary'}`}>{worker.action_count}</Text>
                <Text className="text-typography-muted text-[10px]">{((worker.action_count / workers.reduce((a: any, b: any) => a + b.action_count, 0)) * 100).toFixed(0)}%</Text>
              </View>
            </View>
            <View className="h-2 bg-surface-background rounded-full overflow-hidden">
              <View className={`h-full ${overloaded ? 'bg-state-danger' : 'bg-brand-primary'}`} style={{ width: `${percentage}%` }} />
            </View>
          </View>
        );
      })}
    </View>
  );
};

const QualityLeaderboard = ({ data }: any) => {
  if (!data?.quality_by_worker) return null;
  const workers = data.quality_by_worker.sort((a: any, b: any) => a.revision_rate - b.revision_rate).slice(0, 8);
  const getStarRating = (revisionRate: number) => {
    if (revisionRate <= 5) return 5;
    if (revisionRate <= 10) return 4;
    if (revisionRate <= 15) return 3;
    if (revisionRate <= 20) return 2;
    return 1;
  };
  return (
    <View className="bg-surface-card p-6 rounded-3xl border border-surface-border mb-6">
      <Text className="text-typography-main font-bold text-lg mb-4">Quality Scores (Lower Revision Rate = Better)</Text>
      {workers.map((worker: any, idx: number) => {
        const stars = getStarRating(worker.revision_rate || 0);
        return (
          <View key={idx} className="mb-4 pb-4 border-b border-surface-border last:border-0 last:mb-0">
            <View className="flex-row justify-between items-center mb-2">
              <Text className="text-typography-main text-sm font-bold flex-1">{worker.full_name || 'Anonymous'}</Text>
              <View className="flex-row gap-1">
                {[1, 2, 3, 4, 5].map((s) => (
                  <FontAwesome key={s} name={s <= stars ? 'star' : 'star-o'} size={12} color={s <= stars ? '#fbbf24' : '#cbd5e1'} />
                ))}
              </View>
            </View>
            <View className="flex-row justify-between">
              <Text className="text-typography-muted text-[10px]">{(worker.revision_rate || 0).toFixed(1)}% revision rate</Text>
              <Text className="text-typography-muted text-[10px]">{worker.total_tasks} tasks</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
};

const TrendComparisonCards = ({ data }: any) => {
  if (!data?.current || !data?.comparison) return null;
  const current = data.current;
  const prev = data.comparison;
  const getTrendIcon = (current: number, previous: number, higherBetter = true) => {
    const change = current - previous;
    if (change === 0) return '→';
    if (higherBetter) return change > 0 ? '↗️' : '↘️';
    return change < 0 ? '↗️' : '↘️';
  };
  return (
    <View className="mb-6">
      <Text className="text-typography-main font-bold text-lg mb-3">Performance Comparison</Text>
      <View className="flex-row flex-wrap justify-between gap-3">
        <View className="w-[48%] bg-surface-card p-4 rounded-2xl border border-surface-border">
          <Text className="text-typography-muted text-[10px] font-bold uppercase mb-2">Throughput</Text>
          <View className="flex-row items-baseline gap-2">
            <Text className="text-typography-main text-xl font-black">{current.throughput || 0}</Text>
            <Text className="text-xs text-brand-primary font-bold">{getTrendIcon(current.throughput || 0, prev.throughput || 0)} {Math.abs((current.throughput || 0) - (prev.throughput || 0))}</Text>
          </View>
        </View>
        <View className="w-[48%] bg-surface-card p-4 rounded-2xl border border-surface-border">
          <Text className="text-typography-muted text-[10px] font-bold uppercase mb-2">Success Rate</Text>
          <View className="flex-row items-baseline gap-2">
            <Text className="text-typography-main text-xl font-black">{(current.success_rate || 0).toFixed(0)}%</Text>
            <Text className="text-xs text-state-success font-bold">{getTrendIcon(current.success_rate || 0, prev.success_rate || 0)}{Math.abs((current.success_rate || 0) - (prev.success_rate || 0)).toFixed(1)}%</Text>
          </View>
        </View>
        <View className="w-[48%] bg-surface-card p-4 rounded-2xl border border-surface-border">
          <Text className="text-typography-muted text-[10px] font-bold uppercase mb-2">Lead Time</Text>
          <View className="flex-row items-baseline gap-2">
            <Text className="text-typography-main text-xl font-black">{Math.round(current.avg_lead_time_minutes || 0)}m</Text>
            <Text className="text-xs text-state-success font-bold">{getTrendIcon(current.avg_lead_time_minutes || 0, prev.avg_lead_time_minutes || 0, false)}{Math.abs((current.avg_lead_time_minutes || 0) - (prev.avg_lead_time_minutes || 0)).toFixed(0)}m</Text>
          </View>
        </View>
        <View className="w-[48%] bg-surface-card p-4 rounded-2xl border border-surface-border">
          <Text className="text-typography-muted text-[10px] font-bold uppercase mb-2">Quality (Revision Rate)</Text>
          <View className="flex-row items-baseline gap-2">
            <Text className="text-typography-main text-xl font-black">{(current.revision_rate || 0).toFixed(1)}%</Text>
            <Text className="text-xs text-state-success font-bold">{getTrendIcon(current.revision_rate || 0, prev.revision_rate || 0, false)}{Math.abs((current.revision_rate || 0) - (prev.revision_rate || 0)).toFixed(1)}%</Text>
          </View>
        </View>
      </View>
    </View>
  );
};

const SLARiskAlert = ({ data }: any) => {
  if (!data?.sla_risks || data.sla_risks.length === 0) return null;
  const risks = data.sla_risks.slice(0, 3); // show top 3
  
  return (
    <View className="mb-6 bg-state-danger/5 border border-state-danger/30 p-5 rounded-3xl">
      <View className="flex-row items-center mb-3">
        <FontAwesome name="warning" size={14} color="#ef4444" className="mr-2" />
        <Text className="text-state-danger font-bold text-sm">SLA Risk Detected ({data.sla_risks.length})</Text>
      </View>
      {risks.map((r: any, i: number) => (
        <View key={i} className="flex-row justify-between items-center mb-2 last:mb-0">
           <Text className="text-typography-main font-bold text-xs">{r.task_number || 'TASK'}</Text>
           <View className="flex-row items-center gap-3">
             <Text className="text-typography-muted text-[10px]">{r.stage_name}</Text>
             <View className="bg-state-danger/10 px-2 py-1 rounded">
               <Text className="text-state-danger text-[10px] font-black">{r.risk_percent}%</Text>
             </View>
           </View>
        </View>
      ))}
    </View>
  );
};

const WidgetConfigModal = ({ visible, onClose, onSave, currentWidgets }: any) => {
  const [selected, setSelected] = useState<string[]>(currentWidgets || []);
  
  // Update state if modal is opened with new props
  useEffect(() => {
    if (visible) setSelected(currentWidgets || []);
  }, [visible, currentWidgets]);

  const library = [
    { id: 'throughput', name: 'Throughput', desc: 'Total tasks completed in timeframe' },
    { id: 'efficiency', name: 'Efficiency', desc: 'General success rate' },
    { id: 'flow_ratio', name: 'Flow Ratio', desc: 'Backlog shrinkage (>1) or growth (<1)' },
    { id: 'first_pass_yield', name: 'First-Pass Yield', desc: '% reaching end without revisions' },
    { id: 'automation_offload', name: 'Cyborg Score', desc: '% of work handled by automation' }
  ];

  const toggleWidget = (id: string) => {
    if (selected.includes(id)) {
      setSelected(selected.filter(w => w !== id));
    } else {
      // Max 6 widgets
      if (selected.length >= 6) return;
      setSelected([...selected, id]);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 bg-black/70 items-center justify-center px-6">
        <View className="bg-surface-card w-full max-h-[85%] rounded-[32px] border border-surface-border overflow-hidden">
          <View className="p-8 pb-4">
             <Text className="text-typography-main text-2xl font-black mb-1">Radar Configuration</Text>
             <Text className="text-typography-muted text-xs">Select up to 6 metrics to display.</Text>
          </View>

          <ScrollView className="px-8" showsVerticalScrollIndicator={false}>
            {library.map(widget => {
              const isActive = selected.includes(widget.id);
              return (
                <TouchableOpacity 
                  key={widget.id} 
                  onPress={() => toggleWidget(widget.id)}
                  className={`p-4 rounded-xl border mb-3 flex-row items-center justify-between ${isActive ? 'bg-brand-primary/10 border-brand-primary' : 'bg-surface-background border-surface-border'}`}
                >
                  <View>
                    <Text className={`font-bold ${isActive ? 'text-brand-primary' : 'text-typography-main'}`}>{widget.name}</Text>
                    <Text className="text-typography-muted text-[10px] mt-1">{widget.desc}</Text>
                  </View>
                  <View className={`w-5 h-5 rounded-full border items-center justify-center ${isActive ? 'border-brand-primary bg-brand-primary' : 'border-surface-border'}`}>
                    {isActive && <FontAwesome name="check" size={10} color="#ffffff" />}
                  </View>
                </TouchableOpacity>
              );
            })}
            
            <View className="h-10" />
          </ScrollView>

          <View className="p-8 pt-4 flex-row gap-3 border-t border-surface-border bg-surface-card">
             <TouchableOpacity onPress={onClose} className="flex-1 py-4 rounded-2xl bg-surface-background border border-surface-border items-center">
                <Text className="text-typography-muted font-bold">Cancel</Text>
             </TouchableOpacity>
             <TouchableOpacity 
               disabled={selected.length === 0}
               onPress={() => onSave(selected)} 
               className={`flex-1 py-4 rounded-2xl items-center shadow-lg ${selected.length > 0 ? 'bg-brand-primary shadow-brand-primary/30' : 'bg-surface-border'}`}
             >
                <Text className="text-white font-bold">Save Dashboard</Text>
             </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};
