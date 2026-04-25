import React, { useState, useEffect } from 'react';
import { View, Text, Modal, TouchableOpacity, TextInput, ScrollView, ActivityIndicator, Platform, KeyboardAvoidingView } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { useTaskCreation } from '@/contexts/TaskCreationContext';
import { supabase } from '@/lib/supabase';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import PremiumCalendarPicker from '../common/PremiumCalendarPicker';

type Props = {
  visible: boolean;
  onClose: () => void;
  initialPipelineId?: string | null;
};

export default function CreateTaskSheet({ visible, onClose, initialPipelineId }: Props) {
  const insets = useSafeAreaInsets();
  const { draft, setDraft, createTask, loading, recentTasks, loadRecentTasks } = useTaskCreation();
  const [step, setStep] = useState(1);
  const [users, setUsers] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
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
      supabase.from('users').select('id, full_name').is('deleted_at', null),
      supabase.from('teams').select('id, name, color').is('deleted_at', null)
    ]);
    setUsers(userData || []);
    setTeams(teamData || []);
  };

  const handleCreate = async () => {
    const id = await createTask();
    if (id) onClose();
  };

  const renderStep = () => {
    switch (step) {
      case 1:
        return (
          <View className="gap-6">
            <View>
              <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-2 ml-1">Title</Text>
              <TextInput 
                value={draft.title}
                onChangeText={t => setDraft({ title: t })}
                placeholder="Deployment Objective"
                placeholderTextColor="rgb(var(--text-dim))"
                className="bg-surface-background border border-surface-border rounded-xl px-5 py-4 text-typography-main font-bold text-base"
              />
            </View>
            <View>
              <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-2 ml-1">Category</Text>
              <TextInput 
                value={draft.category}
                onChangeText={t => setDraft({ category: t })}
                placeholder="General"
                placeholderTextColor="rgb(var(--text-dim))"
                className="bg-surface-background border border-surface-border rounded-xl px-5 py-4 text-typography-main font-bold"
              />
            </View>
            <View>
              <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-2 ml-1">Description</Text>
              <TextInput 
                value={draft.description}
                onChangeText={t => setDraft({ description: t })}
                placeholder="Operation details..."
                placeholderTextColor="rgb(var(--text-dim))"
                multiline
                numberOfLines={4}
                className="bg-surface-background border border-surface-border rounded-xl px-5 py-4 text-typography-main text-sm h-32"
              />
            </View>
          </View>
        );
      case 2:
        return (
          <View className="gap-6">
             <View>
                <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-4 ml-1">Priority</Text>
                <View className="flex-row flex-wrap gap-2">
                  {['low', 'normal', 'high', 'urgent'].map(p => (
                    <TouchableOpacity 
                      key={p} 
                      onPress={() => setDraft({ priority: p as any })}
                      className={`px-6 py-3 rounded-full border ${draft.priority === p ? 'bg-brand-primary border-brand-primary' : 'bg-surface-background border-surface-border'}`}
                    >
                      <Text className={`font-black text-[10px] uppercase tracking-widest ${draft.priority === p ? 'text-white' : 'text-typography-muted'}`}>{p}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
             </View>
             <View>
                <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-4 ml-1">Deadline Sequence</Text>
                <TouchableOpacity 
                  onPress={() => setShowCalendar(!showCalendar)}
                  className="bg-surface-background border border-surface-border rounded-xl px-5 py-4 flex-row items-center justify-between"
                >
                   <Text className={`font-black ${draft.dueDate ? 'text-typography-main' : 'text-typography-dim'}`}>
                      {draft.dueDate ? new Date(draft.dueDate).toLocaleDateString(undefined, { dateStyle: 'long' }) : 'Set Objective Deadline'}
                   </Text>
                   <FontAwesome name="calendar" size={14} className="text-brand-primary" />
                </TouchableOpacity>

                {showCalendar && (
                  <View className="mt-4">
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
             <View>
                <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-2 ml-1">Weight</Text>
                <View className="flex-row items-center gap-4">
                   <TouchableOpacity onPress={() => setDraft({ weight: Math.max(1, draft.weight - 1) })} className="w-12 h-12 bg-surface-background border border-surface-border rounded-xl items-center justify-center">
                      <FontAwesome name="minus" size={14} className="text-typography-main" />
                   </TouchableOpacity>
                   <Text className="text-typography-main font-black text-2xl w-12 text-center">{draft.weight}</Text>
                   <TouchableOpacity onPress={() => setDraft({ weight: draft.weight + 1 })} className="w-12 h-12 bg-surface-background border border-surface-border rounded-xl items-center justify-center">
                      <FontAwesome name="plus" size={14} className="text-typography-main" />
                   </TouchableOpacity>
                </View>
             </View>
          </View>
        );
      case 3:
        return (
          <View className="gap-6">
             <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-2 ml-1">Resources</Text>
             <ScrollView className="max-h-96">
                <Text className="text-brand-primary text-[10px] font-black uppercase mb-3">Agents</Text>
                <View className="flex-row flex-wrap gap-2 mb-6">
                   {users.map(u => (
                     <TouchableOpacity 
                       key={u.id} 
                       onPress={() => setDraft({ assigneeUserIds: draft.assigneeUserIds.includes(u.id) ? draft.assigneeUserIds.filter(id => id !== u.id) : [...draft.assigneeUserIds, u.id] })}
                       className={`px-4 py-2 rounded-lg border ${draft.assigneeUserIds.includes(u.id) ? 'bg-brand-primary border-brand-primary' : 'bg-surface-background border-surface-border'}`}
                     >
                       <Text className={`text-[10px] font-bold ${draft.assigneeUserIds.includes(u.id) ? 'text-white' : 'text-typography-main'}`}>{u.full_name}</Text>
                     </TouchableOpacity>
                   ))}
                </View>
                <Text className="text-brand-accent text-[10px] font-black uppercase mb-3">Teams</Text>
                <View className="flex-row flex-wrap gap-2">
                   {teams.map(t => (
                     <TouchableOpacity 
                       key={t.id} 
                       onPress={() => setDraft({ assigneeTeamIds: draft.assigneeTeamIds.includes(t.id) ? draft.assigneeTeamIds.filter(id => id !== t.id) : [...draft.assigneeTeamIds, t.id] })}
                       className={`px-4 py-2 rounded-lg border ${draft.assigneeTeamIds.includes(t.id) ? 'bg-brand-accent border-brand-accent' : 'bg-surface-background border-surface-border'}`}
                     >
                       <Text className={`text-[10px] font-bold ${draft.assigneeTeamIds.includes(t.id) ? 'text-white' : 'text-typography-main'}`}>{t.name}</Text>
                     </TouchableOpacity>
                   ))}
                </View>
             </ScrollView>
          </View>
        );
      default:
        return null;
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} className="flex-1">
        <View className="flex-1 bg-surface-background" style={{ paddingTop: insets.top }}>
          {/* Header */}
          <View className="px-6 py-4 flex-row items-center justify-between border-b border-surface-border">
             <TouchableOpacity onPress={onClose}>
                <Text className="text-typography-muted font-bold">Cancel</Text>
             </TouchableOpacity>
             <Text className="text-typography-main font-black uppercase tracking-widest text-xs">New Task</Text>
             <TouchableOpacity onPress={handleCreate} disabled={!draft.title}>
                <Text className={`font-black uppercase tracking-widest text-xs ${!draft.title ? 'text-typography-dim' : 'text-brand-primary'}`}>Create</Text>
             </TouchableOpacity>
          </View>

          {/* Progress Bar */}
          <View className="flex-row h-1 bg-surface-overlay">
             <View className="bg-brand-primary h-full" style={{ width: `${(step / 3) * 100}%` }} />
          </View>

          {/* Content */}
          <ScrollView className="flex-1 p-6" showsVerticalScrollIndicator={false}>
             {renderStep()}
          </ScrollView>

          {/* Bottom Nav */}
          <View className="p-6 border-t border-surface-border flex-row justify-between items-center" style={{ paddingBottom: insets.bottom + 20 }}>
             <TouchableOpacity 
               onPress={() => setStep(s => Math.max(1, s - 1))}
               disabled={step === 1}
               className={`w-14 h-14 items-center justify-center rounded-2xl bg-surface-card border border-surface-border ${step === 1 ? 'opacity-20' : ''}`}
             >
                <FontAwesome name="chevron-left" size={16} className="text-typography-main" />
             </TouchableOpacity>
             
             {step < 3 ? (
               <TouchableOpacity 
                 onPress={() => setStep(s => s + 1)}
                 className="flex-1 ml-4 h-14 bg-brand-primary items-center justify-center rounded-2xl premium-shadow"
               >
                  <Text className="text-white font-black uppercase tracking-widest text-xs">Next Phase</Text>
               </TouchableOpacity>
             ) : (
               <TouchableOpacity 
                 onPress={handleCreate}
                 disabled={loading}
                 className="flex-1 ml-4 h-14 bg-brand-primary items-center justify-center rounded-2xl premium-shadow"
               >
                  {loading ? <ActivityIndicator color="white" /> : <Text className="text-white font-black uppercase tracking-widest text-xs">Deploy Now</Text>}
               </TouchableOpacity>
             )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
