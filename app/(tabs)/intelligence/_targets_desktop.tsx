import { CircularTargetCard } from '@/components/intelligence/IntelligenceCommon';
import { TargetCreationModal } from '@/components/intelligence/IntelligenceModals';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { FontAwesome } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View, TextInput } from 'react-native';
import { 
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
  ScatterChart, Scatter, ZAxis, Cell
} from 'recharts';
import { useTheme } from '@/contexts/ThemeContext';
import { getPrimaryColor, getMutedColor } from '@/lib/themeColors';

export default function IntelligenceTargets() {
  const { profile } = useAuth();
  const { theme: activeTheme } = useTheme();
  const [targets, setTargets]         = useState<any[]>([]);
  const [history, setHistory]         = useState<any[]>([]);
  const [pipelines, setPipelines]     = useState<any[]>([]);
  const [allStages, setAllStages]     = useState<any[]>([]);
  const [loading, setLoading]         = useState(true);
  const [showModal, setShowModal]     = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [timeframe, setTimeframe]     = useState('30D');

  useEffect(() => {
    Promise.all([
      supabase.from('pipelines').select('id, name').is('deleted_at', null),
      supabase.from('pipeline_stages').select('id, name, pipeline_id').order('position', { ascending: true }),
    ]).then(([p, s]) => {
      if (p.data) setPipelines(p.data);
      if (s.data) setAllStages(s.data);
    });
    fetchTargets();
  }, []);

  const fetchTargets = async () => {
    setLoading(true);
    try {
      const { data: res } = await supabase
        .from('pipeline_stage_targets')
        .select('*, stage:pipeline_stages(name, pipeline_id)')
        .order('created_at', { ascending: false });

      const enriched = await Promise.all((res || []).map(async t => {
        if (t.target_type === 'volume' && t.status === 'active') {
            const { count } = await supabase.from('tasks').select('*', { count: 'exact', head: true }).eq('current_stage_id', t.stage_id);
            return { ...t, current_count: count || 0 };
        }
        return { ...t, current_count: t.target_quantity };
      }));

      setTargets(enriched.filter(t => t.status === 'active'));
      setHistory(enriched.filter(t => t.status !== 'active'));
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const handleCreate = async (params: any) => {
    try {
      const { error } = await supabase.from('pipeline_stage_targets').insert({
        stage_id: params.stage_id,
        company_id: profile?.company_id,
        target_type: params.target_type,
        target_active_seconds: params.active,
        target_lifecycle_seconds: params.lifecycle,
        target_quantity: params.quantity,
        target_deadline: params.deadline,
        status: 'active'
      });
      if (error) throw error;
      fetchTargets();
    } catch (e: any) { console.error(e); }
  };

  const handleClear = async (id: string, newStatus: string) => {
    const { error } = await supabase
      .from('pipeline_stage_targets')
      .update({ 
        status: newStatus, 
        completed_at: newStatus === 'completed' ? new Date().toISOString() : null 
      })
      .eq('id', id);
    if (!error) fetchTargets();
  };

  const handleUpdate = async (id: string, field: string, val: string) => {
    const num = parseInt(val);
    if (isNaN(num)) return;
    const { error } = await supabase.from('pipeline_stage_targets').update({ [field]: num }).eq('id', id);
    if (!error) fetchTargets();
  };

  const handleEdit = (target: any) => {
    const newVal = window.prompt(
      `Update ${target.target_type === 'volume' ? 'target quantity' : 'active seconds'}:`,
      String(target.target_type === 'volume' ? target.target_quantity : target.target_active_seconds),
    );
    if (newVal) handleUpdate(target.id, target.target_type === 'volume' ? 'target_quantity' : 'target_active_seconds', newVal);
  };

  // Filter history based on timeframe
  const filteredHistory = history.filter(h => {
    const date = new Date(h.completed_at || h.created_at);
    const now = new Date();
    if (timeframe === '7D') return (now.getTime() - date.getTime()) < 7 * 86400000;
    if (timeframe === '30D') return (now.getTime() - date.getTime()) < 30 * 86400000;
    if (timeframe === '90D') return (now.getTime() - date.getTime()) < 90 * 86400000;
    return true;
  });

  const chartData = Object.values(filteredHistory.reduce((acc: any, t) => {
    const date = new Date(t.completed_at || t.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    acc[date] = acc[date] || { date, met: 0, missed: 0 };
    if (t.status === 'completed') acc[date].met += 1;
    if (t.status === 'expired') acc[date].missed += 1;
    return acc;
  }, {})).sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Prepare data for Fulfillment Trace (ScatterChart)
  const timelineCategories = Array.from(new Set(filteredHistory.filter(h => h.status === 'completed').map(h => h.stage?.name || 'Global'))).sort();
  const timelineData = filteredHistory
    .filter(h => h.status === 'completed')
    .map(h => ({
      y: timelineCategories.indexOf(h.stage?.name || 'Global'),
      x: new Date(h.completed_at).getTime(),
      name: h.stage?.name || 'Global',
      type: h.target_type,
      dateLabel: new Date(h.completed_at).toLocaleDateString()
    }));

  const filteredTargets = targets.filter(t => 
    t.stage?.name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <View className="flex-1 bg-surface-background flex-row">
      
      {/* ── LEFT COLUMN: WORKSPACE ── */}
      <View className="flex-1 flex-col">
        <View className="px-10 pt-8 pb-5 flex-row items-center justify-between border-b border-surface-border">
          <View>
            <Text className="text-brand-primary font-black uppercase tracking-[0.3em] text-[9px] mb-1">Intelligence Hub</Text>
            <Text className="text-typography-main text-4xl font-black tracking-tighter">Performance Targets</Text>
          </View>
          <View className="flex-row items-center gap-3">
            <View className="bg-surface-card border border-surface-border rounded-xl px-4 py-2 flex-row items-center w-64">
                <FontAwesome name="search" size={12} color={getMutedColor(activeTheme)} className="mr-3" />
                <TextInput 
                    placeholder="Search stage targets..." 
                    placeholderTextColor="var(--color-text-muted)"
                    className="flex-1 text-typography-main text-xs font-bold outline-none"
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                />
            </View>
            <TouchableOpacity onPress={() => setShowModal(true)} className="bg-brand-primary px-6 py-2.5 rounded-xl flex-row items-center gap-2">
              <FontAwesome name="plus" size={12} color="white" />
              <Text className="text-white font-black uppercase tracking-widest text-[11px]">New Target</Text>
            </TouchableOpacity>
          </View>
        </View>

        {loading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" color={getPrimaryColor(activeTheme)} />
          </View>
        ) : (
          <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
            <View className="px-10 py-8">
                {/* Active Targets Grid */}
                <View className="flex-row flex-wrap gap-6 mb-12">
                    {filteredTargets.length === 0 ? (
                        <View className="w-full bg-surface-card/30 p-20 rounded-[3rem] border border-surface-border border-dashed items-center">
                            <FontAwesome name="bullseye" size={40} color={getMutedColor(activeTheme)} className="mb-4 opacity-20" />
                            <Text className="text-typography-muted font-bold text-sm">No active targets found.</Text>
                        </View>
                    ) : (
                        filteredTargets.map((t, i) => (
                            <CircularTargetCard 
                                key={i} 
                                target={t} 
                                onEdit={() => handleEdit(t)} 
                                onClear={(status: string) => handleClear(t.id, status)}
                            />
                        ))
                    )}
                </View>

                {/* Fulfillment Trace Section */}
                {timelineData.length > 0 && (
                   <View className="bg-surface-card p-10 rounded-[3rem] border border-surface-border premium-shadow mb-10">
                      <View className="flex-row justify-between items-start mb-10">
                        <View>
                           <Text className="text-typography-main font-black text-2xl tracking-tighter">Fulfillment Trace</Text>
                           <Text className="text-typography-muted text-xs mt-1">Timeline of satisfied performance benchmarks by stage</Text>
                        </View>
                        <View className="bg-brand-primary/10 px-4 py-2 rounded-xl border border-brand-primary/20">
                           <Text className="text-brand-primary text-[10px] font-black uppercase tracking-widest">{timelineData.length} Success Points</Text>
                        </View>
                      </View>

                      <View style={{ height: 320 }}>
                         <ResponsiveContainer width="100%" height="100%">
                            <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                               <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" opacity={0.1} />
                               <XAxis 
                                  type="number" 
                                  dataKey="x" 
                                  name="time" 
                                  domain={['auto', 'auto']}
                                  tickFormatter={(t) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                  stroke="var(--color-text-dim)"
                                  fontSize={10}
                                  fontWeight="bold"
                                  axisLine={false}
                                  tickLine={false}
                                  dy={10}
                               />
                               <YAxis 
                                  type="number" 
                                  dataKey="y" 
                                  name="stage" 
                                  domain={[-1, timelineCategories.length]}
                                  ticks={timelineCategories.map((_, i) => i)}
                                  tickFormatter={(i) => timelineCategories[i]}
                                  stroke="var(--color-text-dim)"
                                  fontSize={10}
                                  axisLine={false}
                                  tickLine={false}
                               />
                               <ZAxis type="number" range={[100, 100]} />
                               <Tooltip 
                                  cursor={{ strokeDasharray: '3 3' }}
                                  content={({ active, payload }: any) => {
                                     if (active && payload && payload.length) {
                                        const d = payload[0].payload;
                                        return (
                                           <View className="bg-surface-card border border-surface-border p-3 rounded-xl premium-shadow">
                                              <Text className="text-typography-main font-black text-sm mb-1">{d.name}</Text>
                                              <Text className="text-brand-primary font-bold text-[10px] uppercase tracking-widest">{d.type} MET</Text>
                                              <Text className="text-typography-muted text-[10px] mt-2">{d.dateLabel}</Text>
                                           </View>
                                        );
                                     }
                                     return null;
                                  }}
                               />
                               <Scatter name="Successes" data={timelineData}>
                                  {timelineData.map((entry, index) => (
                                     <Cell key={`cell-${index}`} fill="var(--color-primary)" />
                                  ))}
                               </Scatter>
                            </ScatterChart>
                         </ResponsiveContainer>
                      </View>
                   </View>
                )}
            </View>
          </ScrollView>
        )}
      </View>

      {/* ── RIGHT COLUMN: PERFORMANCE CONSOLE ── */}
      <View className="w-[480px] border-l border-surface-border bg-surface-card/10">
        <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
            
            {/* Success Velocity Widget (Enlarged) */}
            <View className="p-8">
                <View className="bg-surface-card p-8 rounded-[40px] border border-surface-border premium-shadow mb-8">
                    <View className="flex-row justify-between items-start mb-8">
                        <View>
                            <Text className="text-typography-main font-black text-xl tracking-tight">Success Velocity</Text>
                            <Text className="text-typography-muted text-[10px] mt-1 uppercase tracking-widest">Aggregate Achievement Rate</Text>
                        </View>
                        <View className="flex-row gap-1">
                            {['7D', '30D', '90D', 'ALL'].map((tf) => (
                                <TouchableOpacity 
                                    key={tf} 
                                    onPress={() => setTimeframe(tf)}
                                    className={`px-3 py-1.5 rounded-lg border ${timeframe === tf ? 'bg-brand-primary border-brand-primary' : 'bg-surface-overlay border-surface-border'}`}
                                >
                                    <Text className={`text-[8px] font-black ${timeframe === tf ? 'text-white' : 'text-typography-muted'}`}>{tf}</Text>
                                </TouchableOpacity>
                            ))}
                        </View>
                    </View>
                    
                    <View style={{ height: 320 }}>
                        {filteredHistory.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={chartData} margin={{ bottom: 20 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} opacity={0.1} />
                                    <XAxis 
                                        dataKey="date" 
                                        stroke="var(--color-text-dim)" 
                                        fontSize={10} 
                                        fontWeight="bold"
                                        axisLine={false} 
                                        tickLine={false}
                                        dy={10}
                                    />
                                    <YAxis hide />
                                    <Tooltip 
                                        cursor={{ fill: 'var(--color-primary)', fillOpacity: 0.05 }}
                                        contentStyle={{ backgroundColor: 'var(--color-surface-card)', border: '1px solid var(--color-surface-border)', borderRadius: '12px' }}
                                    />
                                    <Bar dataKey="met" stackId="a" fill="var(--color-primary)" radius={[0, 0, 0, 0]} maxBarSize={40} />
                                    <Bar dataKey="missed" stackId="a" fill="var(--color-danger)" radius={[8, 8, 0, 0]} maxBarSize={40} />
                                </BarChart>
                            </ResponsiveContainer>
                        ) : (
                            <View className="flex-1 items-center justify-center bg-surface-background/50 rounded-2xl border border-dashed border-surface-border">
                                <Text className="text-typography-muted text-[10px] font-black">NO DATA IN RANGE</Text>
                            </View>
                        )}
                    </View>

                    <View className="flex-row items-center justify-center gap-6 mt-8">
                         <View className="flex-row items-center gap-2">
                             <View className="w-2.5 h-2.5 rounded-full bg-brand-primary" />
                             <Text className="text-[9px] font-black text-typography-main uppercase tracking-widest">Met Goals</Text>
                         </View>
                         <View className="flex-row items-center gap-2">
                             <View className="w-2.5 h-2.5 rounded-full bg-state-danger" />
                             <Text className="text-[9px] font-black text-typography-main uppercase tracking-widest">Missed Goals</Text>
                         </View>
                    </View>
                </View>

                {/* Target History */}
                <View>
                    <View className="flex-row items-center justify-between mb-6">
                        <View className="flex-row items-center gap-2">
                            <View className="w-1.5 h-1.5 rounded-full bg-state-info" />
                            <Text className="text-typography-main font-black uppercase tracking-[0.2em] text-[10px]">Recent Activity</Text>
                        </View>
                        <TouchableOpacity onPress={fetchTargets}>
                             <FontAwesome name="refresh" size={10} color={getMutedColor(activeTheme)} />
                        </TouchableOpacity>
                    </View>

                    {filteredHistory.length === 0 ? (
                        <View className="p-10 items-center justify-center bg-surface-card/30 rounded-3xl border border-surface-border border-dashed">
                             <Text className="text-typography-muted text-[10px] font-bold">NO HISTORY IN RANGE</Text>
                        </View>
                    ) : (
                        <View className="gap-4">
                            {filteredHistory.slice(0, 15).map((h, i) => (
                                <View key={i} className="bg-surface-card p-4 rounded-2xl border border-surface-border flex-row items-center">
                                    <View className={`w-8 h-8 rounded-full items-center justify-center mr-4 ${h.status === 'completed' ? 'bg-state-success/10' : 'bg-state-danger/10'}`}>
                                        <FontAwesome name={h.status === 'completed' ? 'check' : 'times'} size={10} color={h.status === 'completed' ? 'var(--color-success)' : 'var(--color-danger)'} />
                                    </View>
                                    <View className="flex-1">
                                        <Text className="text-typography-main font-bold text-xs" numberOfLines={1}>{h.stage?.name || 'Unknown Stage'}</Text>
                                        <Text className="text-typography-muted text-[9px] uppercase tracking-widest">{h.target_type} {h.status === 'completed' ? 'Met' : 'Missed'}</Text>
                                    </View>
                                    <Text className="text-typography-muted text-[9px] font-bold">
                                        {new Date(h.completed_at || h.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                    </Text>
                                </View>
                            ))}
                        </View>
                    )}
                </View>
            </View>

        </ScrollView>
      </View>

      <TargetCreationModal
        visible={showModal}
        onClose={() => setShowModal(false)}
        onConfirm={handleCreate}
        pipelines={pipelines}
        stages={allStages}
      />
    </View>
  );
}
