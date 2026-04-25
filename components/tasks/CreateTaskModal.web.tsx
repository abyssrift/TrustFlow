import React, { useState, useEffect } from 'react';
import { View, Text, Modal, TouchableOpacity, TextInput, ScrollView, ActivityIndicator, Platform } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { useTaskCreation } from '@/contexts/TaskCreationContext';
import { supabase } from '@/lib/supabase';
import PremiumCalendarPicker from '@/components/common/PremiumCalendarPicker';

type Props = {
  visible: boolean;
  onClose: () => void;
  initialPipelineId?: string | null;
};

export default function CreateTaskModal({ visible, onClose, initialPipelineId }: Props) {
  const { draft, setDraft, createTask, loading, recentTasks, loadRecentTasks } = useTaskCreation();
  const [activeTab, setActiveTab] = useState<'details' | 'assignments'>('details');
  const [users, setUsers] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [showCalendar, setShowCalendar] = useState(false);

  useEffect(() => {
    if (visible) {
      loadRecentTasks();
      fetchResources();
      if (initialPipelineId && !draft.pipelineId) {
        setDraft({ pipelineId: initialPipelineId });
      }
    }
  }, [visible]);

  const fetchResources = async () => {
    const [{ data: userData }, { data: teamData }] = await Promise.all([
      supabase.from('users').select('id, full_name, avatar_url').is('deleted_at', null),
      supabase.from('teams').select('id, name, color').is('deleted_at', null)
    ]);
    setUsers(userData || []);
    setTeams(teamData || []);
  };

  const handleCopyRecent = (task: any) => {
    setDraft({
      title: `${task.title} (Clone)`,
      description: task.description,
      priority: task.priority,
      category: task.category,
      weight: task.weight,
      assigneeUserIds: task.assignments?.filter((a: any) => a.assignee_user_id).map((a: any) => a.assignee_user_id) || [],
      assigneeTeamIds: task.assignments?.filter((a: any) => a.assignee_team_id).map((a: any) => a.assignee_team_id) || [],
    });
  };

  const toggleUser = (id: string) => {
    const exists = draft.assigneeUserIds.includes(id);
    setDraft({
      assigneeUserIds: exists 
        ? draft.assigneeUserIds.filter(u => u !== id)
        : [...draft.assigneeUserIds, id]
    });
  };

  const toggleTeam = (id: string) => {
    const exists = draft.assigneeTeamIds.includes(id);
    setDraft({
      assigneeTeamIds: exists 
        ? draft.assigneeTeamIds.filter(t => t !== id)
        : [...draft.assigneeTeamIds, id]
    });
  };

  const handleCreate = async () => {
    const id = await createTask();
    if (id) onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View className="flex-1 bg-surface-background/80 items-center justify-center p-10" style={{ backdropFilter: 'blur(12px)' } as any}>
        <View className="bg-surface-card w-full max-w-[1200px] h-[800px] rounded-[3rem] border border-surface-border overflow-hidden flex-row premium-shadow">
          
          {/* LEFT SIDEBAR: THE ARCHIVE */}
          <View className="w-80 border-r border-surface-border bg-surface-background/30 p-8">
            <View className="flex-row items-center mb-8">
               <FontAwesome name="history" size={14} className="text-brand-primary" />
               <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.2em] ml-3">Tactical Archive</Text>
            </View>
            
            <Text className="text-typography-main font-black text-xl mb-6 tracking-tight">Recent Tasks</Text>
            
            <ScrollView showsVerticalScrollIndicator={false}>
               {recentTasks.map(t => (
                 <TouchableOpacity 
                   key={t.id} 
                   onPress={() => handleCopyRecent(t)}
                   className="p-4 rounded-2xl bg-surface-card border border-surface-border mb-3 hover:border-brand-primary/50 transition-all group"
                 >
                   <Text className="text-typography-main font-bold text-sm mb-1 group-hover:text-brand-primary" numberOfLines={1}>{t.title}</Text>
                   <Text className="text-typography-muted text-[10px] uppercase font-black tracking-widest">{t.category || 'General'}</Text>
                 </TouchableOpacity>
               ))}
               {recentTasks.length === 0 && (
                 <View className="py-20 items-center opacity-30">
                    <FontAwesome name="inbox" size={32} className="text-typography-muted" />
                    <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mt-4">Empty Stack</Text>
                 </View>
               )}
            </ScrollView>
          </View>

          {/* MAIN CONTENT */}
          <View className="flex-1 flex-col">
            {/* Header */}
            <View className="px-10 py-8 border-b border-surface-border flex-row items-center justify-between">
              <View>
                <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.3em] mb-1">Task Orchestrator</Text>
                <Text className="text-typography-main text-3xl font-black tracking-tighter">Initialize Deployment</Text>
              </View>
              <TouchableOpacity onPress={onClose} className="w-12 h-12 bg-surface-background rounded-full items-center justify-center border border-surface-border hover:border-brand-primary transition-colors">
                <FontAwesome name="times" size={18} className="text-typography-muted" />
              </TouchableOpacity>
            </View>

            {/* Tabs */}
            <View className="px-10 py-4 flex-row gap-8">
               {['details', 'assignments'].map((t: any) => (
                 <TouchableOpacity key={t} onPress={() => setActiveTab(t)}>
                    <Text className={`font-black text-xs uppercase tracking-widest pb-2 border-b-2 transition-all ${activeTab === t ? 'text-brand-primary border-brand-primary' : 'text-typography-muted border-transparent'}`}>
                      {t}
                    </Text>
                 </TouchableOpacity>
               ))}
            </View>

            {/* Form Area */}
            <ScrollView className="flex-1 px-10 pt-6">
              {activeTab === 'details' ? (
                <View className="gap-8 pb-60">
                  <View>
                    <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-3 ml-1">Engagement Title</Text>
                    <TextInput 
                      value={draft.title}
                      onChangeText={t => setDraft({ title: t })}
                      placeholder="e.g. Critical Infrastructure Audit"
                      placeholderTextColor="rgb(var(--text-dim))"
                      className="bg-surface-background border border-surface-border rounded-2xl px-6 py-5 text-typography-main font-black text-lg"
                    />
                  </View>

                  <View className="flex-row gap-8">
                    <View className="flex-1">
                      <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-3 ml-1">Priority Level</Text>
                      <View className="flex-row bg-surface-background border border-surface-border rounded-2xl p-1.5">
                        {['low', 'normal', 'high', 'urgent'].map(p => (
                          <TouchableOpacity 
                            key={p} 
                            onPress={() => setDraft({ priority: p as any })}
                            className={`flex-1 py-3 items-center rounded-xl transition-all ${draft.priority === p ? 'bg-brand-primary' : 'hover:bg-surface-overlay'}`}
                          >
                            <Text className={`font-black text-[10px] uppercase tracking-widest ${draft.priority === p ? 'text-white' : 'text-typography-muted'}`}>{p}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                    <View className="w-48">
                      <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-3 ml-1">Operational Weight</Text>
                      <TextInput 
                        value={draft.weight.toString()}
                        onChangeText={t => setDraft({ weight: parseInt(t) || 1 })}
                        keyboardType="numeric"
                        className="bg-surface-background border border-surface-border rounded-2xl px-6 py-4 text-typography-main font-black text-center"
                      />
                    </View>
                  </View>

                  <View className="flex-row gap-8">
                    <View className="flex-1">
                       <View className="relative">
                         <TouchableOpacity 
                           onPress={() => setShowCalendar(!showCalendar)}
                           className="bg-surface-background border border-surface-border rounded-2xl px-6 py-4 flex-row items-center justify-between"
                         >
                            <Text className={`font-black ${draft.dueDate ? 'text-typography-main' : 'text-typography-dim'}`}>
                               {draft.dueDate ? new Date(draft.dueDate).toLocaleDateString(undefined, { dateStyle: 'long' }) : 'Set Deadline'}
                            </Text>
                            <FontAwesome name="calendar" size={14} className="text-brand-primary" />
                         </TouchableOpacity>
                         
                         {showCalendar && (
                           <View className="absolute top-full left-0 right-0 z-50 mt-2">
                             <PremiumCalendarPicker 
                               selectedDate={draft.dueDate} 
                               onSelect={(date) => {
                                 setDraft({ dueDate: date });
                                 setShowCalendar(false);
                               }} 
                             />
                           </View>
                         )}
                       </View>
                    </View>
                    <View className="flex-1">
                      <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-3 ml-1">Category Registry</Text>
                      <TextInput 
                        value={draft.category}
                        onChangeText={t => setDraft({ category: t })}
                        placeholder="General"
                        placeholderTextColor="rgb(var(--text-dim))"
                        className="bg-surface-background border border-surface-border rounded-2xl px-6 py-4 text-typography-main font-black"
                      />
                    </View>
                  </View>

                  <View>
                    <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-3 ml-1">Mandate Documentation</Text>
                    <TextInput 
                      value={draft.description}
                      onChangeText={t => setDraft({ description: t })}
                      placeholder="Define the scope of this tactical objective..."
                      placeholderTextColor="rgb(var(--text-dim))"
                      multiline
                      numberOfLines={6}
                      textAlignVertical="top"
                      className="bg-surface-background border border-surface-border rounded-3xl px-6 py-5 text-typography-main text-sm leading-6 h-40"
                    />
                  </View>
                </View>
              ) : (
                <View className="gap-8 pb-10">
                   <View className="bg-surface-background border border-surface-border rounded-2xl flex-row items-center px-6 py-4 mb-4">
                      <FontAwesome name="search" size={14} className="text-typography-muted mr-4" />
                      <TextInput 
                        placeholder="Search Agents or Teams..."
                        placeholderTextColor="rgb(var(--text-dim))"
                        value={search}
                        onChangeText={setSearch}
                        className="flex-1 text-typography-main font-bold"
                      />
                   </View>

                   <View className="flex-row gap-8">
                      <View className="flex-1">
                         <Text className="text-brand-primary text-[10px] font-black uppercase tracking-widest mb-4 ml-1">Individual Agents</Text>
                         <View className="gap-2">
                            {users.filter(u => u.full_name?.toLowerCase().includes(search.toLowerCase())).map(u => (
                              <TouchableOpacity 
                                key={u.id} 
                                onPress={() => toggleUser(u.id)}
                                className={`flex-row items-center justify-between p-4 rounded-xl border transition-all ${draft.assigneeUserIds.includes(u.id) ? 'bg-brand-primary/10 border-brand-primary' : 'bg-surface-background/50 border-surface-border'}`}
                              >
                                 <View className="flex-row items-center">
                                    <View className="w-8 h-8 rounded-full bg-surface-card border border-surface-border items-center justify-center mr-3">
                                       <Text className="text-typography-main font-black text-[10px]">{u.full_name?.charAt(0)}</Text>
                                    </View>
                                    <Text className="text-typography-main font-bold text-sm">{u.full_name}</Text>
                                 </View>
                                 {draft.assigneeUserIds.includes(u.id) && <FontAwesome name="check" size={12} className="text-brand-primary" />}
                              </TouchableOpacity>
                            ))}
                         </View>
                      </View>

                      <View className="flex-1">
                         <Text className="text-brand-accent text-[10px] font-black uppercase tracking-widest mb-4 ml-1">Tactical Teams</Text>
                         <View className="gap-2">
                            {teams.filter(t => t.name?.toLowerCase().includes(search.toLowerCase())).map(t => (
                              <TouchableOpacity 
                                key={t.id} 
                                onPress={() => toggleTeam(t.id)}
                                className={`flex-row items-center justify-between p-4 rounded-xl border transition-all ${draft.assigneeTeamIds.includes(t.id) ? 'bg-brand-accent/10 border-brand-accent' : 'bg-surface-background/50 border-surface-border'}`}
                              >
                                 <View className="flex-row items-center">
                                    <View style={{ backgroundColor: t.color || 'rgb(var(--brand-accent))' }} className="w-3 h-3 rounded-full mr-4" />
                                    <Text className="text-typography-main font-bold text-sm">{t.name}</Text>
                                 </View>
                                 {draft.assigneeTeamIds.includes(t.id) && <FontAwesome name="check" size={12} className="text-brand-accent" />}
                              </TouchableOpacity>
                            ))}
                         </View>
                      </View>
                   </View>
                </View>
              )}
            </ScrollView>

            {/* Footer */}
            <View className="px-10 py-8 border-t border-surface-border flex-row gap-6">
              <TouchableOpacity 
                onPress={onClose}
                className="flex-1 bg-surface-background py-5 rounded-2xl border border-surface-border items-center hover:bg-surface-overlay transition-colors"
              >
                <Text className="text-typography-muted font-black uppercase tracking-widest text-xs">Keep as Draft</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                onPress={handleCreate}
                disabled={loading || !draft.title}
                className={`flex-[2] py-5 rounded-2xl items-center premium-shadow transition-all ${loading || !draft.title ? 'bg-surface-border opacity-50' : 'bg-brand-primary hover:scale-[1.01] active:scale-[0.98]'}`}
              >
                {loading ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text className="text-white font-black uppercase tracking-[0.3em] text-xs">Authorize Deployment</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>

        </View>
      </View>
    </Modal>
  );
}
