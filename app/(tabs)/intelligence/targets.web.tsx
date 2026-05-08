import { CircularTargetCard } from '@/components/intelligence/IntelligenceCommon';
import { TargetCreationModal } from '@/components/intelligence/IntelligenceModals';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { FontAwesome } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View, TextInput } from 'react-native';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
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

  const chartData = Object.values(history.reduce((acc: any, t) => {
    if (t.status === 'completed' && t.completed_at) {
      const date = new Date(t.completed_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      acc[date] = acc[date] || { date, count: 0 };
      acc[date].count += 1;
    }
    return acc;
  }, {})).sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const filteredTargets = targets.filter(t => 
    t.stage?.name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <View className="flex-1 bg-surface-background flex-row">
      
      {/* ── LEFT COLUMN: RULE REGISTRY ── */}
      <View className="flex-1 flex-col">
        <View className="px-10 pt-8 pb-5 flex-row items-center justify-between border-b border-surface-border">
          <View>
            <Text className="text-brand-primary font-black uppercase tracking-[0.3em] text-[9px] mb-1">Pipeline Governance</Text>
            <Text className="text-typography-main text-4xl font-black tracking-tighter">Active Rules</Text>
          </View>
          <View className="flex-row items-center gap-3">
            <View className="bg-surface-card border border-surface-border rounded-xl px-4 py-2 flex-row items-center w-64">
                <FontAwesome name="search" size={12} color={getMutedColor(activeTheme)} className="mr-3" />
                <TextInput 
                    placeholder="Search stage rules..." 
                    placeholderTextColor="var(--color-text-muted)"
                    className="flex-1 text-typography-main text-xs font-bold outline-none"
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                />
            </View>
            <TouchableOpacity onPress={() => setShowModal(true)} className="bg-brand-primary px-6 py-2.5 rounded-xl flex-row items-center gap-2">
              <FontAwesome name="plus" size={12} color="white" />
              <Text className="text-white font-black uppercase tracking-widest text-[11px]">Define Rule</Text>
            </TouchableOpacity>
          </View>
        </View>

        {loading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" color={getPrimaryColor(activeTheme)} />
          </View>
        ) : (
          <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
            <View className="p-10">
                {filteredTargets.length === 0 ? (
                    <View className="bg-surface-card/30 p-20 rounded-[3rem] border border-surface-border border-dashed items-center">
                        <FontAwesome name="shield" size={40} color={getMutedColor(activeTheme)} className="mb-4 opacity-20" />
                        <Text className="text-typography-muted font-bold text-sm">No rules match your current criteria.</Text>
                    </View>
                ) : (
                    <View className="flex-row flex-wrap gap-6">
                        {filteredTargets.map((t, i) => (
                            <CircularTargetCard 
                                key={i} 
                                target={t} 
                                onEdit={() => handleEdit(t)} 
                                onClear={(status: string) => handleClear(t.id, status)}
                            />
                        ))}
                    </View>
                )}
            </View>
          </ScrollView>
        )}
      </View>

      {/* ── RIGHT COLUMN: INTELLIGENCE CONSOLE ── */}
      <View className="w-[480px] border-l border-surface-border bg-surface-card/10">
        <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
            
            {/* Velocity Widget */}
            <View className="p-8">
                <View className="bg-surface-card p-6 rounded-[32px] border border-surface-border premium-shadow mb-8">
                    <View className="flex-row justify-between items-start mb-6">
                        <View>
                            <Text className="text-typography-main font-black text-lg tracking-tight">Compliance Velocity</Text>
                            <Text className="text-typography-muted text-[10px] mt-1 uppercase tracking-widest">Successful Benchmark Captures</Text>
                        </View>
                        <FontAwesome name="bolt" size={14} color={getPrimaryColor(activeTheme)} />
                    </View>
                    
                    <View style={{ height: 180 }}>
                        {history.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={chartData}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} opacity={0.1} />
                                    <XAxis dataKey="date" hide />
                                    <YAxis hide />
                                    <Tooltip 
                                        cursor={{ fill: 'var(--color-primary)', fillOpacity: 0.05 }}
                                        contentStyle={{ backgroundColor: 'var(--color-surface-card)', border: '1px solid var(--color-surface-border)', borderRadius: '12px' }}
                                    />
                                    <Bar dataKey="count" fill="var(--color-primary)" radius={[4, 4, 0, 0]} maxBarSize={30} />
                                </BarChart>
                            </ResponsiveContainer>
                        ) : (
                            <View className="flex-1 items-center justify-center bg-surface-background/50 rounded-2xl border border-dashed border-surface-border">
                                <Text className="text-typography-muted text-[10px] font-black">WAITING FOR DATA</Text>
                            </View>
                        )}
                    </View>
                </View>

                {/* Audit Log */}
                <View>
                    <View className="flex-row items-center justify-between mb-6">
                        <View className="flex-row items-center gap-2">
                            <View className="w-1.5 h-1.5 rounded-full bg-state-info" />
                            <Text className="text-typography-main font-black uppercase tracking-[0.2em] text-[10px]">Rule History Log</Text>
                        </View>
                        <TouchableOpacity onPress={fetchTargets}>
                             <FontAwesome name="refresh" size={10} color={getMutedColor(activeTheme)} />
                        </TouchableOpacity>
                    </View>

                    {history.length === 0 ? (
                        <View className="p-10 items-center justify-center bg-surface-card/30 rounded-3xl border border-surface-border border-dashed">
                             <Text className="text-typography-muted text-[10px] font-bold">NO LOG ENTRIES</Text>
                        </View>
                    ) : (
                        <View className="gap-4">
                            {history.slice(0, 15).map((h, i) => (
                                <View key={i} className="bg-surface-card p-4 rounded-2xl border border-surface-border flex-row items-center">
                                    <View className={`w-8 h-8 rounded-full items-center justify-center mr-4 ${h.status === 'completed' ? 'bg-state-success/10' : 'bg-state-danger/10'}`}>
                                        <FontAwesome name={h.status === 'completed' ? 'check' : 'times'} size={10} color={h.status === 'completed' ? 'var(--color-success)' : 'var(--color-danger)'} />
                                    </View>
                                    <View className="flex-1">
                                        <Text className="text-typography-main font-bold text-xs" numberOfLines={1}>{h.stage?.name || 'Unknown Stage'}</Text>
                                        <Text className="text-typography-muted text-[9px] uppercase tracking-widest">{h.target_type} {h.status}</Text>
                                    </View>
                                    <Text className="text-typography-muted text-[9px] font-bold">
                                        {h.completed_at ? new Date(h.completed_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '---'}
                                    </Text>
                                </View>
                            ))}
                        </View>
                    )}
                </View>

                {/* Simulation Utility */}
                <View className="mt-10 bg-brand-primary/5 p-6 rounded-[2rem] border border-brand-primary/10">
                    <Text className="text-brand-primary font-black uppercase tracking-[0.2em] text-[9px] mb-4">Rule Sandbox</Text>
                    <Text className="text-typography-main font-bold text-xs mb-4">Test a scenario against your active governance rules.</Text>
                    <TouchableOpacity className="bg-brand-primary/10 border border-brand-primary/20 p-4 rounded-xl items-center">
                        <Text className="text-brand-primary font-black uppercase tracking-widest text-[9px]">Launch Simulator</Text>
                    </TouchableOpacity>
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

