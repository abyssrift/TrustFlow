import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { supabase } from '@/lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Stack } from 'expo-router';

type AuditData = {
  funnel: Array<{ stage_name: string; task_count: number }>;
  quality: { total_revisions: number; total_progress: number };
  velocity: { avg_lead_time_minutes: number };
};

export default function ComparisonScreenWeb() {
  const [targetA, setTargetA] = useState<{ id: string; name: string; type: 'user' | 'pipeline' | 'team' } | null>(null);
  const [targetB, setTargetB] = useState<{ id: string; name: string; type: 'user' | 'pipeline' | 'team' } | null>(null);
  
  const [dataA, setDataA] = useState<AuditData | null>(null);
  const [dataB, setDataB] = useState<AuditData | null>(null);
  const [loading, setLoading] = useState(false);

  const [availableUsers, setAvailableUsers] = useState<any[]>([]);
  const [availablePipelines, setAvailablePipelines] = useState<any[]>([]);
  const [availableTeams, setAvailableTeams] = useState<any[]>([]);

  useEffect(() => {
    const loadOptions = async () => {
      const { data: users } = await supabase.from('users').select('id, full_name').is('deleted_at', null).order('full_name');
      const { data: pipes } = await supabase.from('pipelines').select('id, name').is('deleted_at', null).order('name');
      const { data: teams } = await supabase.from('teams').select('id, name').is('deleted_at', null).order('name');
      setAvailableUsers(users || []);
      setAvailablePipelines(pipes || []);
      setAvailableTeams(teams || []);
    };
    loadOptions();
  }, []);

  const fetchData = async (target: any, setter: any) => {
    if (!target) return;
    const { data: result } = await supabase.rpc('rpc_get_organizational_audit', {
      p_pipeline_id: target.type === 'pipeline' ? target.id : null,
      p_user_id: target.type === 'user' ? target.id : null,
      p_team_id: target.type === 'team' ? target.id : null
    });
    setter(result);
  };

  const handleRunComparison = async () => {
    if (!targetA || !targetB) return;
    setLoading(true);
    await Promise.all([
      fetchData(targetA, setDataA),
      fetchData(targetB, setDataB)
    ]);
    setLoading(false);
  };

  const renderMetricRow = (label: string, valA: any, valB: any, unit: string = '') => {
    const isHigherBetter = label !== 'Avg Lead Time';
    const numA = parseFloat(valA) || 0;
    const numB = parseFloat(valB) || 0;
    const winner = isHigherBetter ? (numA > numB ? 'A' : 'B') : (numA < numB ? 'A' : 'B');

    return (
      <View className="mb-8">
        <Text className="text-typography-muted text-xs font-black uppercase text-center mb-4 tracking-widest">{label}</Text>
        <View className="flex-row items-center justify-between gap-12">
           <View className={`flex-1 p-8 rounded-[32px] border transition-all duration-500 ${winner === 'A' ? 'bg-brand-primary/10 border-brand-primary premium-shadow' : 'bg-surface-card border-surface-border opacity-60'}`}>
              <Text className={`text-5xl font-black text-center ${winner === 'A' ? 'text-brand-primary' : 'text-typography-main'}`}>
                 {valA}<Text className="text-xl font-bold opacity-40">{unit}</Text>
              </Text>
           </View>
           
           <View className="w-12 h-12 items-center justify-center rounded-full bg-surface-card border border-surface-border">
              <FontAwesome name="exchange" size={16} color="rgb(var(--brand-primary))" />
           </View>

           <View className={`flex-1 p-8 rounded-[32px] border transition-all duration-500 ${winner === 'B' ? 'bg-brand-primary/10 border-brand-primary premium-shadow' : 'bg-surface-card border-surface-border opacity-60'}`}>
              <Text className={`text-5xl font-black text-center ${winner === 'B' ? 'text-brand-primary' : 'text-typography-main'}`}>
                 {valB}<Text className="text-xl font-bold opacity-40">{unit}</Text>
              </Text>
           </View>
        </View>
      </View>
    );
  };

  return (
    <View className="flex-1 bg-surface-background">
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        <View className="p-12 max-w-[1400px] mx-auto w-full">
          
          <View className="flex-row justify-between items-end mb-12">
            <View>
              <View className="flex-row items-center mb-2">
                <View className="h-2 w-12 bg-brand-primary rounded-full mr-4" />
                <Text className="text-brand-primary font-black uppercase tracking-[0.3em] text-xs">Strategic Benchmarking</Text>
              </View>
              <Text className="text-typography-main text-6xl font-black tracking-tighter">Matrix Comparison</Text>
              <Text className="text-typography-muted text-lg font-medium mt-2">Deep-dive performance delta between organizational assets.</Text>
            </View>

            <TouchableOpacity 
              onPress={handleRunComparison}
              disabled={!targetA || !targetB || loading}
              className={`px-10 py-5 rounded-2xl flex-row items-center transition-all ${(!targetA || !targetB) ? 'bg-surface-border opacity-50' : 'bg-brand-primary shadow-2xl shadow-brand-primary/30 active:scale-95'}`}
            >
               <FontAwesome name="bolt" size={16} color="white" className="mr-3" />
               <Text className="text-white font-black uppercase tracking-widest text-sm">Execute Audit</Text>
            </TouchableOpacity>
          </View>

          {/* Selection Matrix */}
          <View className="flex-row gap-8 mb-16">
             {/* Subject A */}
             <View className={`flex-1 bg-surface-card p-8 rounded-[40px] border ${targetA ? 'border-brand-primary/30' : 'border-surface-border'} relative overflow-hidden`}>
                <View className="absolute top-0 right-0 p-6 opacity-5">
                   <FontAwesome name="user" size={120} color="white" />
                </View>
                <Text className="text-typography-muted text-xs font-black uppercase mb-6 tracking-widest">Primary Subject (Alpha)</Text>
                
                <View className="h-[300px]">
                  <ScrollView showsVerticalScrollIndicator={false}>
                    <SelectorGroup title="Strategic Units" data={availableTeams} type="team" selected={targetA} onSelect={setTargetA} />
                    <SelectorGroup title="Deployment Personnel" data={availableUsers} type="user" selected={targetA} onSelect={setTargetA} labelKey="full_name" />
                    <SelectorGroup title="Tactical Pipelines" data={availablePipelines} type="pipeline" selected={targetA} onSelect={setTargetA} />
                  </ScrollView>
                </View>

                {targetA && (
                  <View className="mt-6 p-4 bg-brand-primary/10 rounded-2xl border border-brand-primary/20 flex-row items-center">
                    <View className="h-10 w-10 rounded-full bg-brand-primary items-center justify-center mr-4">
                      <FontAwesome name="check" size={14} color="white" />
                    </View>
                    <View>
                      <Text className="text-typography-main font-black">{targetA.name}</Text>
                      <Text className="text-brand-primary text-[10px] font-bold uppercase">{targetA.type}</Text>
                    </View>
                  </View>
                )}
             </View>

             {/* Center VS Divider */}
             <View className="justify-center items-center">
                <View className="h-full w-px bg-surface-border relative">
                  <View className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-surface-background p-4 border border-surface-border rounded-full">
                    <Text className="text-typography-muted font-black text-sm italic">VS</Text>
                  </View>
                </View>
             </View>

             {/* Subject B */}
             <View className={`flex-1 bg-surface-card p-8 rounded-[40px] border ${targetB ? 'border-brand-primary/30' : 'border-surface-border'} relative overflow-hidden`}>
                <View className="absolute top-0 right-0 p-6 opacity-5">
                   <FontAwesome name="users" size={120} color="white" />
                </View>
                <Text className="text-typography-muted text-xs font-black uppercase mb-6 tracking-widest">Secondary Subject (Beta)</Text>
                
                <View className="h-[300px]">
                  <ScrollView showsVerticalScrollIndicator={false}>
                    <SelectorGroup title="Strategic Units" data={availableTeams} type="team" selected={targetB} onSelect={setTargetB} />
                    <SelectorGroup title="Deployment Personnel" data={availableUsers} type="user" selected={targetB} onSelect={setTargetB} labelKey="full_name" />
                    <SelectorGroup title="Tactical Pipelines" data={availablePipelines} type="pipeline" selected={targetB} onSelect={setTargetB} />
                  </ScrollView>
                </View>

                {targetB && (
                  <View className="mt-6 p-4 bg-brand-primary/10 rounded-2xl border border-brand-primary/20 flex-row items-center">
                    <View className="h-10 w-10 rounded-full bg-brand-primary items-center justify-center mr-4">
                      <FontAwesome name="check" size={14} color="white" />
                    </View>
                    <View>
                      <Text className="text-typography-main font-black">{targetB.name}</Text>
                      <Text className="text-brand-primary text-[10px] font-bold uppercase">{targetB.type}</Text>
                    </View>
                  </View>
                )}
             </View>
          </View>

          {/* Results Area */}
          {loading ? (
            <View className="items-center justify-center py-20">
               <ActivityIndicator size="large" color="rgb(var(--brand-primary))" />
               <Text className="text-typography-muted mt-6 font-black uppercase tracking-widest text-xs">Computing Comparison Delta...</Text>
            </View>
          ) : dataA && dataB ? (
            <View className="bg-surface-card/30 p-12 rounded-[60px] border border-surface-border">
              <View className="flex-row justify-between mb-16 items-center px-8">
                 <View className="flex-1 items-center">
                    <Text className="text-brand-primary font-black text-2xl uppercase tracking-widest text-center mb-2">{targetA?.name}</Text>
                    <View className="h-1 w-24 bg-brand-primary rounded-full" />
                 </View>
                 <View className="px-12 items-center justify-center">
                    <View className="bg-surface-background px-6 py-2 rounded-full border border-surface-border">
                      <Text className="text-typography-muted font-black text-xs">AUDIT METRICS</Text>
                    </View>
                 </View>
                 <View className="flex-1 items-center">
                    <Text className="text-brand-primary font-black text-2xl uppercase tracking-widest text-center mb-2">{targetB?.name}</Text>
                    <View className="h-1 w-24 bg-brand-primary rounded-full" />
                 </View>
              </View>

              <View className="gap-4">
                {renderMetricRow('Tactical Velocity', 
                  Math.round(dataA?.velocity?.avg_lead_time_minutes || 0), 
                  Math.round(dataB?.velocity?.avg_lead_time_minutes || 0), 
                  'min'
                )}
                {renderMetricRow('Strategic Progressions', 
                  dataA?.quality?.total_progress || 0, 
                  dataB?.quality?.total_progress || 0
                )}
                {renderMetricRow('Operational Quality', 
                   (dataA?.quality?.total_progress || 0) > 0 
                     ? ((dataA?.quality?.total_revisions || 0) / (dataA?.quality?.total_progress || 1)).toFixed(2) 
                     : '0.00',
                   (dataB?.quality?.total_progress || 0) > 0 
                     ? ((dataB?.quality?.total_revisions || 0) / (dataB?.quality?.total_progress || 1)).toFixed(2) 
                     : '0.00',
                   'x'
                )}
              </View>

              <View className="mt-16 flex-row justify-center">
                <View className="bg-brand-primary/5 p-8 rounded-[40px] border border-brand-primary/10 items-center max-w-2xl">
                  <FontAwesome name="info-circle" size={24} color="rgb(var(--brand-primary))" className="mb-4 opacity-50" />
                  <Text className="text-center text-typography-muted leading-7 font-medium">
                    This benchmarking analysis is derived from real-time operational telemetry. Lower "Tactical Velocity" values indicate higher efficiency, while higher "Operational Quality" indicates a greater revision-to-progression ratio.
                  </Text>
                </View>
              </View>
            </View>
          ) : (
            <View className="items-center justify-center py-40 border-2 border-dashed border-surface-border rounded-[60px]">
              <FontAwesome name="area-chart" size={64} className="text-surface-border mb-6" />
              <Text className="text-typography-muted text-xl font-black uppercase tracking-widest">Awaiting Subject Selection</Text>
              <Text className="text-typography-muted/50 mt-2 font-medium">Select two assets above to begin strategic analysis</Text>
            </View>
          )}

          <View className="h-40" />
        </View>
      </ScrollView>
    </View>
  );
}

function SelectorGroup({ title, data, type, selected, onSelect, labelKey = 'name' }: any) {
  return (
    <View className="mb-6">
      <Text className="text-brand-primary text-[10px] font-black uppercase mb-3 opacity-60 tracking-widest">{title}</Text>
      <View className="flex-row flex-wrap gap-2">
        {data.map((item: any) => {
          const isSelected = selected?.id === item.id && selected?.type === type;
          return (
            <TouchableOpacity 
              key={item.id} 
              onPress={() => onSelect({ id: item.id, name: item[labelKey], type })} 
              className={`px-4 py-2 rounded-xl transition-all border ${isSelected ? 'bg-brand-primary border-brand-primary shadow-lg shadow-brand-primary/20' : 'bg-surface-background border-surface-border hover:bg-surface-overlay'}`}
            >
              <Text className={`text-[11px] font-bold ${isSelected ? 'text-white' : 'text-typography-main'}`}>{item[labelKey]}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}
