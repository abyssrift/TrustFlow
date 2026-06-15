import { useTaskCreation } from '@/contexts/TaskCreationContext';
import { supabase } from '@/lib/supabase';
import { FontAwesome } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import PremiumCalendarPicker from '../common/PremiumCalendarPicker';
import { useThemeColors } from '@/hooks/useThemeColors';

type Props = {
  visible: boolean;
  onClose: () => void;
  initialPipelineId?: string | null;
};

type TaskTemplate = {
  name: string;
  title: string;
  description: string;
  category: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  weight: number;
};

const TEMPLATES_KEY = '@TrustFlow_task_templates';

export default function CreateTaskSheet({ visible, onClose, initialPipelineId }: Props) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { draft, setDraft, createTask, loading, recentTasks, loadRecentTasks, briefFiles, setBriefFiles } = useTaskCreation();
  const [step, setStep] = useState(1);
  const [users, setUsers] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [showCalendar, setShowCalendar] = useState(false);
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);

  const loadTemplates = async () => {
    try {
      const saved = await AsyncStorage.getItem(TEMPLATES_KEY);
      if (saved) setTemplates(JSON.parse(saved));
    } catch {}
  };

  const saveAsTemplate = async () => {
    if (!draft.title.trim()) {
      Alert.alert('No Title', 'Add a title first to save it as a template.');
      return;
    }
    const template: TaskTemplate = {
      name: draft.title.trim(),
      title: draft.title,
      description: draft.description,
      category: draft.category,
      priority: draft.priority,
      weight: draft.weight,
    };
    const updated = [...templates, template];
    setTemplates(updated);
    await AsyncStorage.setItem(TEMPLATES_KEY, JSON.stringify(updated));
  };

  const loadTemplate = (template: TaskTemplate) => {
    setDraft({
      title: template.title,
      description: template.description,
      category: template.category,
      priority: template.priority,
      weight: template.weight,
    });
  };

  const deleteTemplate = async (index: number) => {
    const updated = templates.filter((_, i) => i !== index);
    setTemplates(updated);
    await AsyncStorage.setItem(TEMPLATES_KEY, JSON.stringify(updated));
  };

  useEffect(() => {
    if (visible) {
      loadRecentTasks();
      loadTemplates();
      fetchResources();
      if (initialPipelineId && !draft.pipelineId) {
        setDraft({ pipelineId: initialPipelineId });
      }
    }
  }, [visible]);

  const fetchResources = async () => {
    const [{ data: userData }, { data: teamData }] = await Promise.all([
      supabase.from('users').select('id, full_name').is('deleted_at', null),
      supabase.from('teams').select('id, name, color').is('deleted_at', null),
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
            {/* Quick Start — Recent Tasks & Templates */}
            <View className="pb-6 border-b border-surface-border/50">
              {recentTasks.length > 0 && (
                <View className="mb-5">
                  <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-2 ml-1">Copy Recent</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View className="flex-row gap-2 pr-2">
                      {recentTasks.slice(0, 6).map(t => (
                        <TouchableOpacity
                          key={t.id}
                          onPress={() => setDraft({
                            title: t.title,
                            description: t.description || '',
                            category: t.category || 'General',
                            priority: t.priority === 'medium' ? 'normal' : (t.priority || 'normal'),
                          })}
                          className="bg-surface-card border border-surface-border rounded-xl px-4 py-3"
                          style={{ maxWidth: 140 }}
                        >
                          <Text className="text-typography-main font-bold text-xs" numberOfLines={1}>{t.title}</Text>
                          <Text className="text-typography-muted text-[9px] font-bold uppercase mt-0.5">{t.category || 'General'}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </ScrollView>
                </View>
              )}

              <View>
                <View className="flex-row items-center justify-between mb-2">
                  <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest ml-1">Templates</Text>
                  <TouchableOpacity onPress={saveAsTemplate} className="flex-row items-center gap-1">
                    <FontAwesome name="bookmark-o" size={10} color={colors.primary} />
                    <Text className="text-brand-primary text-[10px] font-black uppercase">Save Current</Text>
                  </TouchableOpacity>
                </View>
                {templates.length > 0 ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View className="flex-row gap-2 pr-2">
                      {templates.map((t, i) => (
                        <TouchableOpacity
                          key={i}
                          onPress={() => loadTemplate(t)}
                          onLongPress={() =>
                            Alert.alert('Delete Template', `Remove "${t.name}"?`, [
                              { text: 'Cancel', style: 'cancel' },
                              { text: 'Delete', style: 'destructive', onPress: () => deleteTemplate(i) },
                            ])
                          }
                          className="bg-brand-primary/10 border border-brand-primary/30 rounded-xl px-4 py-3"
                          style={{ maxWidth: 140 }}
                        >
                          <Text className="text-brand-primary font-bold text-xs" numberOfLines={1}>{t.name}</Text>
                          <Text className="text-brand-primary/60 text-[9px] font-bold uppercase mt-0.5">Hold to delete</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </ScrollView>
                ) : (
                  <Text className="text-typography-muted text-[10px] ml-1 font-medium">No templates yet. Fill in details and tap Save.</Text>
                )}
              </View>
            </View>

            <View>
              <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-2 ml-1">Title</Text>
              <TextInput 
                value={draft.title ?? ''}
                onChangeText={t => setDraft({ title: t })}
                placeholder="Deployment Objective"
                placeholderTextColor={colors.textDim}
                className="bg-surface-background border border-surface-border rounded-xl px-5 py-4 text-typography-main font-bold text-base"
              />
            </View>
            <View>
              <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-2 ml-1">Category</Text>
              <TextInput 
                value={draft.category ?? ''}
                onChangeText={t => setDraft({ category: t })}
                placeholder="General"
                placeholderTextColor={colors.textDim}
                className="bg-surface-background border border-surface-border rounded-xl px-5 py-4 text-typography-main font-bold"
              />
            </View>
            <View>
              <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-2 ml-1">Description</Text>
              <TextInput 
            value={draft.description ?? ''}
                onChangeText={t => setDraft({ description: t })}
                placeholder="Operation details..."
                placeholderTextColor={colors.textDim}
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
             <View>
               <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-3 ml-1">Brief Files</Text>
               <Text className="text-typography-muted text-[10px] mb-3">Attach reference materials for the assignee.</Text>
               {briefFiles.length > 0 && (
                 <View className="gap-1.5 mb-3">
                   {briefFiles.map(f => (
                     <View key={f.id} className="flex-row items-center bg-surface-background px-3 py-2 rounded-lg border border-surface-border/50">
                       <FontAwesome name={f.type.startsWith('image/') ? 'file-image-o' : 'file-o'} size={11} color={colors.primary} />
                       <Text className="text-typography-main text-[11px] font-bold ml-2 flex-1" numberOfLines={1}>{f.name}</Text>
                       <TouchableOpacity onPress={() => setBriefFiles(prev => prev.filter(x => x.id !== f.id))} className="ml-2 p-1">
                         <FontAwesome name="times-circle" size={12} color={colors.danger} />
                       </TouchableOpacity>
                     </View>
                   ))}
                 </View>
               )}
               <View className="flex-row gap-3">
                 <TouchableOpacity
                   onPress={async () => {
                     const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsMultipleSelection: true });
                     if (!result.canceled) setBriefFiles(prev => [...prev, ...result.assets.map(a => ({ id: Math.random().toString(36).substring(7), uri: a.uri, name: a.fileName || `image_${Date.now()}.jpg`, size: a.fileSize || 0, type: a.mimeType || 'image/jpeg' }))]);
                   }}
                   className="flex-row items-center bg-surface-background px-3 py-2 rounded-xl border border-surface-border"
                 >
                   <FontAwesome name="camera" size={11} color={colors.primary} />
                   <Text className="text-brand-primary text-[10px] font-black uppercase ml-1.5">Add Photo</Text>
                 </TouchableOpacity>
                 <TouchableOpacity
                   onPress={async () => {
                     const result = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: true });
                     if (!result.canceled) setBriefFiles(prev => [...prev, ...result.assets.map(a => ({ id: Math.random().toString(36).substring(7), uri: a.uri, name: a.name, size: a.size || 0, type: a.mimeType || 'application/octet-stream' }))]);
                   }}
                   className="flex-row items-center bg-surface-background px-3 py-2 rounded-xl border border-surface-border"
                 >
                   <FontAwesome name="paperclip" size={11} color={colors.primary} />
                   <Text className="text-brand-primary text-[10px] font-black uppercase ml-1.5">Attach File</Text>
                 </TouchableOpacity>
               </View>
             </View>

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
                <View className="flex-row flex-wrap gap-2 mb-6">
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
             <TouchableOpacity onPress={onClose} disabled={loading} className={loading ? 'opacity-40' : ''}>
                <Text className="text-typography-muted font-bold">Cancel</Text>
             </TouchableOpacity>
             <Text className="text-typography-main font-black uppercase tracking-widest text-xs">New Task</Text>
             <TouchableOpacity onPress={handleCreate} disabled={loading || !draft.title}>
                {loading ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Text className={`font-black uppercase tracking-widest text-xs ${!draft.title ? 'text-typography-dim' : 'text-brand-primary'}`}>Create</Text>
                )}
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
              disabled={step === 1 || loading}
               className={`w-14 h-14 items-center justify-center rounded-2xl bg-surface-card border border-surface-border ${step === 1 ? 'opacity-20' : ''}`}
             >
                <FontAwesome name="chevron-left" size={16} className="text-typography-main" />
             </TouchableOpacity>
             
             {step < 3 ? (
               <TouchableOpacity 
                 onPress={() => setStep(s => s + 1)}
                 disabled={loading}
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

          {loading && (
            <View className="absolute inset-0 z-50 items-center justify-center bg-surface-background/70">
              <View className="bg-surface-card border border-surface-border rounded-3xl px-6 py-5 items-center premium-shadow">
                <ActivityIndicator size="large" color={colors.primary} />
                <Text className="text-typography-main font-black uppercase tracking-[0.25em] text-[10px] mt-3">Creating task</Text>
              </View>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
