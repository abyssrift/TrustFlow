import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Alert, SafeAreaView, Dimensions } from 'react-native';
import { supabase } from '@/lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Stack } from 'expo-router';

type AuditData = {
  funnel: Array<{ stage_name: string; task_count: number }>;
  quality: { total_revisions: number; total_progress: number };
  velocity: { avg_lead_time_minutes: number };
};

export default function ComparisonScreen() {
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
      const { data: users } = await supabase.from('users').select('id, full_name').limit(10);
      const { data: pipes } = await supabase.from('pipelines').select('id, name').limit(10);
      const { data: teams } = await supabase.from('teams').select('id, name').limit(10);
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
    const diff = numA - numB;
    const winner = isHigherBetter ? (numA > numB ? 'A' : 'B') : (numA < numB ? 'A' : 'B');

    return (
      <View className="mb-6">
        <Text className="text-typography-muted text-[10px] font-black uppercase text-center mb-2 tracking-widest">{label}</Text>
        <View className="flex-row items-center justify-between">
           <View className={`flex-1 p-4 rounded-2xl border ${winner === 'A' ? 'bg-brand-primary/10 border-brand-primary' : 'bg-surface-card border-surface-border'}`}>
              <Text className={`text-xl font-black text-center ${winner === 'A' ? 'text-brand-primary' : 'text-typography-main'}`}>
                 {valA}{unit}
              </Text>
           </View>
           <View className="px-4">
              <FontAwesome name="exchange" size={14} color="rgb(var(--text-muted))" />
           </View>
           <View className={`flex-1 p-4 rounded-2xl border ${winner === 'B' ? 'bg-brand-primary/10 border-brand-primary' : 'bg-surface-card border-surface-border'}`}>
              <Text className={`text-xl font-black text-center ${winner === 'B' ? 'text-brand-primary' : 'text-typography-main'}`}>
                 {valB}{unit}
              </Text>
           </View>
        </View>
      </View>
    );
  };

  return (
    <View className="flex-1 bg-surface-background">
      <Stack.Screen options={{ title: 'Performance Comparison', headerTitleStyle: { fontWeight: '900' } }} />
      <SafeAreaView className="flex-1">
        <ScrollView className="flex-1 px-6 pt-6">
          
          <Text className="text-typography-main text-3xl font-black mb-1">Matrix Versus</Text>
          <Text className="text-typography-muted text-xs font-medium mb-8">Side-by-side performance benchmarking</Text>

          {/* Selectors */}
          <View className="flex-row mb-8 space-x-3">
             <View className="flex-1 bg-surface-card p-4 rounded-3xl border border-surface-border">
                <Text className="text-typography-muted text-[10px] font-black uppercase mb-2">Subject A</Text>
                <ScrollView style={{ height: 120 }}>
                   <Text className="text-brand-primary text-[8px] font-black uppercase mb-2 opacity-60">Users</Text>
                   {availableUsers.map(u => (
                     <TouchableOpacity key={u.id} onPress={() => setTargetA({ id: u.id, name: u.full_name, type: 'user' })} className={`p-2 rounded-lg mb-1 ${targetA?.id === u.id ? 'bg-brand-primary' : 'bg-surface-background'}`}>
                        <Text className={`text-[10px] font-bold ${targetA?.id === u.id ? 'text-white' : 'text-typography-main'}`}>{u.full_name}</Text>
                     </TouchableOpacity>
                   ))}
                   <Text className="text-brand-primary text-[8px] font-black uppercase my-2 opacity-60">Pipelines</Text>
                   {availablePipelines.map(p => (
                     <TouchableOpacity key={p.id} onPress={() => setTargetA({ id: p.id, name: p.name, type: 'pipeline' })} className={`p-2 rounded-lg mb-1 ${targetA?.id === p.id ? 'bg-brand-primary' : 'bg-surface-background'}`}>
                        <Text className={`text-[10px] font-bold ${targetA?.id === p.id ? 'text-white' : 'text-typography-main'}`}>{p.name}</Text>
                     </TouchableOpacity>
                   ))}
                   <Text className="text-brand-primary text-[8px] font-black uppercase my-2 opacity-60">Teams</Text>
                   {availableTeams.map(t => (
                     <TouchableOpacity key={t.id} onPress={() => setTargetA({ id: t.id, name: t.name, type: 'team' })} className={`p-2 rounded-lg mb-1 ${targetA?.id === t.id ? 'bg-brand-primary' : 'bg-surface-background'}`}>
                        <Text className={`text-[10px] font-bold ${targetA?.id === t.id ? 'text-white' : 'text-typography-main'}`}>{t.name}</Text>
                     </TouchableOpacity>
                   ))}
                </ScrollView>
             </View>
             <View className="flex-1 bg-surface-card p-4 rounded-3xl border border-surface-border">
                <Text className="text-typography-muted text-[10px] font-black uppercase mb-2">Subject B</Text>
                <ScrollView style={{ height: 120 }}>
                   <Text className="text-brand-primary text-[8px] font-black uppercase mb-2 opacity-60">Users</Text>
                   {availableUsers.map(u => (
                     <TouchableOpacity key={u.id} onPress={() => setTargetB({ id: u.id, name: u.full_name, type: 'user' })} className={`p-2 rounded-lg mb-1 ${targetB?.id === u.id ? 'bg-brand-primary' : 'bg-surface-background'}`}>
                        <Text className={`text-[10px] font-bold ${targetB?.id === u.id ? 'text-white' : 'text-typography-main'}`}>{u.full_name}</Text>
                     </TouchableOpacity>
                   ))}
                   <Text className="text-brand-primary text-[8px] font-black uppercase my-2 opacity-60">Pipelines</Text>
                   {availablePipelines.map(p => (
                     <TouchableOpacity key={p.id} onPress={() => setTargetB({ id: p.id, name: p.name, type: 'pipeline' })} className={`p-2 rounded-lg mb-1 ${targetB?.id === p.id ? 'bg-brand-primary' : 'bg-surface-background'}`}>
                        <Text className={`text-[10px] font-bold ${targetB?.id === p.id ? 'text-white' : 'text-typography-main'}`}>{p.name}</Text>
                     </TouchableOpacity>
                   ))}
                   <Text className="text-brand-primary text-[8px] font-black uppercase my-2 opacity-60">Teams</Text>
                   {availableTeams.map(t => (
                     <TouchableOpacity key={t.id} onPress={() => setTargetB({ id: t.id, name: t.name, type: 'team' })} className={`p-2 rounded-lg mb-1 ${targetB?.id === t.id ? 'bg-brand-primary' : 'bg-surface-background'}`}>
                        <Text className={`text-[10px] font-bold ${targetB?.id === t.id ? 'text-white' : 'text-typography-main'}`}>{t.name}</Text>
                     </TouchableOpacity>
                   ))}
                </ScrollView>
             </View>
          </View>

          <TouchableOpacity 
            onPress={handleRunComparison}
            disabled={!targetA || !targetB || loading}
            className={`h-14 rounded-2xl items-center justify-center mb-10 ${(!targetA || !targetB) ? 'bg-surface-border' : 'bg-brand-primary'}`}
          >
             <Text className="text-white font-black uppercase tracking-widest">Execute Benchmarking</Text>
          </TouchableOpacity>

          {loading && <ActivityIndicator size="large" color="rgb(var(--brand-primary))" className="mb-10" />}

          {dataA && dataB && (
            <View>
              <View className="flex-row justify-between mb-8 px-2">
                 <View className="flex-1 items-center">
                    <Text className="text-brand-primary font-black text-[10px] uppercase text-center mb-1">{targetA?.name}</Text>
                    <View className="h-1 w-12 bg-brand-primary rounded-full opacity-30" />
                 </View>
                 <View className="w-10 items-center justify-center">
                    <Text className="text-typography-muted font-black text-[10px]">VS</Text>
                 </View>
                 <View className="flex-1 items-center">
                    <Text className="text-brand-primary font-black text-[10px] uppercase text-center mb-1">{targetB?.name}</Text>
                    <View className="h-1 w-12 bg-brand-primary rounded-full opacity-30" />
                 </View>
              </View>

              {renderMetricRow('Avg Lead Time', 
                Math.round(dataA?.velocity?.avg_lead_time_minutes || 0), 
                Math.round(dataB?.velocity?.avg_lead_time_minutes || 0), 
                'm'
              )}
              {renderMetricRow('Progressions', 
                dataA?.quality?.total_progress || 0, 
                dataB?.quality?.total_progress || 0
              )}
              {renderMetricRow('Quality Ratio', 
                 (dataA?.quality?.total_progress || 0) > 0 
                   ? ((dataA?.quality?.total_revisions || 0) / (dataA?.quality?.total_progress || 1)).toFixed(2) 
                   : '0.00',
                 (dataB?.quality?.total_progress || 0) > 0 
                   ? ((dataB?.quality?.total_revisions || 0) / (dataB?.quality?.total_progress || 1)).toFixed(2) 
                   : '0.00',
                 'x'
              )}

              <View className="h-20" />
            </View>
          )}

        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
